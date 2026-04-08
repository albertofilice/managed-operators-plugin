import * as React from 'react';
import { consoleFetchJSON } from '@openshift-console/dynamic-plugin-sdk';
import {
  Alert,
  Button,
  ExpandableSection,
  Form,
  FormGroup,
  FormHelperText,
  FormSelect,
  FormSelectOption,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalVariant,
  Spinner,
  TextArea,
  TextInput,
} from '@patternfly/react-core';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { PackageManifestKind } from '../types/packageManifest';
import type { CatalogSourceKind } from '../types/catalogSource';
import type {
  ComplianceLevel,
  OperatorPolicyKind,
  RemovalBehaviorValue,
} from '../types/operatorPolicy';
import { TrashIcon } from '@patternfly/react-icons';
import { useTranslation } from 'react-i18next';
import { PLUGIN_CREATED_ANNOTATION } from '../constants/operatorPolicyPlugin';
import { clusterApiPath } from '../utils/clusterApi';
import { OP_POLICY_MANAGED_ANNOTATION } from '../utils/operatorPolicySubscriptionRef';

const COMPLIANCE_LEVELS: ComplianceLevel[] = ['Compliant', 'NonCompliant'];
const REMOVAL_OPTIONS: RemovalBehaviorValue[] = [
  'Delete',
  'Keep',
  'DeleteIfUnused',
  'Retain',
  'Prune',
];

type MatchLabelRow = { key: string; value: string };

export type OperatorPolicyFormModalProps = {
  isOpen: boolean;
  onClose: () => void;
  mode: 'create' | 'edit';
  clusterName: string;
  selectedPkg: PackageManifestKind | null;
  catalogSources: CatalogSourceKind[];
  loadingCs: boolean;
  csError: unknown;
  initialPolicy?: OperatorPolicyKind | null;
  editLoading?: boolean;
  onSuccess?: (message: string) => void;
};

function catalogNamespacesFromSources(catalogSources: CatalogSourceKind[]): string[] {
  const s = new Set<string>();
  catalogSources.forEach((c) => {
    const ns = c.metadata?.namespace;
    if (ns) s.add(ns);
  });
  const arr = Array.from(s).sort();
  return arr.length ? arr : ['openshift-marketplace'];
}

function defaultMatchLabels(): MatchLabelRow[] {
  return [{ key: '', value: '' }];
}

/**
 * Installed Operators / Overview treat a row as governance-managed when the Subscription has this
 * annotation (ACM usually sets it; we set it here so the UI updates without waiting on the controller).
 */
async function patchSubscriptionOperatorPolicyManagedLink(options: {
  clusterName: string;
  subscriptionNamespace: string;
  subscriptionName: string;
  policyNamespace: string;
  policyName: string;
}): Promise<void> {
  const {
    clusterName,
    subscriptionNamespace,
    subscriptionName,
    policyNamespace,
    policyName,
  } = options;
  const subUrl = clusterApiPath(
    clusterName,
    `/apis/operators.coreos.com/v1alpha1/namespaces/${encodeURIComponent(subscriptionNamespace)}/subscriptions/${encodeURIComponent(subscriptionName)}`,
  );
  await consoleFetchJSON(subUrl, 'PATCH', {
    headers: { 'Content-Type': 'application/merge-patch+json' },
    body: JSON.stringify({
      metadata: {
        annotations: {
          [OP_POLICY_MANAGED_ANNOTATION]: `${policyNamespace}/${policyName}`,
        },
      },
    }),
  });
}

