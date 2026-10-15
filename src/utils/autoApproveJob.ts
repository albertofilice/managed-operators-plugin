import { consoleFetchJSON } from '@openshift-console/dynamic-plugin-sdk';
import { clusterApiPath } from './clusterApi';
import {
  AUTO_APPROVE_REGEX_ANNOTATION,
  PLUGIN_CREATED_ANNOTATION,
} from '../constants/operatorPolicyPlugin';

export const AUTO_APPROVE_NAMESPACE = 'managed-operators-auto-approve';
const NAME = 'auto-approve';
const AUDIT_ANNOTATION = 'managed-operators-plugin.openshift.io/last-auto-approved';
const LABELS = { 'app.kubernetes.io/managed-by': 'managed-operators-plugin' };

/**
 * Minor-line auto-approve. Only OperatorPolicies created from this plugin are considered, so
 * policies delivered by a hub Policy / GitOps are never touched. A pending InstallPlan's CSV is
 * added to spec.versions (policy upgradeApproval Automatic) when it matches the policy regex (which defines the allowed minor line)
 * and keeps the installed major version (no silent major jumps).
 */
const SCRIPT = `#!/bin/bash
set -uo pipefail
ANN='${AUTO_APPROVE_REGEX_ANNOTATION}'
CREATED='${PLUGIN_CREATED_ANNOTATION}'
AUDIT='${AUDIT_ANNOTATION}'

major() {
  echo "$1" | grep -oE '[0-9]+\\.[0-9]+\\.[0-9]+' | head -n1 | awk -F. '{print $1}'
}

oc get operatorpolicies.policy.open-cluster-management.io -A -o json \\
  | jq -c --arg a "$ANN" --arg c "$CREATED" \\
      '.items[] | select(.metadata.annotations[$a] != null and .metadata.annotations[$c] == "true")' \\
  | while read -r pol; do
    pns=$(jq -r '.metadata.namespace' <<<"$pol")
    pname=$(jq -r '.metadata.name' <<<"$pol")
    regex=$(jq -r --arg a "$ANN" '.metadata.annotations[$a]' <<<"$pol")
    subns=$(jq -r '.spec.subscription.namespace' <<<"$pol")
    subname=$(jq -r '.spec.subscription.name' <<<"$pol")
    echo "policy $pns/$pname regex=$regex sub=$subns/$subname"

    # OperatorPolicy approves upgrades itself only with upgradeApproval Automatic, restricted to
    # spec.versions. None never approves; Automatic without versions approves everything (nothing
    # to do). So the regex only has an effect with Automatic AND a non-empty versions list.
    mode=$(jq -r '.spec.upgradeApproval // "Automatic"' <<<"$pol")
    if [ "$mode" != "Automatic" ] || ! jq -e '(.spec.versions // []) | length > 0' <<<"$pol" >/dev/null; then
      echo "  needs upgradeApproval Automatic and a non-empty versions list, skipping"; continue
    fi

    installed=$(oc get subscriptions.operators.coreos.com "$subname" -n "$subns" \\
      -o jsonpath='{.status.installedCSV}' 2>/dev/null)
    if [ -z "$installed" ]; then echo "  no installed CSV yet, skipping"; continue; fi
    line=$(major "$installed")

    oc get installplans.operators.coreos.com -n "$subns" -o json \\
      | jq -r '.items[] | select(.spec.approved == false) | .spec.clusterServiceVersionNames[]' \\
      | sort -u | while read -r csv; do
        if ! [[ "$csv" =~ $regex ]]; then echo "  $csv: regex mismatch"; continue; fi
        if [ "$(major "$csv")" != "$line" ]; then
          echo "  $csv: different major than installed (v$line), NOT approved"; continue
        fi
        if jq -e --arg c "$csv" '(.spec.versions // []) | index($c)' <<<"$pol" >/dev/null; then
          echo "  $csv: already allowed"; continue
        fi
        patch=$(jq -nc --arg c "$csv" --arg a "$AUDIT" --arg ts "$(date -u +%FT%TZ)" \\
          --argjson v "$(jq -c --arg c "$csv" '(.spec.versions // []) + [$c] | unique' <<<"$pol")" \\
          '{metadata:{annotations:{($a): ($c + "@" + $ts)}}, spec:{versions:$v}}')
        if oc patch operatorpolicies.policy.open-cluster-management.io "$pname" -n "$pns" \\
             --type=merge -p "$patch"; then
          echo "  $csv: added to spec.versions (auto-approved)"
        fi
      done
  done
`;

type Manifest = { path: string; body: Record<string, unknown> };

