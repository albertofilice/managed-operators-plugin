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
import type { PackageManifestKind, PackageManifestList } from '../types/packageManifest';
import type { OperatorPolicyKind } from '../types/operatorPolicy';
import { OperatorPolicyFormModal } from './OperatorPolicyFormModal';
import { clusterApiPath } from '../utils/clusterApi';
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
      const items = await listOperatorPoliciesForCluster(selectedCluster);
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
      <DocumentTitle>Install operators (OperatorPolicy)</DocumentTitle>
      <div className="pf-v6-u-px-lg pf-v6-u-pt-lg pf-v6-u-pb-sm">
        <Title headingLevel="h1">Install operators</Title>
        <p className="pf-v6-u-mt-sm">
          Browse <strong>PackageManifests</strong> on a managed cluster (same catalog as{' '}
          <code>oc get packagemanifest</code> on that cluster), then create an{' '}
          <strong>OperatorPolicy</strong> so the governance controller can install the operator there. See{' '}
          <a
            href="https://developers.redhat.com/articles/2024/08/08/getting-started-operatorpolicy"
            target="_blank"
            rel="noopener noreferrer"
          >
            Getting started with OperatorPolicy
          </a>
          .
        </p>
      </div>

      <div className="pf-v6-u-px-lg pf-v6-u-pb-lg">
        <Card>
          <CardBody>
            <Form className="pf-v6-u-mb-lg" maxWidth="900px">
              <FormGroup label="Managed cluster" fieldId="cluster-select">
                <FormSelect
                  id="cluster-select"
                  value={selectedCluster}
                  onChange={(_e, val) => {
                    setSelectedCluster(String(val));
                    setNameFilter('');
                    setProviderFilter('');
                    setCatalogFilter('');
                  }}
                  aria-label="Managed cluster"
                >
                  <FormSelectOption value="" label="Select a Ready cluster" />
                  {clusterNames.map((n) => (
                    <FormSelectOption key={n} value={n} label={n} />
                  ))}
                </FormSelect>
              </FormGroup>
              <FormGroup label="Filter by package name" fieldId="filter-pm">
                <TextInput
                  id="filter-pm"
                  value={nameFilter}
                  onChange={(_e, v) => setNameFilter(v)}
                  placeholder="Substring match on package name…"
                  isDisabled={!selectedCluster}
                />
                <FormHelperText>
                  Case-insensitive. The same package can appear multiple times (one row per catalog).
                </FormHelperText>
              </FormGroup>
              <FormGroup label="Filter by provider" fieldId="filter-provider">
                <FormSelect
                  id="filter-provider"
                  value={providerFilter}
                  onChange={(_e, v) => setProviderFilter(String(v))}
                  aria-label="Provider filter"
                  isDisabled={!selectedCluster || !packages.length}
                >
                  <FormSelectOption value="" label="All providers" />
                  {providerOptions.map((p) => (
                    <FormSelectOption key={p} value={p} label={p} />
                  ))}
                </FormSelect>
              </FormGroup>
              <FormGroup label="Filter by catalog" fieldId="filter-catalog">
                <FormSelect
                  id="filter-catalog"
                  value={catalogFilter}
                  onChange={(_e, v) => setCatalogFilter(String(v))}
                  aria-label="Catalog filter"
                  isDisabled={!selectedCluster || !packages.length}
                >
                  <FormSelectOption value="" label="All catalogs" />
                  {catalogOptions.map((c) => (
                    <FormSelectOption key={c} value={c} label={c} />
                  ))}
                </FormSelect>
              </FormGroup>
            </Form>

            {!selectedCluster && (
              <p className="pf-v6-u-text-color-subtle">Choose a cluster to load PackageManifests.</p>
            )}

            {selectedCluster && loadingPm && (
              <div className="pf-v6-u-text-align-center pf-v6-u-p-xl">
                <Spinner aria-label="Loading packages" />
              </div>
            )}

            {pmError && (
              <Alert variant="danger" title="Could not list PackageManifests">
                {String(pmError)}
              </Alert>
            )}

            {selectedCluster && !loadingPm && !pmError && (
              <p className="pf-v6-u-mb-md">
                <strong>{filtered.length}</strong> row(s){' '}
                {nameFilter.trim() || providerFilter || catalogFilter
                  ? 'matching filters'
                  : 'total'}
                .
                {loadingPolicies && (
                  <span className="pf-v6-u-ml-sm pf-v6-u-text-color-subtle">
                    <Spinner size="sm" className="pf-v6-u-mr-sm" />
                    Loading OperatorPolicies…
                  </span>
                )}
              </p>
            )}

            {selectedCluster && !loadingPm && !pmError && filtered.length > 0 && (
              <div className="pf-v6-u-w-100" style={{ overflow: 'auto', maxWidth: '100%' }}>
                  <Table aria-label="Package manifests" borders gridBreakPoint="">
                  <Thead>
                    <Tr>
                      <Th>Package</Th>
                      <Th>Catalog</Th>
                      <Th>Provider</Th>
                      <Th>Default / channels</Th>
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
                          <Td dataLabel="Package">
                            <span className="pf-v6-u-font-family-monospace">{pm.metadata?.name}</span>
                          </Td>
                          <Td dataLabel="Catalog">
                            <span className="pf-v6-u-font-family-monospace">{packageCatalogLabel(pm)}</span>
                          </Td>
                          <Td dataLabel="Provider">{pm.status?.provider?.name ?? '—'}</Td>
                          <Td dataLabel="Channels">{defaultChannels(pm)}</Td>
                          <Td dataLabel="Actions" modifier="fitContent">
                            {conflict && (
                              <span
                                className="pf-v6-u-mr-sm pf-v6-u-text-color-subtle"
                                title="Multiple plugin-managed OperatorPolicies match this package/catalog; verify on the cluster."
                              >
                                Conflict
                              </span>
                            )}
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => openInstallOrEdit(pm)}
                            >
                              {hasPlugin ? 'Edit OperatorPolicy' : 'Install via OperatorPolicy'}
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
              <Alert className="pf-v6-u-mt-md" variant="success" isInline title="Success">
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
          void refetchPolicies();
        }}
      />
    </>
  );
};

export default InstallOperatorsPage;