export const OperatorPolicyFormModal: React.FC<OperatorPolicyFormModalProps> = ({
  isOpen,
  onClose,
  mode,
  clusterName,
  selectedPkg,
  catalogSources,
  loadingCs,
  csError,
  initialPolicy,
  editLoading,
  onSuccess,
}) => {
  const { t } = useTranslation('plugin__managed-operators-plugin');
  const [policyName, setPolicyName] = React.useState('');
  const [policyNamespace, setPolicyNamespace] = React.useState('');
  const [subscriptionNamespace, setSubscriptionNamespace] = React.useState('');
  const [channel, setChannel] = React.useState('');
  const [selectedSourceNamespace, setSelectedSourceNamespace] = React.useState('openshift-marketplace');
  const [selectedSourceName, setSelectedSourceName] = React.useState('redhat-operators');
  const [remediation, setRemediation] = React.useState<'inform' | 'enforce'>('inform');
  const [upgradeApproval, setUpgradeApproval] = React.useState<'Automatic' | 'None'>('Automatic');
  const [startingCSV, setStartingCSV] = React.useState('');
  const [versionsText, setVersionsText] = React.useState('');
  const [severity, setSeverity] = React.useState<'low' | 'medium' | 'high' | 'critical'>('medium');
  const [complianceType, setComplianceType] = React.useState<'musthave' | 'mustnothave'>('musthave');
  const [ccCatalog, setCcCatalog] = React.useState<ComplianceLevel>('Compliant');
  const [ccDeploy, setCcDeploy] = React.useState<ComplianceLevel>('NonCompliant');
  const [ccDeprec, setCcDeprec] = React.useState<ComplianceLevel>('Compliant');
  const [ccUpgrade, setCcUpgrade] = React.useState<ComplianceLevel>('Compliant');
  const [rbCsv, setRbCsv] = React.useState<RemovalBehaviorValue>('Delete');
  const [rbCrd, setRbCrd] = React.useState<RemovalBehaviorValue>('Keep');
  const [rbOg, setRbOg] = React.useState<RemovalBehaviorValue>('DeleteIfUnused');
  const [rbSub, setRbSub] = React.useState<RemovalBehaviorValue>('Delete');
  const [ogName, setOgName] = React.useState('');
  const [ogLabels, setOgLabels] = React.useState<MatchLabelRow[]>(defaultMatchLabels);
  const [subscriptionConfigYaml, setSubscriptionConfigYaml] = React.useState('');
  const [showSubConfig, setShowSubConfig] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  const catalogNamespaces = React.useMemo(
    () => catalogNamespacesFromSources(catalogSources),
    [catalogSources],
  );

  const catalogSourcesRef = React.useRef(catalogSources);
  catalogSourcesRef.current = catalogSources;

  const sourcesInSelectedNamespace = React.useMemo(
    () =>
      catalogSources.filter(
        (c) => (c.metadata?.namespace ?? '') === selectedSourceNamespace,
      ),
    [catalogSources, selectedSourceNamespace],
  );

  React.useEffect(() => {
    if (!isOpen) return;
    const names = sourcesInSelectedNamespace
      .map((c) => c.metadata?.name)
      .filter(Boolean) as string[];
    if (!names.length) return;
    if (!names.includes(selectedSourceName)) {
      setSelectedSourceName(names[0]);
    }
  }, [isOpen, sourcesInSelectedNamespace, selectedSourceName]);

  const resetForCreate = React.useCallback(
    (pm: PackageManifestKind) => {
      const cs = catalogSourcesRef.current;
      const pkgName = pm.metadata?.name ?? '';
      const name = pkgName || 'policy';
      setPolicyName(`${name}-policy`.replace(/[^a-z0-9-]/gi, '-').toLowerCase().slice(0, 200));
      setPolicyNamespace(clusterName || '');
      setSubscriptionNamespace(pkgName ? `${pkgName}-operator` : '');
      const chNames = (pm.status?.channels ?? []).map((c) => c.name);
      let ch = pm.status?.defaultChannel ?? chNames[0] ?? 'stable';
      if (chNames.length > 0 && !chNames.includes(ch)) {
        ch = chNames[0];
      }
      setChannel(ch);
      const rowCat = pm.status?.catalogSource?.trim();
      const rowCatNs = pm.status?.catalogSourceNamespace?.trim();
      if (rowCatNs) {
        setSelectedSourceNamespace(rowCatNs);
      } else if (cs[0]?.metadata?.namespace) {
        setSelectedSourceNamespace(cs[0].metadata.namespace);
      } else {
        setSelectedSourceNamespace('openshift-marketplace');
      }
      if (rowCat) {
        setSelectedSourceName(rowCat);
      } else {
        const preferred =
          cs.find((c) => c.metadata?.name === 'redhat-operators') ?? cs[0];
        setSelectedSourceName(preferred?.metadata?.name ?? 'redhat-operators');
      }
      setRemediation('inform');
      setUpgradeApproval('Automatic');
      setStartingCSV('');
      setVersionsText('');
      setSeverity('medium');
      setComplianceType('musthave');
      setCcCatalog('Compliant');
      setCcDeploy('NonCompliant');
      setCcDeprec('Compliant');
      setCcUpgrade('Compliant');
      setRbCsv('Delete');
      setRbCrd('Keep');
      setRbOg('DeleteIfUnused');
      setRbSub('Delete');
      setOgName('');
      setOgLabels(defaultMatchLabels());
      setSubscriptionConfigYaml('');
      setShowSubConfig(false);
      setSubmitError(null);
    },
    [clusterName],
  );

  React.useEffect(() => {
    if (!isOpen || mode !== 'create' || !selectedPkg) return;
    resetForCreate(selectedPkg);
  }, [isOpen, mode, selectedPkg, resetForCreate]);

  React.useEffect(() => {
    if (!isOpen || mode !== 'edit' || !initialPolicy) return;
    const meta = initialPolicy.metadata;
    const spec = initialPolicy.spec ?? {};
    setPolicyName(meta?.name ?? '');
    setPolicyNamespace(meta?.namespace ?? '');
    const sub = spec.subscription ?? {};
    setSubscriptionNamespace((sub.namespace ?? '').trim());
    setChannel((sub.channel ?? '').trim());
    setSelectedSourceNamespace((sub.sourceNamespace ?? 'openshift-marketplace').trim());
    setSelectedSourceName((sub.source ?? '').trim());
    setRemediation(spec.remediationAction === 'enforce' ? 'enforce' : 'inform');
    setUpgradeApproval(spec.upgradeApproval === 'None' ? 'None' : 'Automatic');
    setStartingCSV((sub.startingCSV ?? '').trim());
    setVersionsText((spec.versions ?? []).join(', '));
    setSeverity(spec.severity ?? 'medium');
    setComplianceType(spec.complianceType === 'mustnothave' ? 'mustnothave' : 'musthave');
    const cc = spec.complianceConfig;
    setCcCatalog(cc?.catalogSourceUnhealthy ?? 'Compliant');
    setCcDeploy(cc?.deploymentsUnavailable ?? 'NonCompliant');
    setCcDeprec(cc?.deprecationsPresent ?? 'Compliant');
    setCcUpgrade(cc?.upgradesAvailable ?? 'Compliant');
    const rb = spec.removalBehavior;
    setRbCsv((rb?.clusterServiceVersions as RemovalBehaviorValue) ?? 'Delete');
    setRbCrd((rb?.customResourceDefinitions as RemovalBehaviorValue) ?? 'Keep');
    setRbOg((rb?.operatorGroups as RemovalBehaviorValue) ?? 'DeleteIfUnused');
    setRbSub((rb?.subscriptions as RemovalBehaviorValue) ?? 'Delete');
    const og = spec.operatorGroup;
    setOgName((og?.name ?? '').trim());
    const ml = og?.selector?.matchLabels;
    if (ml && Object.keys(ml).length > 0) {
      setOgLabels(
        Object.entries(ml).map(([k, v]) => ({ key: k, value: String(v) })),
      );
    } else {
      setOgLabels(defaultMatchLabels());
    }
    if (sub.config && typeof sub.config === 'object' && Object.keys(sub.config).length > 0) {
      setSubscriptionConfigYaml(stringifyYaml(sub.config).trimEnd());
      setShowSubConfig(true);
    } else {
      setSubscriptionConfigYaml('');
      setShowSubConfig(false);
    }
    setSubmitError(null);
  }, [isOpen, mode, initialPolicy]);

  const buildBody = (): OperatorPolicyKind => {
    if (!selectedPkg && mode === 'create') {
      throw new Error(t('policy_modal_err_package_required'));
    }
    const pkgName = mode === 'edit' ? initialPolicy?.spec?.subscription?.name : selectedPkg?.metadata?.name;
    if (!pkgName?.trim()) {
      throw new Error(t('policy_modal_err_package_name_required'));
    }
    const versions = versionsText
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    let subscriptionConfig: Record<string, unknown> | undefined;
    if (subscriptionConfigYaml.trim()) {
      try {
        const parsed = parseYaml(subscriptionConfigYaml) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error(t('policy_modal_err_sub_config_not_object'));
        }
        subscriptionConfig = parsed as Record<string, unknown>;
      } catch (e) {
        throw new Error(
          t('policy_modal_err_invalid_sub_config_yaml', {
            detail: e instanceof Error ? e.message : String(e),
          }),
        );
      }
    }

    const matchLabels: Record<string, string> = {};
    for (const row of ogLabels) {
      const k = row.key.trim();
      if (k) {
        matchLabels[k] = row.value;
      }
    }
    const hasOg =
      ogName.trim() || Object.keys(matchLabels).length > 0;

    const spec: OperatorPolicyKind['spec'] = {
      remediationAction: remediation,
      severity,
      complianceType,
      complianceConfig: {
        catalogSourceUnhealthy: ccCatalog,
        deploymentsUnavailable: ccDeploy,
        deprecationsPresent: ccDeprec,
        upgradesAvailable: ccUpgrade,
      },
      removalBehavior: {
        clusterServiceVersions: rbCsv,
        customResourceDefinitions: rbCrd,
        operatorGroups: rbOg,
        subscriptions: rbSub,
      },
      subscription: {
        name: pkgName.trim(),
        namespace: subscriptionNamespace.trim(),
        channel: channel.trim(),
        source: selectedSourceName.trim(),
        sourceNamespace: selectedSourceNamespace.trim(),
      },
      upgradeApproval,
    };

    if (startingCSV.trim()) {
      spec.subscription!.startingCSV = startingCSV.trim();
    }
    if (subscriptionConfig) {
      spec.subscription!.config = subscriptionConfig;
    }
    if (hasOg) {
      spec.operatorGroup = {
        name: ogName.trim() || undefined,
        namespace: subscriptionNamespace.trim() || undefined,
        selector:
          Object.keys(matchLabels).length > 0 ? { matchLabels } : undefined,
      };
    }
    if (versions.length) {
      spec.versions = versions;
    }

    const body: OperatorPolicyKind = {
      apiVersion: 'policy.open-cluster-management.io/v1beta1',
      kind: 'OperatorPolicy',
      metadata:
        mode === 'edit' && initialPolicy?.metadata
          ? {
              ...initialPolicy.metadata,
              name: policyName.trim(),
              namespace: policyNamespace.trim(),
            }
          : {
              name: policyName.trim(),
              namespace: policyNamespace.trim(),
              annotations: {
                [PLUGIN_CREATED_ANNOTATION]: 'true',
              },
            },
      spec,
    };

    if (mode === 'edit') {
      delete (body as { status?: unknown }).status;
    }

    return body;
  };

  const submit = async () => {
    if (!clusterName) return;
    if (!policyName.trim() || !policyNamespace.trim()) {
      setSubmitError(t('policy_modal_submit_err_name_ns'));
      return;
    }
    if (!subscriptionNamespace.trim()) {
      setSubmitError(t('policy_modal_submit_err_sub_ns'));
      return;
    }
    if (!selectedSourceName.trim() || !selectedSourceNamespace.trim()) {
      setSubmitError(t('policy_modal_submit_err_catalog'));
      return;
    }
    if (!channel.trim()) {
      setSubmitError(t('policy_modal_submit_err_channel'));
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    let body: OperatorPolicyKind;
    try {
      body = buildBody();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
      return;
    }

    const base = clusterApiPath(
      clusterName,
      `/apis/policy.open-cluster-management.io/v1beta1/namespaces/${encodeURIComponent(policyNamespace.trim())}/operatorpolicies`,
    );
    const url =
      mode === 'edit'
        ? `${base}/${encodeURIComponent(policyName.trim())}`
        : base;

    const polNs = policyNamespace.trim();
    const polNm = policyName.trim();
    const subSpec = body.spec?.subscription;

    try {
      if (mode === 'create') {
        await consoleFetchJSON.post(url, body);
      } else {
        await consoleFetchJSON.put(url, body);
      }

      let successMsg =
        mode === 'create'
          ? t('policy_modal_success_created', {
              namespace: polNs,
              name: polNm,
              cluster: clusterName,
            })
          : t('policy_modal_success_updated', {
              namespace: polNs,
              name: polNm,
              cluster: clusterName,
            });

      if (subSpec?.name && subSpec?.namespace && polNs && polNm) {
        try {
          await patchSubscriptionOperatorPolicyManagedLink({
            clusterName,
            subscriptionNamespace: subSpec.namespace,
            subscriptionName: subSpec.name,
            policyNamespace: polNs,
            policyName: polNm,
          });
        } catch (linkErr) {
          successMsg = `${successMsg} ${t('policy_modal_warn_sub_link', { error: String(linkErr) })}`;
        }
      }

      onSuccess?.(successMsg);
      onClose();
    } catch (e) {
      setSubmitError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const pkgLabel = selectedPkg?.metadata?.name ?? initialPolicy?.spec?.subscription?.name ?? '—';

  return (
    <Modal
      variant={ModalVariant.large}
      isOpen={isOpen}
      onClose={() => !submitting && !editLoading && onClose()}
    >
      <ModalHeader
        title={mode === 'create' ? t('policy_modal_title_create') : t('policy_modal_title_edit')}
        description={
          mode === 'create'
            ? t('policy_modal_desc_package', { package: pkgLabel })
            : t('policy_modal_desc_edit', { namespace: policyNamespace, name: policyName })
        }
      />
      <ModalBody>
        {editLoading && (
          <div className="pf-v6-u-text-align-center pf-v6-u-p-md">
            <Spinner /> {t('policy_modal_loading_policy')}
          </div>
        )}
        {!editLoading && (
          <Form>
            {mode === 'create' && (
              <p>
                {t('policy_modal_label_package_display')}: <strong>{pkgLabel}</strong>
              </p>
            )}
            {submitError && (
              <Alert
                className="pf-v6-u-mb-md"
                variant="danger"
                isInline
                title={t('policy_modal_alert_error_title')}
              >
                {submitError}
              </Alert>
            )}
            <FormGroup label={t('policy_modal_label_policy_name')} isRequired fieldId="pol-name">
              <TextInput
                id="pol-name"
                value={policyName}
                onChange={(_e, v) => setPolicyName(v)}
                isDisabled={mode === 'edit'}
              />
            </FormGroup>
            <FormGroup label={t('policy_modal_label_policy_ns')} isRequired fieldId="pol-ns">
              <TextInput
                id="pol-ns"
                value={policyNamespace}
                onChange={(_e, v) => setPolicyNamespace(v)}
                isDisabled={mode === 'edit'}
              />
              <FormHelperText>{t('policy_modal_helper_policy_ns')}</FormHelperText>
            </FormGroup>
            <FormGroup label={t('policy_modal_label_sub_ns')} isRequired fieldId="sub-ns">
              <TextInput
                id="sub-ns"
                value={subscriptionNamespace}
                onChange={(_e, v) => setSubscriptionNamespace(v)}
              />
              <FormHelperText>{t('policy_modal_helper_sub_ns')}</FormHelperText>
            </FormGroup>
            <FormGroup label={t('policy_modal_channel')} isRequired fieldId="ch">
              {(selectedPkg?.status?.channels?.length ?? 0) > 0 ? (
                <FormSelect
                  id="ch"
                  value={channel}
                  onChange={(_e, v) => setChannel(String(v))}
                  aria-label={t('policy_modal_aria_channel')}
                >
                  {(selectedPkg?.status?.channels ?? []).map((c) => (
                    <FormSelectOption key={c.name} value={c.name} label={c.name} />
                  ))}
                </FormSelect>
              ) : (
                <TextInput id="ch" value={channel} onChange={(_e, v) => setChannel(v)} />
              )}
            </FormGroup>
            <FormGroup label={t('policy_modal_label_catalog_ns')} isRequired fieldId="cat-ns">
              {loadingCs && (
                <FormHelperText>
                  <Spinner size="sm" className="pf-v6-u-mr-sm" /> {t('policy_modal_loading_catalogs')}
                </FormHelperText>
              )}
              {csError && (
                <Alert
                  className="pf-v6-u-mb-sm"
                  variant="warning"
                  isInline
                  title={t('policy_modal_alert_catalog_title')}
                >
                  {t('policy_modal_alert_catalog_body', { error: String(csError) })}
                </Alert>
              )}
              <FormSelect
                id="cat-ns"
                value={selectedSourceNamespace}
                onChange={(_e, v) => setSelectedSourceNamespace(String(v))}
                aria-label={t('policy_modal_aria_catalog_ns')}
              >
                {catalogNamespaces.map((ns) => (
                  <FormSelectOption key={ns} value={ns} label={ns} />
                ))}
              </FormSelect>
            </FormGroup>
            <FormGroup label={t('policy_modal_label_catalog_src')} isRequired fieldId="cat-src">
              {sourcesInSelectedNamespace.length > 0 ? (
                <FormSelect
                  id="cat-src"
                  value={selectedSourceName}
                  onChange={(_e, v) => setSelectedSourceName(String(v))}
                  aria-label={t('policy_modal_aria_catalog_src')}
                >
                  {sourcesInSelectedNamespace.map((cs) => {
                    const n = cs.metadata?.name ?? '';
                    const disp = cs.spec?.displayName ?? n;
                    return (
                      <FormSelectOption
                        key={n}
                        value={n}
                        label={disp === n ? n : `${disp} (${n})`}
                      />
                    );
                  })}
                </FormSelect>
              ) : (
                <TextInput
                  id="cat-src"
                  value={selectedSourceName}
                  onChange={(_e, v) => setSelectedSourceName(v)}
                />
              )}
            </FormGroup>

            <ExpandableSection toggleText={t('policy_modal_expand_compliance')}>
              <FormGroup label={t('policy_modal_label_severity')} fieldId="sev">
                <FormSelect
                  id="sev"
                  value={severity}
                  onChange={(_e, v) => setSeverity(v as typeof severity)}
                >
                  <FormSelectOption value="low" label="low" />
                  <FormSelectOption value="medium" label="medium" />
                  <FormSelectOption value="high" label="high" />
                  <FormSelectOption value="critical" label="critical" />
                </FormSelect>
              </FormGroup>
              <FormGroup label={t('policy_modal_label_compliance_type')} fieldId="ct">
                <FormSelect
                  id="ct"
                  value={complianceType}
                  onChange={(_e, v) => setComplianceType(v as 'musthave' | 'mustnothave')}
                >
                  <FormSelectOption value="musthave" label="musthave" />
                  <FormSelectOption value="mustnothave" label="mustnothave" />
                </FormSelect>
              </FormGroup>
              <FormGroup label={t('policy_modal_compliance_catalog')} fieldId="cc-cat">
                <FormSelect
                  id="cc-cat"
                  value={ccCatalog}
                  onChange={(_e, v) => setCcCatalog(v as ComplianceLevel)}
                >
                  {COMPLIANCE_LEVELS.map((c) => (
                    <FormSelectOption key={c} value={c} label={c} />
                  ))}
                </FormSelect>
              </FormGroup>
              <FormGroup label={t('policy_modal_compliance_deploy')} fieldId="cc-dep">
                <FormSelect
                  id="cc-dep"
                  value={ccDeploy}
                  onChange={(_e, v) => setCcDeploy(v as ComplianceLevel)}
                >
                  {COMPLIANCE_LEVELS.map((c) => (
                    <FormSelectOption key={c} value={c} label={c} />
                  ))}
                </FormSelect>
              </FormGroup>
              <FormGroup label={t('policy_modal_compliance_depr')} fieldId="cc-depr">
                <FormSelect
                  id="cc-depr"
                  value={ccDeprec}
                  onChange={(_e, v) => setCcDeprec(v as ComplianceLevel)}
                >
                  {COMPLIANCE_LEVELS.map((c) => (
                    <FormSelectOption key={c} value={c} label={c} />
                  ))}
                </FormSelect>
              </FormGroup>
              <FormGroup label={t('policy_modal_compliance_upgrade')} fieldId="cc-upg">
                <FormSelect
                  id="cc-upg"
                  value={ccUpgrade}
                  onChange={(_e, v) => setCcUpgrade(v as ComplianceLevel)}
                >
                  {COMPLIANCE_LEVELS.map((c) => (
                    <FormSelectOption key={c} value={c} label={c} />
                  ))}
                </FormSelect>
              </FormGroup>
              <FormGroup label={t('policy_modal_label_removal_csv')} fieldId="rb-csv">
                <FormSelect
                  id="rb-csv"
                  value={rbCsv}
                  onChange={(_e, v) => setRbCsv(v as RemovalBehaviorValue)}
                >
                  {REMOVAL_OPTIONS.map((c) => (
                    <FormSelectOption key={c} value={c} label={c} />
                  ))}
                </FormSelect>
              </FormGroup>
              <FormGroup label={t('policy_modal_label_removal_crd')} fieldId="rb-crd">
                <FormSelect
                  id="rb-crd"
                  value={rbCrd}
                  onChange={(_e, v) => setRbCrd(v as RemovalBehaviorValue)}
                >
                  {REMOVAL_OPTIONS.map((c) => (
                    <FormSelectOption key={c} value={c} label={c} />
                  ))}
                </FormSelect>
              </FormGroup>
              <FormGroup label={t('policy_modal_label_removal_og')} fieldId="rb-og">
                <FormSelect
                  id="rb-og"
                  value={rbOg}
                  onChange={(_e, v) => setRbOg(v as RemovalBehaviorValue)}
                >
                  {REMOVAL_OPTIONS.map((c) => (
                    <FormSelectOption key={c} value={c} label={c} />
                  ))}
                </FormSelect>
              </FormGroup>
              <FormGroup label={t('policy_modal_label_removal_sub')} fieldId="rb-sub">
                <FormSelect
                  id="rb-sub"
                  value={rbSub}
                  onChange={(_e, v) => setRbSub(v as RemovalBehaviorValue)}
                >
                  {REMOVAL_OPTIONS.map((c) => (
                    <FormSelectOption key={c} value={c} label={c} />
                  ))}
                </FormSelect>
              </FormGroup>
            </ExpandableSection>

            <ExpandableSection toggleText={t('policy_modal_expand_og')}>
              <FormHelperText className="pf-v6-u-mb-md">
                {t('policy_modal_helper_og_intro')}
              </FormHelperText>
              <FormGroup label={t('policy_modal_label_og_name')} fieldId="og-name">
                <TextInput id="og-name" value={ogName} onChange={(_e, v) => setOgName(v)} />
              </FormGroup>
              <FormGroup label={t('policy_modal_label_og_ns')} fieldId="og-ns">
                <TextInput
                  id="og-ns"
                  value={subscriptionNamespace}
                  readOnlyVariant="default"
                  aria-label={t('policy_modal_aria_og_ns')}
                />
                <FormHelperText>{t('policy_modal_helper_og_ns')}</FormHelperText>
              </FormGroup>
              <FormGroup label={t('policy_modal_label_og_match')} fieldId="og-ml">
                {ogLabels.map((row, i) => (
                  <div
                    key={i}
                    className="pf-v6-u-display-flex pf-v6-u-gap-md pf-v6-u-align-items-center pf-v6-u-mb-sm"
                  >
                    <div style={{ flex: '1 1 0', minWidth: 0 }}>
                      <TextInput
                        aria-label={t('policy_modal_aria_label_key')}
                        placeholder={t('policy_modal_placeholder_key')}
                        value={row.key}
                        onChange={(_e, v) => {
                          const next = [...ogLabels];
                          next[i] = { ...next[i], key: v };
                          setOgLabels(next);
                        }}
                      />
                    </div>
                    <div style={{ flex: '1 1 0', minWidth: 0 }}>
                      <TextInput
                        aria-label={t('policy_modal_aria_label_value')}
                        placeholder={t('policy_modal_placeholder_value')}
                        value={row.value}
                        onChange={(_e, v) => {
                          const next = [...ogLabels];
                          next[i] = { ...next[i], value: v };
                          setOgLabels(next);
                        }}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="plain"
                      icon={<TrashIcon />}
                      aria-label={t('policy_modal_aria_remove_label')}
                      title={t('policy_modal_remove_label_title')}
                      onClick={() => setOgLabels(ogLabels.filter((_, j) => j !== i))}
                    />
                  </div>
                ))}
                <Button
                  variant="secondary"
                  className="pf-v6-u-mt-sm"
                  onClick={() => setOgLabels([...ogLabels, { key: '', value: '' }])}
                >
                  {t('policy_modal_add_label')}
                </Button>
              </FormGroup>
            </ExpandableSection>

            {!showSubConfig && (
              <div className="pf-v6-u-mb-lg">
                <Button variant="secondary" onClick={() => setShowSubConfig(true)}>
                  {t('policy_modal_add_custom_config')}
                </Button>
                <FormHelperText className="pf-v6-u-mt-sm">
                  {t('policy_modal_helper_custom_config')}
                </FormHelperText>
              </div>
            )}
            {showSubConfig && (
              <FormGroup label={t('policy_modal_label_sub_cfg_yaml')} fieldId="sub-cfg-yaml">
                <FormHelperText className="pf-v6-u-mb-md">
                  {t('policy_modal_helper_sub_cfg_yaml')}
                </FormHelperText>
                <TextArea
                  id="sub-cfg-yaml"
                  value={subscriptionConfigYaml}
                  onChange={(_e, v) => setSubscriptionConfigYaml(v)}
                  rows={12}
                  className="pf-v6-u-font-family-monospace"
                />
                <Button
                  variant="link"
                  className="pf-v6-u-pl-0"
                  onClick={() => {
                    setShowSubConfig(false);
                    setSubscriptionConfigYaml('');
                  }}
                >
                  {t('policy_modal_btn_remove_custom_config')}
                </Button>
              </FormGroup>
            )}

            <FormGroup label={t('policy_modal_label_remediation')} fieldId="rem">
              <FormSelect
                id="rem"
                value={remediation}
                onChange={(_e, v) => setRemediation(v as 'inform' | 'enforce')}
              >
                <FormSelectOption value="inform" label={t('policy_modal_remediation_inform')} />
                <FormSelectOption value="enforce" label={t('policy_modal_remediation_enforce')} />
              </FormSelect>
            </FormGroup>
            <FormGroup label={t('policy_modal_label_upgrade_approval')} fieldId="ua">
              <FormSelect
                id="ua"
                value={upgradeApproval}
                onChange={(_e, v) => setUpgradeApproval(v as 'Automatic' | 'None')}
              >
                <FormSelectOption value="Automatic" label={t('policy_modal_upgrade_automatic')} />
                <FormSelectOption value="None" label={t('policy_modal_upgrade_none')} />
              </FormSelect>
            </FormGroup>
            <FormGroup label={t('policy_modal_label_starting_csv')} fieldId="csv">
              <TextInput id="csv" value={startingCSV} onChange={(_e, v) => setStartingCSV(v)} />
            </FormGroup>
            <FormGroup label={t('policy_modal_label_allowed_versions')} fieldId="vers">
              <TextInput id="vers" value={versionsText} onChange={(_e, v) => setVersionsText(v)} />
              <FormHelperText>{t('policy_modal_helper_allowed_versions')}</FormHelperText>
            </FormGroup>
          </Form>
        )}
      </ModalBody>
      <ModalFooter>
        <Button
          variant="primary"
          onClick={submit}
          isDisabled={submitting || editLoading}
        >
          {submitting
            ? t('policy_modal_btn_saving')
            : mode === 'create'
              ? t('policy_modal_btn_create')
              : t('policy_modal_btn_save')}
        </Button>
        <Button variant="link" onClick={onClose} isDisabled={submitting}>
          {t('policy_modal_btn_cancel')}
        </Button>
      </ModalFooter>
    </Modal>
  );
};
