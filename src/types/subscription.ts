import { K8sResourceCommon } from '@openshift-console/dynamic-plugin-sdk';

/** OLM Subscription (operators.coreos.com) on a managed cluster. */
export type SubscriptionKind = K8sResourceCommon & {
  apiVersion: 'operators.coreos.com/v1alpha1';
  kind: 'Subscription';
  metadata?: K8sResourceCommon['metadata'] & {
    annotations?: Record<string, string>;
    labels?: Record<string, string>;
  };
  spec?: {
    installPlanApproval?: 'Automatic' | 'Manual';
  };
  status?: {
    currentCSV?: string;
    installedCSV?: string;
    /** e.g. AtLatestKnown, UpgradeAvailable, UpgradePending */
    state?: string;
    installPlanRef?: { name: string; namespace?: string };
  };
};

export type SubscriptionList = {
  apiVersion: string;
  kind: 'SubscriptionList';
  items: SubscriptionKind[];
};
