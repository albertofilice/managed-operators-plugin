import '../i18n/registerPluginLocales';
import * as React from 'react';
import {
  DocumentTitle,
  useK8sWatchResource,
  K8sResourceCommon,
} from '@openshift-console/dynamic-plugin-sdk';
import {
  Button,
  Card,
  CardBody,
  CardTitle,
  Grid,
  GridItem,
  Spinner,
  Title,
} from '@patternfly/react-core';
import { ChartDonut, ChartThemeColor } from '@patternfly/react-charts';
import { useTranslation } from 'react-i18next';
import {
  useManagedClusterSubscriptions,
  type OperatorRow,
} from '../hooks/useManagedClusterSubscriptions';
import { usePluginPolicyEditableMap } from '../hooks/usePluginPolicyEditableMap';

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

const CHART_WIDTH = 280;
const CHART_HEIGHT = 260;
const CHART_PAD = { bottom: 78, left: 16, right: 16, top: 16 };

function OverviewDonut({
  title,
  ariaTitle,
  ariaDesc,
  data,
  noDataLabel,
  centerSubtitle,
}: {
  title: string;
  ariaTitle: string;
  ariaDesc: string;
  data: { x: string; y: number }[];
  noDataLabel: string;
  centerSubtitle: string;
}) {
  const hasData = data.some((d) => d.y > 0);
  const chartData = hasData ? data : [{ x: noDataLabel, y: 1 }];
  const total = hasData ? data.reduce((sum, d) => sum + d.y, 0) : 0;
  const legendData = hasData
    ? data.map((d) => ({ name: `${d.x}: ${d.y}` }))
    : [{ name: `${noDataLabel}: 0` }];

  return (
    <Card className="managed-operators-plugin__overview-card" isCompact>
      <CardTitle>{title}</CardTitle>
      <CardBody className="pf-v6-u-display-flex pf-v6-u-justify-content-center">
        <ChartDonut
          allowTooltip
          ariaDesc={ariaDesc}
          ariaTitle={ariaTitle}
          constrainToVisibleArea
          data={chartData}
          height={CHART_HEIGHT}
          labels={({ datum }) => `${datum.x}: ${datum.y}`}
          legendData={legendData}
          legendOrientation="horizontal"
          legendPosition="bottom"
          name={title}
          padding={CHART_PAD}
          subTitle={centerSubtitle}
          themeColor={ChartThemeColor.multiOrdered}
          title={String(total)}
          width={CHART_WIDTH}
        />
      </CardBody>
    </Card>
  );
}