export function manifests(): Manifest[] {
  const meta = (extra: Record<string, unknown> = {}) => ({ name: NAME, labels: LABELS, ...extra });
  return [
    {
      path: '/api/v1/namespaces',
      body: {
        apiVersion: 'v1',
        kind: 'Namespace',
        metadata: { name: AUTO_APPROVE_NAMESPACE, labels: LABELS },
      },
    },
    {
      path: `/api/v1/namespaces/${AUTO_APPROVE_NAMESPACE}/serviceaccounts`,
      body: {
        apiVersion: 'v1',
        kind: 'ServiceAccount',
        metadata: meta({ namespace: AUTO_APPROVE_NAMESPACE }),
      },
    },
    {
      path: '/apis/rbac.authorization.k8s.io/v1/clusterroles',
      body: {
        apiVersion: 'rbac.authorization.k8s.io/v1',
        kind: 'ClusterRole',
        metadata: meta({ name: AUTO_APPROVE_NAMESPACE }),
        rules: [
          {
            apiGroups: ['policy.open-cluster-management.io'],
            resources: ['operatorpolicies'],
            verbs: ['get', 'list', 'patch'],
          },
          {
            apiGroups: ['operators.coreos.com'],
            resources: ['installplans', 'subscriptions'],
            verbs: ['get', 'list'],
          },
        ],
      },
    },
    {
      path: '/apis/rbac.authorization.k8s.io/v1/clusterrolebindings',
      body: {
        apiVersion: 'rbac.authorization.k8s.io/v1',
        kind: 'ClusterRoleBinding',
        metadata: meta({ name: AUTO_APPROVE_NAMESPACE }),
        roleRef: {
          apiGroup: 'rbac.authorization.k8s.io',
          kind: 'ClusterRole',
          name: AUTO_APPROVE_NAMESPACE,
        },
        subjects: [{ kind: 'ServiceAccount', name: NAME, namespace: AUTO_APPROVE_NAMESPACE }],
      },
    },
    {
      path: `/api/v1/namespaces/${AUTO_APPROVE_NAMESPACE}/configmaps`,
      body: {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: meta({ name: 'auto-approve-script', namespace: AUTO_APPROVE_NAMESPACE }),
        data: { 'run.sh': SCRIPT },
      },
    },
    {
      path: `/apis/batch/v1/namespaces/${AUTO_APPROVE_NAMESPACE}/cronjobs`,
      body: {
        apiVersion: 'batch/v1',
        kind: 'CronJob',
        metadata: meta({ namespace: AUTO_APPROVE_NAMESPACE }),
        spec: {
          schedule: '*/10 * * * *',
          concurrencyPolicy: 'Forbid',
          successfulJobsHistoryLimit: 1,
          failedJobsHistoryLimit: 3,
          jobTemplate: {
            spec: {
              backoffLimit: 0,
              template: {
                spec: {
                  serviceAccountName: NAME,
                  restartPolicy: 'Never',
                  securityContext: {
                    runAsNonRoot: true,
                    seccompProfile: { type: 'RuntimeDefault' },
                  },
                  containers: [
                    {
                      name: NAME,
                      // Built-in OpenShift imagestream with oc + jq; no pull secret needed.
                      image:
                        'image-registry.openshift-image-registry.svc:5000/openshift/tools:latest',
                      command: ['/bin/bash', '/scripts/run.sh'],
                      securityContext: {
                        allowPrivilegeEscalation: false,
                        capabilities: { drop: ['ALL'] },
                      },
                      resources: { requests: { cpu: '10m', memory: '50Mi' } },
                      volumeMounts: [{ name: 'script', mountPath: '/scripts' }],
                    },
                  ],
                  volumes: [
                    {
                      name: 'script',
                      configMap: { name: 'auto-approve-script', defaultMode: 365 },
                    },
                  ],
                },
              },
            },
          },
        },
      },
    },
  ];
}

function isAlreadyExists(e: unknown): boolean {
  const code = (e as { code?: number; response?: { status?: number } })?.code;
  const status = (e as { response?: { status?: number } })?.response?.status;
  return code === 409 || status === 409 || /AlreadyExists|already exists/i.test(String(e));
}

/**
 * Idempotently installs (or refreshes) the auto-approve CronJob on a cluster, through the same
 * proxy used for every other call. Needs permission to create a ClusterRole/Binding there.
 */
export async function ensureAutoApproveJob(clusterKey: string): Promise<void> {
  for (const { path, body } of manifests()) {
    const url = clusterApiPath(clusterKey, path);
    try {
      await consoleFetchJSON.post(url, body);
    } catch (e) {
      if (!isAlreadyExists(e)) throw e;
      const name = (body.metadata as { name: string }).name;
      // Refresh script / schedule on upgrade; other kinds are unchanged.
      if (body.kind === 'ConfigMap' || body.kind === 'CronJob') {
        await consoleFetchJSON(`${url}/${encodeURIComponent(name)}`, 'PATCH', {
          headers: { 'Content-Type': 'application/merge-patch+json' },
          body: JSON.stringify(body),
        });
      }
    }
  }
}
