import * as React from 'react';
import {
  DocumentTitle,
  useK8sWatchResource,
  K8sResourceCommon,
  consoleFetchJSON,
} from '@openshift-console/dynamic-plugin-sdk';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionToggle,
  Alert,
  Button,
  Card,
  CardBody,
  EmptyState,
  EmptyStateBody,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalVariant,
  Spinner,
  Title,
} from '@patternfly/react-core';
import { CubesIcon } from '@patternfly/react-icons';
import {
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '@patternfly/react-table';
import { useManagedClusterSubscriptions, type OperatorRow } from '../hooks/useManagedClusterSubscriptions';
import { useClusterCatalogSources } from '../hooks/useClusterCatalogSources';
import { usePluginPolicyEditableMap } from '../hooks/usePluginPolicyEditableMap';
import { OperatorPolicyFormModal } from './OperatorPolicyFormModal';
import type { OperatorPolicyKind } from '../types/operatorPolicy';
import { PLUGIN_CREATED_ANNOTATION } from '../constants/operatorPolicyPlugin';
import { SUBSCRIPTION_ENROLL_OPERATOR_POLICY_LABEL } from '../constants/subscriptionMigration';
import { clusterApiPath } from '../utils/clusterApi';

/** Remove OperatorPolicy on the managed cluster when it was created from this plugin (stops governance from recreating the Subscription). */
async function deletePluginOperatorPolicyIfPresent(
  clusterKey: string,
  ref: { namespace: string; name: string },
): Promise<boolean> {
  const url = clusterApiPath(
    clusterKey,
    `/apis/policy.open-cluster-management.io/v1beta1/namespaces/${encodeURIComponent(ref.namespace)}/operatorpolicies/${encodeURIComponent(ref.name)}`,
  );
  try {
    const policy = (await consoleFetchJSON(url, 'GET')) as OperatorPolicyKind;
    if (policy.metadata?.annotations?.[PLUGIN_CREATED_ANNOTATION] !== 'true') {
      return false;
    }
    await consoleFetchJSON.delete(url);
    return true;
  } catch {
    return false;
  }
}

type ManagedClusterKind = K8sResourceCommon & {
  apiVersion: 'cluster.open-cluster-management.io/v1';
  kind: 'ManagedCluster';
  metadata?: { name?: string };
  status?: { conditions?: Array<{ type: string; status: string }> };
};

const managedClusterWatch = {
  groupVersionKind: {
    group: 'cluster.open-cluster-management.io',
    version: 'v1',
    kind: 'ManagedCluster',
  },
  isList: true,
  namespaced: false,
} as const;

function clusterReady(mc: ManagedClusterKind): boolean {
  const conditions = mc.status?.conditions ?? [];
  const avail = conditions.find((c) => c.type === 'ManagedClusterConditionAvailable');
  return avail?.status === 'True';
}

function groupRowsByCluster(rows: OperatorRow[]): Map<string, OperatorRow[]> {
  const m = new Map<string, OperatorRow[]>();
  for (const r of rows) {
    const list = m.get(r.clusterDisplayName) ?? [];
    list.push(r);
    m.set(r.clusterDisplayName, list);
  }
  return m;
}

function CsvPhaseLabel({ succeeded, phase }: { succeeded: boolean; phase: string }) {
  if (succeeded) {
    return (
      <Label status="success" isCompact>
        {phase}
      </Label>
    );
  }
  return (
    <Label color="red" isCompact>
      {phase}
    </Label>
  );
}

const MyCustomPage: React.FC = () => {
  const [clusters, clustersLoaded, clustersError] = useK8sWatchResource<ManagedClusterKind[]>(
    managedClusterWatch,
  );

  const clusterNames = React.useMemo(() => {
    const list = Array.isArray(clusters) ? clusters : [];
    return list.filter(clusterReady).map((c) => c.metadata?.name).filter(Boolean) as string[];
  }, [clusters]);

  const [subscriptionListEpoch, setSubscriptionListEpoch] = React.useState(0);
  const { rows, loaded: subsLoaded, error: subsError } = useManagedClusterSubscriptions(
    clusterNames,
    subscriptionListEpoch,
  );

  const { loading: pluginMetaLoading, canEditPlugin, isExternalGovernancePolicy } =
    usePluginPolicyEditableMap(rows);

  const loaded = clustersLoaded && subsLoaded;
  const loadError = clustersError ?? subsError;

  const byCluster = React.useMemo(() => groupRowsByCluster(rows), [rows]);
  const clusterKeys = React.useMemo(() => [...byCluster.keys()].sort(), [byCluster]);

  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});

  const [editModalOpen, setEditModalOpen] = React.useState(false);
  const [editClusterKey, setEditClusterKey] = React.useState('');
  const [editPolicy, setEditPolicy] = React.useState<OperatorPolicyKind | null>(null);
  const [editLoading, setEditLoading] = React.useState(false);
  const [editFetchError, setEditFetchError] = React.useState<string | null>(null);
  const [editSuccess, setEditSuccess] = React.useState<string | null>(null);

  const [uninstallRow, setUninstallRow] = React.useState<OperatorRow | null>(null);
  const [uninstallSubmitting, setUninstallSubmitting] = React.useState(false);
  const [uninstallError, setUninstallError] = React.useState<string | null>(null);

  const [migrateRow, setMigrateRow] = React.useState<OperatorRow | null>(null);
  const [migrateSubmitting, setMigrateSubmitting] = React.useState(false);
  const [migrateError, setMigrateError] = React.useState<string | null>(null);

  const { catalogSources, loadingCs, csError } = useClusterCatalogSources(
    editModalOpen && editClusterKey ? editClusterKey : undefined,
  );

  React.useEffect(() => {
    setExpanded((prev) => {
      const next = { ...prev };
      for (const c of clusterKeys) {
        if (next[c] === undefined) {
          next[c] = true;
        }
      }
      return next;
    });
  }, [clusterKeys]);

  const toggleCluster = (name: string) => {
    setExpanded((e) => ({ ...e, [name]: !(e[name] ?? true) }));
  };

  const safeToggleId = (name: string) =>
    `managed-op-cluster-${name.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

  const openEditPolicy = React.useCallback(async (r: OperatorRow) => {
    if (!r.operatorPolicyRef || !canEditPlugin(r)) return;
    setEditSuccess(null);
    setEditFetchError(null);
    setEditPolicy(null);
    const { namespace, name } = r.operatorPolicyRef;
    setEditClusterKey(r.clusterKey);
    setEditModalOpen(true);
    setEditLoading(true);
    try {
      const url = clusterApiPath(
        r.clusterKey,
        `/apis/policy.open-cluster-management.io/v1beta1/namespaces/${encodeURIComponent(namespace)}/operatorpolicies/${encodeURIComponent(name)}`,
      );
      const policy = (await consoleFetchJSON(url, 'GET')) as OperatorPolicyKind;
      if (policy.metadata?.annotations?.[PLUGIN_CREATED_ANNOTATION] !== 'true') {
        setEditFetchError(
          'This OperatorPolicy is no longer marked as created by this plugin (annotation missing). Reload the page.',
        );
        setEditPolicy(null);
      } else {
        setEditPolicy(policy);
      }
    } catch (e) {
      setEditFetchError(`Failed to load OperatorPolicy: ${String(e)}`);
      setEditPolicy(null);
    } finally {
      setEditLoading(false);
    }
  }, [canEditPlugin]);

  const closeEditModal = () => {
    setEditModalOpen(false);
    setEditPolicy(null);
    setEditFetchError(null);
    setEditLoading(false);
  };

  const openUninstall = React.useCallback((r: OperatorRow) => {
    setUninstallError(null);
    setUninstallRow(r);
  }, []);

  const openMigrate = React.useCallback((r: OperatorRow) => {
    setMigrateError(null);
    setMigrateRow(r);
  }, []);

  const closeMigrateModal = () => {
    if (migrateSubmitting) return;
    setMigrateRow(null);
    setMigrateError(null);
  };

  const confirmApplyMigrationLabel = async () => {
    if (!migrateRow) return;
    setMigrateSubmitting(true);
    setMigrateError(null);
    const url = clusterApiPath(
      migrateRow.clusterKey,
      `/apis/operators.coreos.com/v1alpha1/namespaces/${encodeURIComponent(migrateRow.namespace)}/subscriptions/${encodeURIComponent(migrateRow.name)}`,
    );
    try {
      await consoleFetchJSON(url, 'PATCH', {
        headers: { 'Content-Type': 'application/merge-patch+json' },
        body: JSON.stringify({
          metadata: {
            labels: {
              [SUBSCRIPTION_ENROLL_OPERATOR_POLICY_LABEL]: 'true',
            },
          },
        }),
      });
      const refNs = migrateRow.namespace;
      const refName = migrateRow.name;
      setMigrateRow(null);
      setSubscriptionListEpoch((n) => n + 1);
      setEditSuccess(
        `Migration label set on ${refNs}/${refName}. Create a matching OperatorPolicy (Install operators page) or let your cluster automation react to the label.`,
      );
    } catch (e) {
      setMigrateError(String(e));
    } finally {
      setMigrateSubmitting(false);
    }
  };

  const closeUninstallModal = () => {
    if (uninstallSubmitting) return;
    setUninstallRow(null);
    setUninstallError(null);
  };

  const confirmUninstall = async () => {
    if (!uninstallRow) return;
    const row = uninstallRow;
    setUninstallSubmitting(true);
    setUninstallError(null);
    try {
      let removedPolicy = false;
      if (row.operatorPolicyRef) {
        removedPolicy = await deletePluginOperatorPolicyIfPresent(row.clusterKey, row.operatorPolicyRef);
      }
      const subUrl = clusterApiPath(
        row.clusterKey,
        `/apis/operators.coreos.com/v1alpha1/namespaces/${encodeURIComponent(row.namespace)}/subscriptions/${encodeURIComponent(row.name)}`,
      );
      await consoleFetchJSON.delete(subUrl);
      setUninstallRow(null);
      setSubscriptionListEpoch((n) => n + 1);
      if (removedPolicy && row.operatorPolicyRef) {
        setEditSuccess(
          `OperatorPolicy ${row.operatorPolicyRef.namespace}/${row.operatorPolicyRef.name} removed, then Subscription ${row.namespace}/${row.name} removed. The operator may finish uninstalling; CRDs can remain depending on OLM settings.`,
        );
      } else if (row.operatorPolicyRef && !removedPolicy) {
        setEditSuccess(
          `Subscription ${row.namespace}/${row.name} removed. The OperatorPolicy (${row.operatorPolicyRef.namespace}/${row.operatorPolicyRef.name}) was not removed (not created from this console or not reachable); delete it on the cluster if the subscription reappears.`,
        );
      } else {
        setEditSuccess(
          `Subscription ${row.namespace}/${row.name} removed. The operator may finish uninstalling; CRDs can remain depending on OLM settings.`,
        );
      }
    } catch (e) {
      setUninstallError(String(e));
    } finally {
      setUninstallSubmitting(false);
    }
  };

  return (
    <>
      <DocumentTitle>Managed cluster operators (OLM)</DocumentTitle>
      <div className="pf-v6-u-px-lg pf-v6-u-pt-lg pf-v6-u-pb-sm">
        <Title headingLevel="h1">Managed cluster operators (OLM)</Title>
        <p className="pf-v6-u-mt-sm">
          OLM Subscriptions per managed cluster: installed operators (by namespace), CSV phase, approval
          mode, pending upgrades via InstallPlans, and OperatorPolicy references when the subscription is
          governance-managed.
        </p>
      </div>

      <div className="pf-v6-u-px-lg pf-v6-u-pb-lg">
        <Card>
          <CardBody>
            {!loaded && (
              <div className="pf-v6-u-text-align-center pf-v6-u-p-xl">
                <Spinner aria-label="Loading" />
              </div>
            )}

            {loadError && (
              <Alert className="pf-v6-u-mb-md" variant="warning" title="Could not load some data">
                {String(loadError)}
                <p className="pf-v6-u-mt-sm">
                  Ensure you have access to the MCE <code>managedclusterproxy</code> path and the MCE console
                  plugin is enabled.
                </p>
              </Alert>
            )}

            {editSuccess && (
              <Alert className="pf-v6-u-mb-md" variant="success" isInline title="Policy updated">
                {editSuccess}
              </Alert>
            )}

            {loaded && clusterNames.length === 0 && rows.length === 0 && !loadError && (
              <EmptyState icon={CubesIcon} titleText="No managed clusters and no hub subscriptions">
                <EmptyStateBody>
                  No Ready ManagedClusters were found and no subscriptions were read on the hub session.
                  Check permissions and ManagedCluster resources.
                </EmptyStateBody>
              </EmptyState>
            )}

            {loaded && clusterNames.length > 0 && rows.length === 0 && !loadError && (
              <EmptyState icon={CubesIcon} titleText="No OLM Subscriptions found">
                <EmptyStateBody>
                  Ready clusters did not return OLM subscriptions via the proxy, or none are installed.
                </EmptyStateBody>
              </EmptyState>
            )}

            {loaded && rows.length > 0 && (
              <Accordion asDefinitionList={false} aria-label="Operators by cluster">
                {clusterKeys.map((clusterDisplayName) => {
                  const clusterRows = byCluster.get(clusterDisplayName) ?? [];
                  const tid = safeToggleId(clusterDisplayName);
                  const isExpanded = expanded[clusterDisplayName] ?? true;
                  return (
                    <AccordionItem key={clusterDisplayName} isExpanded={isExpanded}>
                      <AccordionToggle id={tid} onClick={() => toggleCluster(clusterDisplayName)}>
                        {clusterDisplayName}{' '}
                        <span className="pf-v6-u-text-color-subtle">({clusterRows.length} operators)</span>
                      </AccordionToggle>
                      <AccordionContent
                        id={`${tid}-content`}
                        aria-labelledby={tid}
                        isCustomContent={true}
                      >
                        <div className="pf-v6-u-w-100" style={{ overflow: 'auto', maxWidth: '100%' }}>
                            <Table
                              aria-label={`Operators on ${clusterDisplayName}`}
                              borders
                              gridBreakPoint=""
                            >
                            <Thead>
                              <Tr>
                                <Th>Namespace</Th>
                                <Th>Subscription</Th>
                                <Th>OperatorPolicy</Th>
                                <Th>CSV</Th>
                                <Th>Version</Th>
                                <Th>CSV phase</Th>
                                <Th>Approval</Th>
                                <Th>Subscription status</Th>
                                <Th>Upgrade / InstallPlan</Th>
                                <Th modifier="nowrap">Actions</Th>
                              </Tr>
                            </Thead>
                            <Tbody>
                              {clusterRows.map((r) => {
                                const showEdit =
                                  Boolean(r.operatorPolicyRef) &&
                                  !pluginMetaLoading &&
                                  canEditPlugin(r);
                                /** Hub/GitOps OperatorPolicy: deleting Subscription here is pointless (policy reconciles). Uninstall only for plugin-created or unknown ref. */
                                const hideUninstallExternalHub =
                                  Boolean(r.operatorPolicyRef) &&
                                  !pluginMetaLoading &&
                                  isExternalGovernancePolicy(r);
                                const showUninstall =
                                  r.policyGovernanceManaged && !hideUninstallExternalHub;
                                const showMigrate =
                                  !r.policyGovernanceManaged && !r.migrationEnrollLabelRequested;
                                const showMigrationPending =
                                  !r.policyGovernanceManaged && r.migrationEnrollLabelRequested;
                                return (
                                  <Tr key={`${r.clusterKey}/${r.namespace}/${r.name}`}>
                                    <Td dataLabel="Namespace">{r.namespace}</Td>
                                    <Td dataLabel="Subscription">{r.name}</Td>
                                    <Td dataLabel="OperatorPolicy">
                                      {r.operatorPolicyManagedDisplay ? (
                                        <span className="pf-v6-u-display-inline-flex pf-v6-u-align-items-center pf-v6-u-gap-sm pf-v6-u-flex-wrap">
                                          <span
                                            className="pf-v6-u-font-family-monospace pf-v6-u-font-size-sm"
                                            title={r.operatorPolicyManagedDisplay}
                                          >
                                            {r.operatorPolicyManagedDisplay.length > 48
                                              ? `${r.operatorPolicyManagedDisplay.slice(0, 45)}…`
                                              : r.operatorPolicyManagedDisplay}
                                          </span>
                                          {!pluginMetaLoading &&
                                            r.operatorPolicyRef &&
                                            isExternalGovernancePolicy(r) && (
                                              <Label
                                                color="grey"
                                                isCompact
                                                title="OperatorPolicy not created from this console (e.g. hub Policy or GitOps). Edit via governance or YAML."
                                              >
                                                External
                                              </Label>
                                            )}
                                        </span>
                                      ) : (
                                        '—'
                                      )}
                                    </Td>
                                    <Td dataLabel="CSV">
                                      <span className="pf-v6-u-font-family-monospace pf-v6-u-font-size-sm">
                                        {r.csvFullName}
                                      </span>
                                    </Td>
                                    <Td dataLabel="Version">{r.csvVersion}</Td>
                                    <Td dataLabel="CSV phase">
                                      <CsvPhaseLabel succeeded={r.csvSucceeded} phase={r.csvPhase} />
                                    </Td>
                                    <Td dataLabel="Approval">{r.installPlanApproval}</Td>
                                    <Td dataLabel="Subscription status">{r.subscriptionStateDisplay}</Td>
                                    <Td dataLabel="Upgrade">{r.upgradePending ?? '—'}</Td>
                                    <Td dataLabel="Actions" modifier="nowrap">
                                      <div
                                        className="pf-v6-u-display-inline-flex pf-v6-u-flex-nowrap pf-v6-u-align-items-center"
                                        style={{ gap: 'var(--pf-t--global--spacer--md)' }}
                                      >
                                        {pluginMetaLoading && r.operatorPolicyRef ? (
                                          <Spinner size="sm" aria-label="Loading" />
                                        ) : (
                                          <>
                                            {showEdit && (
                                              <Button
                                                variant="secondary"
                                                size="sm"
                                                onClick={() => openEditPolicy(r)}
                                              >
                                                Edit policy
                                              </Button>
                                            )}
                                            {showUninstall && (
                                              <Button
                                                variant="danger"
                                                size="sm"
                                                onClick={() => openUninstall(r)}
                                              >
                                                Uninstall
                                              </Button>
                                            )}
                                            {showMigrate && (
                                              <Button
                                                variant="secondary"
                                                size="sm"
                                                onClick={() => openMigrate(r)}
                                              >
                                                Migrate to OperatorPolicy
                                              </Button>
                                            )}
                                            {showMigrationPending && (
                                              <span className="pf-v6-u-font-size-sm pf-v6-u-text-color-subtle">
                                                <Label color="blue" isCompact>
                                                  Migration label set
                                                </Label>{' '}
                                                <Button
                                                  variant="link"
                                                  isInline
                                                  component="a"
                                                  href="/multicloud/ecosystem/install-operators"
                                                >
                                                  Create policy
                                                </Button>
                                              </span>
                                            )}
                                          </>
                                        )}
                                      </div>
                                    </Td>
                                  </Tr>
                                );
                              })}
                            </Tbody>
                          </Table>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            )}
          </CardBody>
        </Card>
      </div>

      <Modal
        variant={ModalVariant.medium}
        isOpen={Boolean(migrateRow)}
        onClose={closeMigrateModal}
      >
        <ModalHeader title="Migrate to OperatorPolicy" />
        <ModalBody>
          {migrateRow && (
            <>
              <p>
                This subscription was not installed through OperatorPolicy (manual OLM install). To
                move it under governance, add the opt-in label below. Then create a matching{' '}
                <strong>OperatorPolicy</strong> on the cluster (e.g. from{' '}
                <strong>Install operators</strong>) or use automation that watches this label.
              </p>
              <p className="pf-v6-u-font-size-sm pf-v6-u-mt-md">
                Label key:{' '}
                <code className="pf-v6-u-font-family-monospace">{SUBSCRIPTION_ENROLL_OPERATOR_POLICY_LABEL}</code>
                <br />
                Value: <code className="pf-v6-u-font-family-monospace">true</code>
              </p>
              <p className="pf-v6-u-font-size-sm pf-v6-u-text-color-subtle pf-v6-u-mt-md">
                CLI (cluster context):{' '}
                <code className="pf-v6-u-font-family-monospace">
                  oc label subscription {migrateRow.name}{' '}
                  {SUBSCRIPTION_ENROLL_OPERATOR_POLICY_LABEL}=true -n {migrateRow.namespace}
                </code>
              </p>
              {migrateError && (
                <Alert className="pf-v6-u-mt-md" variant="danger" isInline title="Error">
                  {migrateError}
                </Alert>
              )}
            </>
          )}
        </ModalBody>
        <ModalFooter>
          <Button
            variant="primary"
            onClick={confirmApplyMigrationLabel}
            isDisabled={migrateSubmitting || !migrateRow}
          >
            {migrateSubmitting ? 'Applying…' : 'Apply label'}
          </Button>
          <Button variant="link" onClick={closeMigrateModal} isDisabled={migrateSubmitting}>
            Cancel
          </Button>
        </ModalFooter>
      </Modal>

      <Modal
        variant={ModalVariant.medium}
        isOpen={Boolean(uninstallRow)}
        onClose={closeUninstallModal}
      >
        <ModalHeader title="Uninstall operator" />
        <ModalBody>
          {uninstallRow && (
            <>
              <p>
                Delete the OLM <strong>Subscription</strong>{' '}
                <code className="pf-v6-u-font-family-monospace">
                  {uninstallRow.namespace}/{uninstallRow.name}
                </code>{' '}
                on <strong>{uninstallRow.clusterDisplayName}</strong>? This starts operator removal;
                CSVs and CRDs may remain until cleaned up by OLM or admins.
              </p>
              {uninstallRow.operatorPolicyManagedDisplay && (
                <Alert className="pf-v6-u-mt-md" variant="warning" isInline title="Governance">
                  If this OperatorPolicy was created from this console, it is removed first, then the
                  Subscription — so governance does not recreate the install. If the policy is not
                  plugin-managed, delete or change it on the cluster if the subscription comes back.
                </Alert>
              )}
              {uninstallRow && isExternalGovernancePolicy(uninstallRow) && (
                <Alert className="pf-v6-u-mt-md" variant="info" isInline title="Not created in this console">
                  This OperatorPolicy was not created from this plugin (for example it is reconciled
                  from a hub <strong>Policy</strong> or other automation). Prefer changing or
                  removing the parent policy from RHACM / GitOps; deleting only the Subscription here
                  may be enforced again.
                </Alert>
              )}
              {uninstallError && (
                <Alert className="pf-v6-u-mt-md" variant="danger" isInline title="Error">
                  {uninstallError}
                </Alert>
              )}
            </>
          )}
        </ModalBody>
        <ModalFooter>
          <Button
            variant="danger"
            onClick={confirmUninstall}
            isDisabled={uninstallSubmitting || !uninstallRow}
          >
            {uninstallSubmitting ? 'Removing…' : 'Uninstall'}
          </Button>
          <Button variant="link" onClick={closeUninstallModal} isDisabled={uninstallSubmitting}>
            Cancel
          </Button>
        </ModalFooter>
      </Modal>

      <Modal
        variant={ModalVariant.small}
        isOpen={editModalOpen && Boolean(editFetchError) && !editPolicy && !editLoading}
        onClose={closeEditModal}
      >
        <ModalHeader title="Edit OperatorPolicy" />
        <ModalBody>
          <Alert variant="danger" isInline title="Error">
            {editFetchError}
          </Alert>
        </ModalBody>
        <ModalFooter>
          <Button variant="primary" onClick={closeEditModal}>
            Close
          </Button>
        </ModalFooter>
      </Modal>

      <OperatorPolicyFormModal
        key={editPolicy?.metadata?.uid ?? 'edit'}
        isOpen={
          editModalOpen &&
          !editFetchError &&
          (editLoading || Boolean(editPolicy))
        }
        onClose={closeEditModal}
        mode="edit"
        clusterName={editClusterKey}
        selectedPkg={null}
        catalogSources={catalogSources}
        loadingCs={loadingCs}
        csError={csError}
        initialPolicy={editPolicy}
        editLoading={editLoading}
        onSuccess={(msg) => {
          setEditSuccess(msg);
          closeEditModal();
        }}
      />
    </>
  );
};

export default MyCustomPage;