export function OperatorsOverviewPage(): React.ReactElement {
  const { t } = useTranslation('plugin__managed-operators-plugin');
  const [clusters, clustersLoaded, clustersError] =
    useK8sWatchResource<ManagedClusterKind[]>(managedClusterWatch);

  const clusterNames = React.useMemo(() => {
    const list = Array.isArray(clusters) ? clusters : [];
    return list
      .filter(clusterReady)
      .map((c) => c.metadata?.name)
      .filter(Boolean) as string[];
  }, [clusters]);

  const {
    rows,
    loaded: subsLoaded,
    error: subsError,
  } = useManagedClusterSubscriptions(clusterNames);
  const {
    loading: pluginMetaLoading,
    canEditPlugin,
    isExternalGovernancePolicy,
  } = usePluginPolicyEditableMap(rows);

  const loaded = clustersLoaded && subsLoaded;
  const loadError = clustersError ?? subsError;

  const stats = React.useMemo(() => {
    const total = rows.length;
    const csvOk = rows.filter((r) => r.csvSucceeded).length;
    const csvOther = total - csvOk;
    const upgradePending = rows.filter((r) => Boolean(r.upgradePending)).length;
    const upgradeIdle = total - upgradePending;
    const gov = rows.filter((r) => r.policyGovernanceManaged).length;
    const standalone = total - gov;
    const withRef = rows.filter((r) => r.operatorPolicyRef).length;
    const withoutRef = total - withRef;
    const external = rows.filter(
      (r) => r.operatorPolicyRef && isExternalGovernancePolicy(r),
    ).length;
    const pluginManaged = rows.filter((r) => canEditPlugin(r)).length;
    return {
      total,
      csvOk,
      csvOther,
      upgradePending,
      upgradeIdle,
      gov,
      standalone,
      withRef,
      withoutRef,
      external,
      pluginManaged,
    };
  }, [rows, canEditPlugin, isExternalGovernancePolicy]);

  const byCluster = React.useMemo(() => groupRowsByCluster(rows), [rows]);
  const clusterKeys = React.useMemo(() => [...byCluster.keys()].sort(), [byCluster]);

  const overviewRowClass =
    'pf-v6-u-display-flex pf-v6-u-justify-content-space-between pf-v6-u-align-items-center pf-v6-u-py-sm';

  return (
    <div data-test="managed-operators-overview">
      <DocumentTitle>{t('overview_document_title')}</DocumentTitle>
      <div className="pf-v6-u-px-lg pf-v6-u-pt-lg pf-v6-u-pb-sm">
        <Title headingLevel="h1">{t('overview_heading')}</Title>
        <p className="pf-v6-u-mt-sm pf-v6-u-text-color-subtle">{t('overview_intro')}</p>
        <div className="pf-v6-u-mt-md">
          <Button
            variant="link"
            isInline
            component="a"
            href="/multicloud/ecosystem/installed-operators"
          >
            {t('Installed Operators')}
          </Button>
          <span className="pf-v6-u-mx-sm pf-v6-u-text-color-subtle">·</span>
          <Button
            variant="link"
            isInline
            component="a"
            href="/multicloud/ecosystem/install-operators"
          >
            {t('Install operators')}
          </Button>
        </div>
      </div>

      <div className="pf-v6-u-px-lg pf-v6-u-pb-lg">
        {!loaded && (
          <div className="pf-v6-u-text-align-center pf-v6-u-p-xl">
            <Spinner aria-label={t('overview_spinner_aria')} />
          </div>
        )}

        {loadError && (
          <Card className="managed-operators-plugin__overview-card">
            <CardBody>{t('overview_load_error', { error: String(loadError) })}</CardBody>
          </Card>
        )}

        {loaded && (
          <>
            <Grid hasGutter className="pf-v6-u-mb-lg">
              <GridItem md={12} lg={6} xl={3}>
                <OverviewDonut
                  title={t('overview_chart_csv_title')}
                  ariaTitle={t('overview_chart_csv_aria_title')}
                  ariaDesc={t('overview_chart_csv_aria_desc')}
                  centerSubtitle={t('overview_chart_center_subtitle')}
                  noDataLabel={t('overview_chart_no_data')}
                  data={[
                    { x: t('overview_chart_csv_succeeded'), y: stats.csvOk },
                    { x: t('overview_chart_csv_other'), y: stats.csvOther },
                  ]}
                />
              </GridItem>
              <GridItem md={12} lg={6} xl={3}>
                <OverviewDonut
                  title={t('overview_chart_upgrade_title')}
                  ariaTitle={t('overview_chart_upgrade_aria_title')}
                  ariaDesc={t('overview_chart_upgrade_aria_desc')}
                  centerSubtitle={t('overview_chart_center_subtitle')}
                  noDataLabel={t('overview_chart_no_data')}
                  data={[
                    { x: t('overview_chart_upgrade_pending'), y: stats.upgradePending },
                    { x: t('overview_chart_upgrade_none'), y: stats.upgradeIdle },
                  ]}
                />
              </GridItem>
              <GridItem md={12} lg={6} xl={3}>
                <OverviewDonut
                  title={t('overview_chart_gov_title')}
                  ariaTitle={t('overview_chart_gov_aria_title')}
                  ariaDesc={t('overview_chart_gov_aria_desc')}
                  centerSubtitle={t('overview_chart_center_subtitle')}
                  noDataLabel={t('overview_chart_no_data')}
                  data={[
                    { x: t('overview_chart_gov_policy'), y: stats.gov },
                    { x: t('overview_chart_gov_standalone'), y: stats.standalone },
                  ]}
                />
              </GridItem>
              <GridItem md={12} lg={6} xl={3}>
                <OverviewDonut
                  title={t('overview_chart_ref_title')}
                  ariaTitle={t('overview_chart_ref_aria_title')}
                  ariaDesc={t('overview_chart_ref_aria_desc')}
                  centerSubtitle={t('overview_chart_center_subtitle')}
                  noDataLabel={t('overview_chart_no_data')}
                  data={[
                    { x: t('overview_chart_ref_with'), y: stats.withRef },
                    { x: t('overview_chart_ref_without'), y: stats.withoutRef },
                  ]}
                />
              </GridItem>
            </Grid>

            <Grid hasGutter>
              <GridItem md={12} lg={6}>
                <Card className="managed-operators-plugin__overview-card" isCompact>
                  <CardTitle>{t('overview_summary_title')}</CardTitle>
                  <CardBody>
                    <div className={overviewRowClass}>
                      <span>{t('overview_ready_clusters')}</span>
                      <Button
                        variant="link"
                        isInline
                        component="a"
                        href="/multicloud/ecosystem/installed-operators"
                        className="pf-v6-u-font-size-md pf-v6-u-font-weight-bold"
                      >
                        {clusterNames.length}
                      </Button>
                    </div>
                    <div className={overviewRowClass}>
                      <span>{t('overview_subscriptions_rows')}</span>
                      <Button
                        variant="link"
                        isInline
                        component="a"
                        href="/multicloud/ecosystem/installed-operators"
                        className="pf-v6-u-font-size-md pf-v6-u-font-weight-bold"
                      >
                        {stats.total}
                      </Button>
                    </div>
                    <div className={overviewRowClass}>
                      <span>{t('overview_policy_external')}</span>
                      {pluginMetaLoading ? (
                        <span className="pf-v6-u-text-color-subtle">
                          {t('overview_loading_ellipsis')}
                        </span>
                      ) : (
                        <Button
                          variant="link"
                          isInline
                          component="a"
                          href="/multicloud/ecosystem/installed-operators"
                          className="pf-v6-u-font-size-md pf-v6-u-font-weight-bold"
                        >
                          {stats.external}
                        </Button>
                      )}
                    </div>
                    <div className={overviewRowClass}>
                      <span>{t('overview_policy_plugin')}</span>
                      {pluginMetaLoading ? (
                        <span className="pf-v6-u-text-color-subtle">
                          {t('overview_loading_ellipsis')}
                        </span>
                      ) : (
                        <Button
                          variant="link"
                          isInline
                          component="a"
                          href="/multicloud/ecosystem/installed-operators"
                          className="pf-v6-u-font-size-md pf-v6-u-font-weight-bold"
                        >
                          {stats.pluginManaged}
                        </Button>
                      )}
                    </div>
                  </CardBody>
                </Card>
              </GridItem>
              <GridItem md={12} lg={6}>
                <Card className="managed-operators-plugin__overview-card" isCompact>
                  <CardTitle>{t('overview_per_cluster_title')}</CardTitle>
                  <CardBody>
                    {clusterKeys.length === 0 ? (
                      <span className="pf-v6-u-text-color-subtle">
                        {t('overview_no_subscription_rows')}
                      </span>
                    ) : (
                      <div>
                        {clusterKeys.map((name) => {
                          const clusterKey =
                            name === 'Hub (current session)' ? '__hub_direct__' : name;
                          const count = (byCluster.get(name) ?? []).length;
                          return (
                            <div key={name} className={overviewRowClass}>
                              <span className="pf-v6-u-truncate">{name}</span>
                              <Button
                                variant="link"
                                isInline
                                component="a"
                                href={`/multicloud/ecosystem/installed-operators?cluster=${encodeURIComponent(
                                  clusterKey,
                                )}`}
                                className="pf-v6-u-font-size-md pf-v6-u-font-weight-bold"
                              >
                                {count}
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardBody>
                </Card>
              </GridItem>
            </Grid>
          </>
        )}
      </div>
    </div>
  );
}

export default OperatorsOverviewPage;
