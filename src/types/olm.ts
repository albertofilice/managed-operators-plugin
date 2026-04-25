import { K8sResourceCommon } from '@openshift-console/dynamic-plugin-sdk';

export type ClusterServiceVersionKind = K8sResourceCommon & {
  apiVersion: 'operators.coreos.com/v1alpha1';
  kind: 'ClusterServiceVersion';
  status?: {
    phase?: string;
    reason?: string;
  };
};

export type InstallPlanKind = K8sResourceCommon & {
  apiVersion: 'operators.coreos.com/v1alpha1';
  kind: 'InstallPlan';
  metadata?: {
    name?: string;
    namespace?: string;
    ownerReferences?: Array<{ kind: string; name: string; apiVersion?: string }>;
  };
  spec?: {
    approval?: 'Automatic' | 'Manual';
    approved?: boolean;
    clusterServiceVersionNames?: string[];
  };
  status?: {
    phase?: string;
    state?: string;
  };
};

export type InstallPlanList = {
  apiVersion: string;
  kind: 'InstallPlanList';
  metadata?: { continue?: string };
  items: InstallPlanKind[];
};
