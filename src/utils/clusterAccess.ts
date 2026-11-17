import * as React from 'react';
import { consoleFetchJSON } from '@openshift-console/dynamic-plugin-sdk';
import { clusterApiPath } from './clusterApi';

export type AccessAttrs = { group: string; resource: string; verb: string; namespace?: string };
export type AccessRequest = { cluster: string; attrs: AccessAttrs };

const OLM = 'operators.coreos.com';
const POLICY = 'policy.open-cluster-management.io';
const SSAR_PATH = '/apis/authorization.k8s.io/v1/selfsubjectaccessreviews';

/** The write actions the UI offers, as the Kubernetes permission each one needs. */
export const access = {
  approveInstallPlan: (namespace: string): AccessAttrs => ({
    group: OLM,
    resource: 'installplans',
    verb: 'patch',
    namespace,
  }),
  patchSubscription: (namespace: string): AccessAttrs => ({
    group: OLM,
    resource: 'subscriptions',
    verb: 'patch',
    namespace,
  }),
  deleteSubscription: (namespace: string): AccessAttrs => ({
    group: OLM,
    resource: 'subscriptions',
    verb: 'delete',
    namespace,
  }),
  updateOperatorPolicy: (namespace: string): AccessAttrs => ({
    group: POLICY,
    resource: 'operatorpolicies',
    verb: 'update',
    namespace,
  }),
  createOperatorPolicy: (namespace?: string): AccessAttrs => ({
    group: POLICY,
    resource: 'operatorpolicies',
    verb: 'create',
    namespace,
  }),
  /** Needed to install the auto-approve CronJob RBAC on the managed cluster. */
  createClusterRole: (): AccessAttrs => ({
    group: 'rbac.authorization.k8s.io',
    resource: 'clusterroles',
    verb: 'create',
  }),
};

export function accessKey(cluster: string, a: AccessAttrs): string {
  return [cluster, a.group, a.resource, a.verb, a.namespace ?? ''].join('|');
}

type Review = { status?: { allowed?: boolean } };
// eslint-disable-next-line no-unused-vars
export type AccessFetcher = (_url: string, _body: unknown) => Promise<Review>;

const defaultFetcher: AccessFetcher = (url, body) => consoleFetchJSON.post(url, body);

const GRANTED_TTL_MS = 5 * 60_000;
const FAILED_TTL_MS = 30_000;

type Entry = { allowed: boolean; expires: number };
const resolved = new Map<string, Entry>();
const inflight = new Map<string, Promise<boolean>>();

/** Cached answer, or `undefined` when it is unknown or expired. */
export function peekAccess(cluster: string, attrs: AccessAttrs): boolean | undefined {
  const e = resolved.get(accessKey(cluster, attrs));
  return e && e.expires > Date.now() ? e.allowed : undefined;
}

export function resetAccessCache(): void {
  resolved.clear();
  inflight.clear();
}

/**
 * SelfSubjectAccessReview for the logged-in user on `cluster` (through the MCE proxy for managed
 * clusters, which calls the API as that user). If the review itself fails we allow the action and
 * retry soon: the server still enforces RBAC, so a hiccup must not lock people out of the UI.
 */
export function checkClusterAccess(
  cluster: string,
  attrs: AccessAttrs,
  fetcher: AccessFetcher = defaultFetcher,
): Promise<boolean> {
  const key = accessKey(cluster, attrs);
  const known = peekAccess(cluster, attrs);
  if (known !== undefined) return Promise.resolve(known);
  const pending = inflight.get(key);
  if (pending) return pending;

  const body = {
    apiVersion: 'authorization.k8s.io/v1',
    kind: 'SelfSubjectAccessReview',
    spec: {
      resourceAttributes: {
        group: attrs.group,
        resource: attrs.resource,
        verb: attrs.verb,
        ...(attrs.namespace ? { namespace: attrs.namespace } : {}),
      },
    },
  };
  const p = fetcher(clusterApiPath(cluster, SSAR_PATH), body)
    .then((res) => {
      const allowed = res?.status?.allowed === true;
      resolved.set(key, { allowed, expires: Date.now() + GRANTED_TTL_MS });
      return allowed;
    })
    .catch(() => {
      resolved.set(key, { allowed: true, expires: Date.now() + FAILED_TTL_MS });
      return true;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

const CONCURRENCY = 6;

/**
 * Checks the given permissions in the background. `can()` is false until the answer is known, so
 * write actions never flash enabled; it re-renders the caller once answers arrive.
 */
export function useClusterAccess(requests: AccessRequest[]): {
  // eslint-disable-next-line no-unused-vars
  can: (_cluster: string, _attrs: AccessAttrs) => boolean;
  loading: boolean;
} {
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  const signature = requests.map((r) => accessKey(r.cluster, r.attrs)).join('\n');

  React.useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (alive) bump();
      }, 50);
    };
    const seen = new Set<string>();
    const todo = requests.filter((r) => {
      const k = accessKey(r.cluster, r.attrs);
      if (seen.has(k)) return false;
      seen.add(k);
      return peekAccess(r.cluster, r.attrs) === undefined;
    });
    let next = 0;
    const worker = async () => {
      while (alive && next < todo.length) {
        const r = todo[next++];
        await checkClusterAccess(r.cluster, r.attrs);
        schedule();
      }
    };
    for (let i = 0; i < Math.min(CONCURRENCY, todo.length); i += 1) void worker();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
    // `requests` is represented by `signature`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const can = (cluster: string, attrs: AccessAttrs) => peekAccess(cluster, attrs) === true;
  const loading = requests.some((r) => peekAccess(r.cluster, r.attrs) === undefined);
  return { can, loading };
}
