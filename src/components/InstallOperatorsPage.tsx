import '../i18n/registerPluginLocales';
import * as React from 'react';
import {
  DocumentTitle,
  useK8sWatchResource,
  K8sResourceCommon,
  consoleFetchJSON,
} from '@openshift-console/dynamic-plugin-sdk';
import {
  Alert,
  Button,
  Card,
  CardBody,
  Form,
  FormGroup,
  FormHelperText,
  FormSelect,
  FormSelectOption,
  Spinner,
  TextInput,
  Title,
} from '@patternfly/react-core';
import {
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '@patternfly/react-table';
import { useTranslation } from 'react-i18next';
import type { PackageManifestKind, PackageManifestList } from '../types/packageManifest';
import type { OperatorPolicyKind } from '../types/operatorPolicy';
import { OperatorPolicyFormModal } from './OperatorPolicyFormModal';
import { clusterApiPath } from '../utils/clusterApi';
import { clearManagedOperatorsGetCache } from '../utils/managedOperatorsGetCache';
import { useClusterCatalogSources } from '../hooks/useClusterCatalogSources';
import { listOperatorPoliciesForCluster } from '../utils/listOperatorPolicies';
import { pluginPoliciesMatchingPackage } from '../utils/operatorPolicyMatch';

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

function defaultChannels(pm: PackageManifestKind): string {
  const ch = pm.status?.channels ?? [];
  const def = pm.status?.defaultChannel;
  if (def) return def;
  if (ch.length) return ch.map((c) => c.name).join(', ');
  return '—';
}

function packageCatalogLabel(pm: PackageManifestKind): string {
  const src = pm.status?.catalogSource?.trim();
  if (!src) return '—';
  const ns = pm.status?.catalogSourceNamespace?.trim();
  if (ns && ns !== 'openshift-marketplace') {
    return `${src} (${ns})`;
  }
  return src;
}

/** Stable row key: same package name can appear once per catalog. */
function packageRowKey(pm: PackageManifestKind): string {
  if (pm.metadata?.uid) return pm.metadata.uid;
  const n = pm.metadata?.name ?? '';
  const cs = pm.status?.catalogSource ?? '';
  const cns = pm.status?.catalogSourceNamespace ?? '';
  return `${n}\x1f${cs}\x1f${cns}`;
}

const InstallOperatorsPage: React.FC = () => {
  const { t } = useTranslation('plugin__managed-operators-plugin');
  const [clusters] = useK8sWatchResource<ManagedClusterKind[]>(managedClusterWatch);

  const clusterNames = React.useMemo(() => {
    const list = Array.isArray(clusters) ? clusters : [];
    return list.filter(clusterReady).map((c) => c.metadata?.name).filter(Boolean) as string[];
  }, [clusters]);

  const [selectedCluster, setSelectedCluster] = React.useState('');
  const [nameFilter, setNameFilter] = React.useState('');
  const [providerFilter, setProviderFilter] = React.useState('');
  const [catalogFilter, setCatalogFilter] = React.useState('');
  const [packages, setPackages] = React.useState<PackageManifestKind[]>([]);
  const [loadingPm, setLoadingPm] = React.useState(false);
  const [pmError, setPmError] = React.useState<unknown>();

  const [clusterPolicies, setClusterPolicies] = React.useState<OperatorPolicyKind[]>([]);
  const [loadingPolicies, setLoadingPolicies] = React.useState(false);

  const { catalogSources, loadingCs, csError } = useClusterCatalogSources(
    selectedCluster || undefined,
  );

  const [modalOpen, setModalOpen] = React.useState(false);
  const [modalMode, setModalMode] = React.useState<'create' | 'edit'>('create');
  const [selectedPkg, setSelectedPkg] = React.useState<PackageManifestKind | null>(null);
  const [editPolicy, setEditPolicy] = React.useState<OperatorPolicyKind | null>(null);
  const [submitOk, setSubmitOk] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!selectedCluster) {
      setPackages([]);
      return;
    }
    let cancelled = false;
    setLoadingPm(true);
    setPmError(undefined);
    (async () => {
      try {
        const path = clusterApiPath(
          selectedCluster,
          '/apis/packages.operators.coreos.com/v1/packagemanifests',
        );
        const list = (await consoleFetchJSON(path, 'GET')) as PackageManifestList;
        if (!cancelled) {
          setPackages(list.items ?? []);
        }
      } catch (e) {
        if (!cancelled) {
          setPmError(e);
          setPackages([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingPm(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCluster]);

  React.useEffect(() => {
    if (!selectedCluster) {
      setClusterPolicies([]);
      return;
    }
    let cancelled = false;
    setLoadingPolicies(true);
    (async () => {
      try {
        const items = await listOperatorPoliciesForCluster(selectedCluster);
        if (!cancelled) {
          setClusterPolicies(items);
        }
      } catch {
        if (!cancelled) {
          setClusterPolicies([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingPolicies(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCluster]);

  const refetchPolicies = React.useCallback(async () => {
    if (!selectedCluster) return;
    try {
      const items = await listOperatorPoliciesForCluster(selectedCluster, { bypassCache: true });
      setClusterPolicies(items);
    } catch {
      // ignore
    }
  }, [selectedCluster]);

  const providerOptions = React.useMemo(() => {
    const s = new Set<string>();
    packages.forEach((p) => {
      const n = p.status?.provider?.name?.trim();
      if (n) s.add(n);
    });
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [packages]);

  const catalogOptions = React.useMemo(() => {
    const s = new Set<string>();
    packages.forEach((p) => {
      const c = p.status?.catalogSource?.trim();
      if (c) s.add(c);
    });
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [packages]);

  const filtered = React.useMemo(() => {
    const q = nameFilter.trim().toLowerCase();
    return packages.filter((p) => {
      const pkgName = (p.metadata?.name ?? '').toLowerCase();
      if (q && !pkgName.includes(q)) return false;
      if (providerFilter) {
        const prov = (p.status?.provider?.name ?? '').trim();
        if (prov !== providerFilter) return false;
      }
      if (catalogFilter) {
        const cat = (p.status?.catalogSource ?? '').trim();
        if (cat !== catalogFilter) return false;
      }
      return true;
    });
  }, [packages, nameFilter, providerFilter, catalogFilter]);

  const openInstallOrEdit = (pm: PackageManifestKind) => {
    const matches = pluginPoliciesMatchingPackage(pm, clusterPolicies);
    setSubmitOk(null);
    setSelectedPkg(pm);
    if (matches.length === 1) {
      setModalMode('edit');
      setEditPolicy(matches[0]);
    } else if (matches.length > 1) {
      setModalMode('edit');
      setEditPolicy(matches[0]);
    } else {
      setModalMode('create');
      setEditPolicy(null);
    }
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditPolicy(null);
    setModalMode('create');
  };

  return (
    <>
      <DocumentTitle>{t('install_doc_title')}</DocumentTitle>
      <div className="pf-v6-u-px-lg pf-v6-u-pt-lg pf-v6-u-pb-sm">
        <Title headingLevel="h1">{t('install_heading')}</Title>
        <p className="pf-v6-u-mt-sm">
          {t('install_intro_before_link')}{' '}
          <a
            href="https://developers.redhat.com/articles/2024/08/08/getting-started-operatorpolicy"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('install_link_operatorpolicy')}
          </a>
          .
        </p>
      </div>

      <div className="pf-v6-u-px-lg pf-v6-u-pb-lg">
        <Card>
          <CardBody>
            <Form className="pf-v6-u-mb-lg" maxWidth="900px">
              <FormGroup label={t('install_label_managed_cluster')} fieldId="cluster-select">
                <FormSelect
                  id="cluster-select"
                  value={selectedCluster}
                  onChange={(_e, val) => {
                    setSelectedCluster(String(val));
                    setNameFilter('');
                    setProviderFilter('');
                    setCatalogFilter('');
                  }}
                  aria-label={t('install_aria_managed_cluster')}
                >
                  <FormSelectOption value="" label={t('install_placeholder_select_cluster')} />
                  {clusterNames.map((n) => (
                    <FormSelectOption key={n} value={n} label={n} />
                  ))}
                </FormSelect>
              </FormGroup>
              <FormGroup label={t('install_label_filter_package')} fieldId="filter-pm">
                <TextInput
                  id="filter-pm"
                  value={nameFilter}
                  onChange={(_e, v) => setNameFilter(v)}
                  placeholder={t('install_placeholder_filter_package')}
                  isDisabled={!selectedCluster}
                />
                <FormHelperText>{t('install_helper_filter_package')}</FormHelperText>
              </FormGroup>
              <FormGroup label={t('install_label_filter_provider')} fieldId="filter-provider">
                <FormSelect
                  id="filter-provider"
                  value={providerFilter}
                  onChange={(_e, v) => setProviderFilter(String(v))}
                  aria-label={t('install_aria_provider_filter')}
                  isDisabled={!selectedCluster || !packages.length}
                >
                  <FormSelectOption value="" label={t('install_option_all_providers')} />
                  {providerOptions.map((p) => (
                    <FormSelectOption key={p} value={p} label={p} />
                  ))}
                </FormSelect>
              </FormGroup>
              <FormGroup label={t('install_label_filter_catalog')} fieldId="filter-catalog">
                <FormSelect
                  id="filter-catalog"
                  value={catalogFilter}
                  onChange={(_e, v) => setCatalogFilter(String(v))}
                  aria-label={t('install_aria_catalog_filter')}
                  isDisabled={!selectedCluster || !packages.length}
                >
                  <FormSelectOption value="" label={t('install_option_all_catalogs')} />
                  {catalogOptions.map((c) => (
                    <FormSelectOption key={c} value={c} label={c} />
                  ))}
                </FormSelect>
              </FormGroup>
            </Form>

            {!selectedCluster && (
              <p className="pf-v6-u-text-color-subtle">{t('install_choose_cluster_hint')}</p>
            )}

            {selectedCluster && loadingPm && (
              <div className="pf-v6-u-text-align-center pf-v6-u-p-xl">
                <Spinner aria-label={t('install_loading_packages_aria')} />
              </div>
            )}

            {pmError && (
              <Alert variant="danger" title={t('install_err_list_pm_title')}>
                {String(pmError)}
              </Alert>
            )}

            {selectedCluster && !loadingPm && !pmError && (
              <p className="pf-v6-u-mb-md">
                <strong>{filtered.length}</strong>{' '}
                {t('install_row_word', { count: filtered.length })}{' '}
                {nameFilter.trim() || providerFilter || catalogFilter
                  ? t('install_summary_matching')
                  : t('install_summary_total')}
                .
                {loadingPolicies && (
                  <span className="pf-v6-u-ml-sm pf-v6-u-text-color-subtle">
                    <Spinner size="sm" className="pf-v6-u-mr-sm" />
                    {t('install_loading_policies')}
                  </span>
                )}
              </p>
            )}

            {selectedCluster && !loadingPm && !pmError && filtered.length > 0 && (
              <div className="pf-v6-u-w-100" style={{ overflow: 'auto', maxWidth: '100%' }}>
                  <Table aria-label={t('install_table_aria')} borders gridBreakPoint="">
                  <Thead>
                    <Tr>
                      <Th>{t('install_col_package')}</Th>
                      <Th>{t('install_col_catalog')}</Th>
                      <Th>{t('install_col_provider')}</Th>
                      <Th>{t('install_col_channels')}</Th>
                      <Th />
                    </Tr>
                  </Thead>
                  <Tbody>
                    {filtered.map((pm) => {
                      const matches = pluginPoliciesMatchingPackage(pm, clusterPolicies);
                      const conflict = matches.length > 1;
                      const hasPlugin = matches.length >= 1;
                      return (
                        <Tr key={packageRowKey(pm)}>
                          <Td dataLabel={t('install_col_package')}>
                            <span className="pf-v6-u-font-family-monospace">{pm.metadata?.name}</span>
                          </Td>
                          <Td dataLabel={t('install_col_catalog')}>
                            <span className="pf-v6-u-font-family-monospace">{packageCatalogLabel(pm)}</span>
                          </Td>
                          <Td dataLabel={t('install_col_provider')}>{pm.status?.provider?.name ?? '—'}</Td>
                          <Td dataLabel={t('install_col_channels')}>{defaultChannels(pm)}</Td>
                          <Td dataLabel={t('install_col_actions')} modifier="fitContent">
                            {conflict && (
                              <span
                                className="pf-v6-u-mr-sm pf-v6-u-text-color-subtle"
                                title={t('install_conflict_tooltip')}
                              >
                                {t('install_conflict_badge')}
                              </span>
                            )}
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => openInstallOrEdit(pm)}
                            >
                              {hasPlugin ? t('install_btn_edit_policy') : t('install_btn_install')}
                            </Button>
                          </Td>
                        </Tr>
                      );
                    })}
                  </Tbody>
                </Table>
              </div>
            )}

            {submitOk && (
              <Alert className="pf-v6-u-mt-md" variant="success" isInline title={t('install_alert_success_title')}>
                {submitOk}
              </Alert>
            )}
          </CardBody>
        </Card>
      </div>

      <OperatorPolicyFormModal
        key={
          modalMode === 'edit' && editPolicy?.metadata?.uid
            ? editPolicy.metadata.uid
            : selectedPkg
              ? packageRowKey(selectedPkg)
              : 'closed'
        }
        isOpen={modalOpen}
        onClose={closeModal}
        mode={modalMode}
        clusterName={selectedCluster}
        selectedPkg={modalMode === 'create' ? selectedPkg : null}
        catalogSources={catalogSources}
        loadingCs={loadingCs}
        csError={csError}
        initialPolicy={modalMode === 'edit' ? editPolicy : null}
        onSuccess={(msg) => {
          setSubmitOk(msg);
          clearManagedOperatorsGetCache();
          void refetchPolicies();
        }}
      />
    </>
  );
};

export default InstallOperatorsPage;
