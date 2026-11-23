import '../i18n/registerPluginLocales';
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
  SearchInput,
  Spinner,
  Title,
} from '@patternfly/react-core';
import { CubesIcon } from '@patternfly/react-icons';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import {
  useManagedClusterSubscriptions,
  type OperatorRow,
} from '../hooks/useManagedClusterSubscriptions';
import { useClusterCatalogSources } from '../hooks/useClusterCatalogSources';
import { usePluginConfig } from '../utils/pluginConfig';
import { access, useClusterAccess, type AccessRequest } from '../utils/clusterAccess';
import { useSearchOperatorRows } from '../hooks/useSearchOperatorRows';
import { useClusterDetail } from '../hooks/useClusterDetail';
import { SEARCH_TEXT_PARAM, rowMatchesText } from '../utils/operatorSearch';
import { csvFilename, downloadCsv } from '../utils/csv';
import { operatorsCsv } from '../utils/exportCsv';
import { LAZY_CLUSTER_THRESHOLD, mergeClusterRows } from '../utils/searchRows';
import { GuardedButton } from './GuardedButton';
import { usePluginPolicyEditableMap } from '../hooks/usePluginPolicyEditableMap';
import { clearManagedOperatorsGetCache } from '../utils/managedOperatorsGetCache';
import { OperatorPolicyFormModal } from './OperatorPolicyFormModal';
import type { OperatorPolicyKind } from '../types/operatorPolicy';
import { PLUGIN_CREATED_ANNOTATION } from '../constants/operatorPolicyPlugin';
import { SUBSCRIPTION_ENROLL_OPERATOR_POLICY_LABEL } from '../constants/subscriptionMigration';
import { clusterApiPath } from '../utils/clusterApi';
import { MOP_Q } from '../utils/installOperatorsPrefill';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom-v5-compat';
import {
  OVERVIEW_FILTER_PARAM,
  parseOverviewFilter,
  rowMatchesOverviewFilter,
} from '../utils/overviewFilters';

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
  const { t } = useTranslation('plugin__managed-operators-plugin');
  const location = useLocation();
  const navigate = useNavigate();
  const { readOnly } = usePluginConfig();
  const [clusters, clustersLoaded, clustersError] =
    useK8sWatchResource<ManagedClusterKind[]>(managedClusterWatch);

  const clusterNames = React.useMemo(() => {
    const list = Array.isArray(clusters) ? clusters : [];
    return list
      .filter(clusterReady)
      .map((c) => c.metadata?.name)
      .filter(Boolean) as string[];
  }, [clusters]);

  const [subscriptionListEpoch, setSubscriptionListEpoch] = React.useState(0);

  const activeFilter = React.useMemo(() => parseOverviewFilter(location.search), [location.search]);
  // Free-text search; kept in the URL (?q=) so a link or reload keeps it.
  const searchText = React.useMemo(
    () => new URLSearchParams(location.search).get(SEARCH_TEXT_PARAM) ?? '',
    [location.search],
  );
  const [searchDraft, setSearchDraft] = React.useState(searchText);
  React.useEffect(() => setSearchDraft(searchText), [searchText]);
  const applySearch = React.useCallback(
    (value: string) => {
      setSearchDraft(value);
      const q = new URLSearchParams(location.search);
      if (value.trim()) q.set(SEARCH_TEXT_PARAM, value);
      else q.delete(SEARCH_TEXT_PARAM);
      const str = q.toString();
      navigate(`${location.pathname}${str ? `?${str}` : ''}`, { replace: true });
    },
    [navigate, location.pathname, location.search],
  );

  // Large fleets: list from RHACM Search and load each cluster's details only when it is expanded.
  // `?lazy=1` / `?lazy=0` forces it. The plugin / external split needs policy annotations Search
  // does not index, so those two filters use the full load.
  const lazyParam = new URLSearchParams(location.search).get('lazy');
  const searchWanted =
    clustersLoaded &&
    clusterNames.length > 0 &&
    (lazyParam === '1' || (lazyParam !== '0' && clusterNames.length > LAZY_CLUSTER_THRESHOLD)) &&
    activeFilter !== 'external' &&
    activeFilter !== 'plugin';
  const searchState = useSearchOperatorRows(clusterNames, searchWanted, subscriptionListEpoch);
  const lazy = searchWanted && searchState.loaded && !searchState.unavailable;
  const fullLoadEnabled =
    clustersLoaded && (!searchWanted || (searchState.loaded && searchState.unavailable));
  const full = useManagedClusterSubscriptions(clusterNames, subscriptionListEpoch, fullLoadEnabled);
  const clusterDetail = useClusterDetail(lazy, subscriptionListEpoch);

  const rows = React.useMemo(
    () => (lazy ? mergeClusterRows(searchState.rows, clusterDetail.detail) : full.rows),
    [lazy, searchState.rows, clusterDetail.detail, full.rows],
  );
  const subsLoaded = searchWanted ? searchState.loaded && (lazy || full.loaded) : full.loaded;
  const subsError = lazy ? undefined : full.error;
  /** Rows that carry InstallPlan / policy details (all of them unless we are in Search mode). */
  const detailRows = React.useMemo(
    () => (lazy ? Object.values(clusterDetail.detail).flat() : rows),
    [lazy, clusterDetail.detail, rows],
  );
  const detailLoaded = (r: OperatorRow) => !lazy || Boolean(clusterDetail.detail[r.clusterKey]);

  const {
    loading: pluginMetaLoading,
    canEditPlugin,
    isExternalGovernancePolicy,
    isMissingPolicy,
    isInformRemediation,
  } = usePluginPolicyEditableMap(detailRows, subscriptionListEpoch);

  const accessRequests = React.useMemo<AccessRequest[]>(() => {
    if (readOnly) return [];
    const reqs: AccessRequest[] = [];
    for (const r of detailRows) {
      if (r.installPlanApprovalRequired && r.installPlanRef) {
        reqs.push({
          cluster: r.clusterKey,
          attrs: access.approveInstallPlan(r.installPlanRef.namespace),
        });
      }
      if (r.operatorPolicyRef) {
        reqs.push({
          cluster: r.clusterKey,
          attrs: access.updateOperatorPolicy(r.operatorPolicyRef.namespace),
        });
      }
      reqs.push({
        cluster: r.clusterKey,
        attrs: r.policyGovernanceManaged
          ? access.deleteSubscription(r.namespace)
          : access.patchSubscription(r.namespace),
      });
    }
    return reqs;
  }, [detailRows, readOnly]);
  const { can } = useClusterAccess(accessRequests);

  const loaded = clustersLoaded && subsLoaded;
  const loadError = clustersError ?? subsError;

  const visibleRows = React.useMemo(() => {
    const byFilter = activeFilter
      ? rows.filter((r) =>
          rowMatchesOverviewFilter(r, activeFilter, {
            canEditPlugin,
            isExternalGovernancePolicy,
          }),
        )
      : rows;
    return searchText.trim() ? byFilter.filter((r) => rowMatchesText(r, searchText)) : byFilter;
  }, [rows, activeFilter, searchText, canEditPlugin, isExternalGovernancePolicy]);
  const clearFilter = React.useCallback(() => {
    const q = new URLSearchParams(location.search);
    q.delete(OVERVIEW_FILTER_PARAM);
    const s = q.toString();
    navigate(`${location.pathname}${s ? `?${s}` : ''}`, { replace: true });
  }, [navigate, location.pathname, location.search]);

  const byCluster = React.useMemo(() => groupRowsByCluster(visibleRows), [visibleRows]);
  const clusterKeys = React.useMemo(() => [...byCluster.keys()].sort(), [byCluster]);

  const drillClusterKey = React.useMemo(() => {
    const q = new URLSearchParams(location.search);
    const c = (q.get('cluster') ?? '').trim();
    if (!c) return null;
    if (c === '__hub_direct__') return 'Hub (current session)';
    return c;
  }, [location.search]);

  const clusterKeysToShow = React.useMemo(() => {
    if (!drillClusterKey) return clusterKeys;
    if (clusterKeys.includes(drillClusterKey)) return [drillClusterKey];
    return clusterKeys;
  }, [clusterKeys, drillClusterKey]);

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

  const [approveRow, setApproveRow] = React.useState<OperatorRow | null>(null);
  const [approveSubmitting, setApproveSubmitting] = React.useState(false);
  const [approveError, setApproveError] = React.useState<string | null>(null);

  const { catalogSources, loadingCs, csError } = useClusterCatalogSources(
    editModalOpen && editClusterKey ? editClusterKey : undefined,
  );

  React.useEffect(() => {
    setExpanded((prev) => {
      const next = { ...prev };
      for (const c of clusterKeys) {
        if (next[c] === undefined) {
          next[c] = drillClusterKey ? c === drillClusterKey : !lazy;
        }
      }
      return next;
    });
  }, [clusterKeys, drillClusterKey, lazy]);

  const toggleCluster = (name: string) => {
    setExpanded((e) => ({ ...e, [name]: !(e[name] ?? !lazy) }));
  };

  // Searching in Search mode: when only a few clusters match, open them so the hits are visible.
  React.useEffect(() => {
    if (!lazy || !searchText.trim() || clusterKeys.length === 0 || clusterKeys.length > 3) return;
    setExpanded((prev) => {
      const next = { ...prev };
      for (const c of clusterKeys) next[c] = true;
      return next;
    });
  }, [lazy, searchText, clusterKeys]);

  // In Search mode, load a cluster's details as soon as it is expanded.
  React.useEffect(() => {
    if (!lazy) return;
    for (const [display, list] of byCluster) {
      if (expanded[display] && list[0]) clusterDetail.load(list[0].clusterKey);
    }
    // `clusterDetail.load` changes with the epoch, which is what we want to re-run on
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lazy, expanded, byCluster, clusterDetail.load]);

  const safeToggleId = (name: string) =>
    `managed-op-cluster-${name.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

  const openEditPolicy = React.useCallback(
    async (r: OperatorRow) => {
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
          setEditFetchError(t('installed_err_annotation_missing'));
          setEditPolicy(null);
        } else {
          setEditPolicy(policy);
        }
      } catch (e) {
        setEditFetchError(t('installed_err_load_policy', { error: String(e) }));
        setEditPolicy(null);
      } finally {
        setEditLoading(false);
      }
    },
    [canEditPlugin, t],
  );

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

  const openApprove = React.useCallback((r: OperatorRow) => {
    setApproveError(null);
    setApproveRow(r);
  }, []);

  const closeMigrateModal = () => {
    if (migrateSubmitting) return;
    setMigrateRow(null);
    setMigrateError(null);
  };

  const closeApproveModal = () => {
    if (approveSubmitting) return;
    setApproveRow(null);
    setApproveError(null);
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
      clearManagedOperatorsGetCache();
      setSubscriptionListEpoch((n) => n + 1);
      setEditSuccess(t('installed_migration_success', { namespace: refNs, name: refName }));
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

  const confirmApproveInstallPlan = async () => {
    if (!approveRow) return;
    const row = approveRow;
    const ip = row.installPlanRef;
    if (!ip) return;
    setApproveSubmitting(true);
    setApproveError(null);
    const url = clusterApiPath(
      row.clusterKey,
      `/apis/operators.coreos.com/v1alpha1/namespaces/${encodeURIComponent(ip.namespace)}/installplans/${encodeURIComponent(ip.name)}`,
    );
    try {
      await consoleFetchJSON(url, 'PATCH', {
        headers: { 'Content-Type': 'application/merge-patch+json' },
        body: JSON.stringify({ spec: { approved: true } }),
      });
      setApproveRow(null);
      clearManagedOperatorsGetCache();
      setSubscriptionListEpoch((n) => n + 1);
      setEditSuccess(
        t('installed_approve_success', {
          cluster: row.clusterDisplayName,
          name: ip.name,
          namespace: ip.namespace,
        }),
      );
    } catch (e) {
      setApproveError(String(e));
    } finally {
      setApproveSubmitting(false);
    }
  };

  const confirmUninstall = async () => {
    if (!uninstallRow) return;
    const row = uninstallRow;
    setUninstallSubmitting(true);
    setUninstallError(null);
    try {
      let removedPolicy = false;
      if (row.operatorPolicyRef) {
        removedPolicy = await deletePluginOperatorPolicyIfPresent(
          row.clusterKey,
          row.operatorPolicyRef,
        );
      }
      const subUrl = clusterApiPath(
        row.clusterKey,
        `/apis/operators.coreos.com/v1alpha1/namespaces/${encodeURIComponent(row.namespace)}/subscriptions/${encodeURIComponent(row.name)}`,
      );
      await consoleFetchJSON.delete(subUrl);
      setUninstallRow(null);
      clearManagedOperatorsGetCache();
      setSubscriptionListEpoch((n) => n + 1);
      if (removedPolicy && row.operatorPolicyRef) {
        setEditSuccess(
          t('installed_uninstall_success_both', {
            policyNs: row.operatorPolicyRef.namespace,
            policyName: row.operatorPolicyRef.name,
            subNs: row.namespace,
            subName: row.name,
          }),
        );
      } else if (row.operatorPolicyRef && !removedPolicy) {
        setEditSuccess(
          t('installed_uninstall_success_policy_kept', {
            subNs: row.namespace,
            subName: row.name,
            policyNs: row.operatorPolicyRef.namespace,
            policyName: row.operatorPolicyRef.name,
          }),
        );
      } else {
        setEditSuccess(
          t('installed_uninstall_success_sub_only', {
            subNs: row.namespace,
            subName: row.name,
          }),
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
      <DocumentTitle>{t('installed_document_title')}</DocumentTitle>
      <div className="pf-v6-u-px-lg pf-v6-u-pt-lg pf-v6-u-pb-sm">
        <Title headingLevel="h1">{t('installed_heading')}</Title>
        <p className="pf-v6-u-mt-sm">{t('installed_intro')}</p>
      </div>

      <div className="pf-v6-u-px-lg pf-v6-u-pb-lg">
        <Card>
          <CardBody>
            {!loaded && (
              <div className="pf-v6-u-text-align-center pf-v6-u-p-xl">
                <Spinner aria-label={t('installed_loading_aria')} />
              </div>
            )}

            {loadError && (
              <Alert
                className="pf-v6-u-mb-md"
                variant="warning"
                title={t('installed_alert_load_title')}
              >
                {String(loadError)}
                <p className="pf-v6-u-mt-sm">{t('installed_alert_load_body')}</p>
              </Alert>
            )}

            {editSuccess && (
              <Alert
                className="pf-v6-u-mb-md"
                variant="success"
                isInline
                title={t('installed_alert_success_title')}
              >
                {editSuccess}
              </Alert>
            )}

            {loaded && clusterNames.length === 0 && rows.length === 0 && !loadError && (
              <EmptyState icon={CubesIcon} titleText={t('installed_empty_title_clusters')}>
                <EmptyStateBody>{t('installed_empty_body_clusters')}</EmptyStateBody>
              </EmptyState>
            )}

            {loaded && clusterNames.length > 0 && rows.length === 0 && !loadError && (
              <EmptyState icon={CubesIcon} titleText={t('installed_empty_title_subs')}>
                <EmptyStateBody>{t('installed_empty_body_subs')}</EmptyStateBody>
              </EmptyState>
            )}

            {readOnly && (
              <Alert
                className="pf-v6-u-mb-md"
                variant="info"
                isInline
                title={t('readonly_banner_installed')}
              />
            )}

            {searchWanted && searchState.loaded && searchState.unavailable && (
              <Alert
                className="pf-v6-u-mb-md"
                variant="info"
                isInline
                title={t('overview_search_fallback_title')}
              >
                {t('overview_search_fallback_body')}
              </Alert>
            )}

            {lazy && (
              <Alert
                className="pf-v6-u-mb-md"
                variant="info"
                isInline
                title={t('installed_lazy_banner')}
              />
            )}

            {lazy &&
              Object.entries(clusterDetail.errors).map(([cluster, err]) => (
                <Alert
                  key={cluster}
                  className="pf-v6-u-mb-md"
                  variant="warning"
                  isInline
                  title={t('installed_lazy_detail_error', { cluster, error: String(err) })}
                />
              ))}

            {loaded && rows.length > 0 && (
              <div className="pf-v6-u-display-flex pf-v6-u-align-items-center pf-v6-u-column-gap-md pf-v6-u-mb-md">
                <SearchInput
                  placeholder={t('installed_search_placeholder')}
                  aria-label={t('installed_search_aria')}
                  value={searchDraft}
                  onChange={(_e, v) => applySearch(v)}
                  onClear={() => applySearch('')}
                  resultsCount={searchText.trim() ? visibleRows.length : undefined}
                />
                <Button
                  variant="secondary"
                  data-test="installed-export-csv"
                  isDisabled={visibleRows.length === 0}
                  onClick={() =>
                    downloadCsv(csvFilename('installed-operators'), operatorsCsv(visibleRows))
                  }
                >
                  {t('export_csv')}
                </Button>
              </div>
            )}

            {loaded && activeFilter && (
              <Alert
                className="pf-v6-u-mb-md"
                variant="info"
                isInline
                title={t('installed_filter_active', {
                  filter: t(`installed_filter_${activeFilter}`),
                  count: visibleRows.length,
                })}
                actionLinks={
                  <Button variant="link" isInline onClick={clearFilter}>
                    {t('installed_filter_clear')}
                  </Button>
                }
              />
            )}

            {loaded &&
              rows.length > 0 &&
              visibleRows.length === 0 &&
              (activeFilter || searchText.trim()) && (
                <EmptyState
                  icon={CubesIcon}
                  titleText={
                    searchText.trim() ? t('installed_search_empty') : t('installed_filter_empty')
                  }
                >
                  {searchText.trim() && (
                    <EmptyStateBody>
                      <Button variant="link" onClick={() => applySearch('')}>
                        {t('installed_search_clear')}
                      </Button>
                    </EmptyStateBody>
                  )}
                </EmptyState>
              )}

            {loaded && rows.length > 0 && (
              <Accordion asDefinitionList={false} aria-label={t('installed_accordion_aria')}>
                {clusterKeysToShow.map((clusterDisplayName) => {
                  const clusterRows = byCluster.get(clusterDisplayName) ?? [];
                  const tid = safeToggleId(clusterDisplayName);
                  const isExpanded = expanded[clusterDisplayName] ?? !lazy;
                  return (
                    <AccordionItem key={clusterDisplayName} isExpanded={isExpanded}>
                      <AccordionToggle id={tid} onClick={() => toggleCluster(clusterDisplayName)}>
                        {clusterDisplayName}{' '}
                        <span className="pf-v6-u-text-color-subtle">
                          {t('installed_cluster_operators_count', { count: clusterRows.length })}
                        </span>
                      </AccordionToggle>
                      <AccordionContent
                        id={`${tid}-content`}
                        aria-labelledby={tid}
                        isCustomContent={true}
                      >
                        <div
                          className="pf-v6-u-w-100"
                          style={{ overflow: 'auto', maxWidth: '100%' }}
                        >
                          <Table
                            aria-label={t('installed_table_aria_cluster', {
                              cluster: clusterDisplayName,
                            })}
                            borders
                            gridBreakPoint=""
                          >
                            <Thead>
                              <Tr>
                                <Th>{t('installed_col_namespace')}</Th>
                                <Th>{t('installed_col_subscription')}</Th>
                                <Th>{t('installed_col_operator_policy')}</Th>
                                <Th>{t('installed_col_csv')}</Th>
                                <Th>{t('installed_col_version')}</Th>
                                <Th>{t('installed_col_csv_phase')}</Th>
                                <Th>{t('installed_col_approval')}</Th>
                                <Th>{t('installed_col_sub_status')}</Th>
                                <Th>{t('installed_col_upgrade')}</Th>
                                {!readOnly && (
                                  <Th modifier="nowrap">{t('installed_col_actions')}</Th>
                                )}
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
                                /** The subscription names an OperatorPolicy that is gone: it can be re-created through Migrate. */
                                const orphanPolicyRef =
                                  Boolean(r.operatorPolicyRef) &&
                                  !pluginMetaLoading &&
                                  isMissingPolicy(r);
                                const needsPolicy = !r.policyGovernanceManaged || orphanPolicyRef;
                                const showMigrate = needsPolicy && !r.migrationEnrollLabelRequested;
                                const showMigrationPending =
                                  needsPolicy && r.migrationEnrollLabelRequested;
                                return (
                                  <Tr key={`${r.clusterKey}/${r.namespace}/${r.name}`}>
                                    <Td dataLabel={t('installed_col_namespace')}>{r.namespace}</Td>
                                    <Td dataLabel={t('installed_col_subscription')}>{r.name}</Td>
                                    <Td dataLabel={t('installed_col_operator_policy')}>
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
                                            isInformRemediation(r) && (
                                              <Label
                                                color="teal"
                                                isCompact
                                                title={t('installed_inform_title')}
                                              >
                                                {t('installed_inform_label')}
                                              </Label>
                                            )}
                                          {!pluginMetaLoading &&
                                            r.operatorPolicyRef &&
                                            isMissingPolicy(r) && (
                                              <Label
                                                color="orange"
                                                isCompact
                                                title={t('installed_policy_missing_title')}
                                              >
                                                {t('installed_policy_missing_label')}
                                              </Label>
                                            )}
                                          {!pluginMetaLoading &&
                                            r.operatorPolicyRef &&
                                            isExternalGovernancePolicy(r) && (
                                              <Label
                                                color="grey"
                                                isCompact
                                                title={t('installed_external_title')}
                                              >
                                                {t('installed_external_label')}
                                              </Label>
                                            )}
                                        </span>
                                      ) : (
                                        '—'
                                      )}
                                    </Td>
                                    <Td dataLabel={t('installed_col_csv')}>
                                      <span className="pf-v6-u-font-family-monospace pf-v6-u-font-size-sm">
                                        {r.csvFullName}
                                      </span>
                                    </Td>
                                    <Td dataLabel={t('installed_col_version')}>{r.csvVersion}</Td>
                                    <Td dataLabel={t('installed_col_csv_phase')}>
                                      <CsvPhaseLabel
                                        succeeded={r.csvSucceeded}
                                        phase={r.csvPhase}
                                      />
                                    </Td>
                                    <Td dataLabel={t('installed_col_approval')}>
                                      {r.installPlanApproval}
                                    </Td>
                                    <Td dataLabel={t('installed_col_sub_status')}>
                                      {r.subscriptionStateDisplay}
                                    </Td>
                                    <Td dataLabel={t('installed_col_upgrade')}>
                                      {r.upgradePending ?? '—'}
                                    </Td>
                                    {!readOnly && (
                                      <Td dataLabel={t('installed_col_actions')} modifier="nowrap">
                                        <div
                                          className="pf-v6-u-display-inline-flex pf-v6-u-flex-nowrap pf-v6-u-align-items-center"
                                          style={{ gap: 'var(--pf-t--global--spacer--md)' }}
                                        >
                                          {(pluginMetaLoading && r.operatorPolicyRef) ||
                                          !detailLoaded(r) ? (
                                            <Spinner
                                              size="sm"
                                              aria-label={t('installed_spinner_policy_aria')}
                                            />
                                          ) : (
                                            <>
                                              {r.installPlanApprovalRequired &&
                                                r.installPlanRef && (
                                                  <GuardedButton
                                                    variant="primary"
                                                    size="sm"
                                                    allowed={can(
                                                      r.clusterKey,
                                                      access.approveInstallPlan(
                                                        r.installPlanRef.namespace,
                                                      ),
                                                    )}
                                                    onClick={() => openApprove(r)}
                                                  >
                                                    {t('installed_btn_approve_installplan')}
                                                  </GuardedButton>
                                                )}
                                              {showEdit && (
                                                <GuardedButton
                                                  variant="secondary"
                                                  size="sm"
                                                  allowed={
                                                    !r.operatorPolicyRef ||
                                                    can(
                                                      r.clusterKey,
                                                      access.updateOperatorPolicy(
                                                        r.operatorPolicyRef.namespace,
                                                      ),
                                                    )
                                                  }
                                                  onClick={() => openEditPolicy(r)}
                                                >
                                                  {t('installed_btn_edit_policy')}
                                                </GuardedButton>
                                              )}
                                              {showUninstall && (
                                                <GuardedButton
                                                  variant="danger"
                                                  size="sm"
                                                  allowed={can(
                                                    r.clusterKey,
                                                    access.deleteSubscription(r.namespace),
                                                  )}
                                                  onClick={() => openUninstall(r)}
                                                >
                                                  {t('installed_btn_uninstall')}
                                                </GuardedButton>
                                              )}
                                              {showMigrate && (
                                                <GuardedButton
                                                  variant="secondary"
                                                  size="sm"
                                                  allowed={can(
                                                    r.clusterKey,
                                                    access.patchSubscription(r.namespace),
                                                  )}
                                                  onClick={() => openMigrate(r)}
                                                >
                                                  {t('installed_btn_migrate')}
                                                </GuardedButton>
                                              )}
                                              {showMigrationPending && (
                                                <span className="pf-v6-u-font-size-sm pf-v6-u-text-color-subtle">
                                                  <Label color="blue" isCompact>
                                                    {t('installed_label_migration_pending')}
                                                  </Label>{' '}
                                                  <Button
                                                    variant="link"
                                                    isInline
                                                    component="a"
                                                    href={
                                                      r.installPrefillQuery
                                                        ? (() => {
                                                            const p = r.installPrefillQuery;
                                                            const q = new URLSearchParams();
                                                            q.set(MOP_Q.cluster, r.clusterKey);
                                                            q.set(MOP_Q.package, p.packageName);
                                                            q.set(
                                                              MOP_Q.subNs,
                                                              p.subscriptionNamespace,
                                                            );
                                                            if (p.channel)
                                                              q.set(MOP_Q.channel, p.channel);
                                                            if (p.source)
                                                              q.set(MOP_Q.catalogSource, p.source);
                                                            if (p.sourceNamespace) {
                                                              q.set(
                                                                MOP_Q.catalogSourceNs,
                                                                p.sourceNamespace,
                                                              );
                                                            }
                                                            q.set(
                                                              MOP_Q.approval,
                                                              p.installPlanApproval,
                                                            );
                                                            if (p.startingCSV) {
                                                              q.set(
                                                                MOP_Q.startingCsv,
                                                                p.startingCSV,
                                                              );
                                                            }
                                                            q.set(MOP_Q.policyNs, r.clusterKey);
                                                            return `/multicloud/ecosystem/install-operators?${q.toString()}`;
                                                          })()
                                                        : '/multicloud/ecosystem/install-operators'
                                                    }
                                                  >
                                                    {t('installed_btn_create_policy')}
                                                  </Button>
                                                </span>
                                              )}
                                            </>
                                          )}
                                        </div>
                                      </Td>
                                    )}
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

      <Modal variant={ModalVariant.small} isOpen={Boolean(approveRow)} onClose={closeApproveModal}>
        <ModalHeader title={t('installed_approve_modal_title')} />
        <ModalBody>
          {approveRow?.installPlanRef && (
            <>
              <p>
                {t('installed_approve_modal_body', {
                  installplan: `${approveRow.installPlanRef.namespace}/${approveRow.installPlanRef.name}`,
                  cluster: approveRow.clusterDisplayName,
                })}
              </p>
              {approveError && (
                <Alert
                  className="pf-v6-u-mt-md"
                  variant="danger"
                  isInline
                  title={t('installed_modal_error_title')}
                >
                  {approveError}
                </Alert>
              )}
            </>
          )}
        </ModalBody>
        <ModalFooter>
          <Button
            variant="primary"
            onClick={confirmApproveInstallPlan}
            isDisabled={approveSubmitting || !approveRow?.installPlanRef}
          >
            {approveSubmitting ? t('installed_btn_approving') : t('installed_btn_approve')}
          </Button>
          <Button variant="link" onClick={closeApproveModal} isDisabled={approveSubmitting}>
            {t('installed_btn_cancel')}
          </Button>
        </ModalFooter>
      </Modal>

      <Modal variant={ModalVariant.medium} isOpen={Boolean(migrateRow)} onClose={closeMigrateModal}>
        <ModalHeader title={t('installed_migration_modal_title')} />
        <ModalBody>
          {migrateRow && (
            <>
              <p>{t('installed_migration_intro')}</p>
              <p className="pf-v6-u-font-size-sm pf-v6-u-mt-md">
                {t('installed_migration_label_key')}{' '}
                <code className="pf-v6-u-font-family-monospace">
                  {SUBSCRIPTION_ENROLL_OPERATOR_POLICY_LABEL}
                </code>
                <br />
                {t('installed_migration_label_value')}{' '}
                <code className="pf-v6-u-font-family-monospace">true</code>
              </p>
              <p className="pf-v6-u-font-size-sm pf-v6-u-text-color-subtle pf-v6-u-mt-md">
                {t('installed_migration_cli')}{' '}
                <code className="pf-v6-u-font-family-monospace">
                  oc label subscription {migrateRow.name}{' '}
                  {SUBSCRIPTION_ENROLL_OPERATOR_POLICY_LABEL}=true -n {migrateRow.namespace}
                </code>
              </p>
              {migrateError && (
                <Alert
                  className="pf-v6-u-mt-md"
                  variant="danger"
                  isInline
                  title={t('installed_modal_error_title')}
                >
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
            {migrateSubmitting ? t('installed_btn_applying') : t('installed_btn_apply_label')}
          </Button>
          <Button variant="link" onClick={closeMigrateModal} isDisabled={migrateSubmitting}>
            {t('installed_btn_cancel')}
          </Button>
        </ModalFooter>
      </Modal>

      <Modal
        variant={ModalVariant.medium}
        isOpen={Boolean(uninstallRow)}
        onClose={closeUninstallModal}
      >
        <ModalHeader title={t('installed_modal_uninstall_title')} />
        <ModalBody>
          {uninstallRow && (
            <>
              <p>
                {t('installed_modal_uninstall_body', {
                  subscription: `${uninstallRow.namespace}/${uninstallRow.name}`,
                  cluster: uninstallRow.clusterDisplayName,
                })}
              </p>
              {uninstallRow.operatorPolicyManagedDisplay && (
                <Alert
                  className="pf-v6-u-mt-md"
                  variant="warning"
                  isInline
                  title={t('installed_modal_governance_title')}
                >
                  {t('installed_modal_governance_body')}
                </Alert>
              )}
              {uninstallRow && isExternalGovernancePolicy(uninstallRow) && (
                <Alert
                  className="pf-v6-u-mt-md"
                  variant="info"
                  isInline
                  title={t('installed_modal_hub_title')}
                >
                  {t('installed_modal_hub_body')}
                </Alert>
              )}
              {uninstallError && (
                <Alert
                  className="pf-v6-u-mt-md"
                  variant="danger"
                  isInline
                  title={t('installed_modal_error_title')}
                >
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
            {uninstallSubmitting ? t('installed_btn_removing') : t('installed_btn_uninstall')}
          </Button>
          <Button variant="link" onClick={closeUninstallModal} isDisabled={uninstallSubmitting}>
            {t('installed_btn_cancel')}
          </Button>
        </ModalFooter>
      </Modal>

      <Modal
        variant={ModalVariant.small}
        isOpen={editModalOpen && Boolean(editFetchError) && !editPolicy && !editLoading}
        onClose={closeEditModal}
      >
        <ModalHeader title={t('installed_modal_edit_title')} />
        <ModalBody>
          <Alert variant="danger" isInline title={t('installed_modal_error_title')}>
            {editFetchError}
          </Alert>
        </ModalBody>
        <ModalFooter>
          <Button variant="primary" onClick={closeEditModal}>
            {t('installed_btn_close')}
          </Button>
        </ModalFooter>
      </Modal>

      <OperatorPolicyFormModal
        key={editPolicy?.metadata?.uid ?? 'edit'}
        isOpen={editModalOpen && !editFetchError && (editLoading || Boolean(editPolicy))}
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
          clearManagedOperatorsGetCache();
          setSubscriptionListEpoch((n) => n + 1);
          closeEditModal();
        }}
      />
    </>
  );
};

export default MyCustomPage;
