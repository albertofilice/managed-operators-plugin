import { K8sResourceCommon } from '@openshift-console/dynamic-plugin-sdk';

export type ComplianceLevel = 'Compliant' | 'NonCompliant';

export type RemovalBehaviorValue = 'Delete' | 'Keep' | 'DeleteIfUnused' | 'Retain' | 'Prune';

/** RHACM governance — see https://developers.redhat.com/articles/2024/08/08/getting-started-operatorpolicy */
export type OperatorPolicyKind = K8sResourceCommon & {
  apiVersion: 'policy.open-cluster-management.io/v1beta1';
  kind: 'OperatorPolicy';
  spec?: {
    remediationAction?: 'inform' | 'enforce';
    severity?: 'low' | 'medium' | 'high' | 'critical';
    complianceType?: 'musthave' | 'mustnothave';
    complianceConfig?: {
      catalogSourceUnhealthy?: ComplianceLevel;
      deploymentsUnavailable?: ComplianceLevel;
      deprecationsPresent?: ComplianceLevel;
      upgradesAvailable?: ComplianceLevel;
    };
    removalBehavior?: {
      clusterServiceVersions?: RemovalBehaviorValue;
      customResourceDefinitions?: RemovalBehaviorValue;
      operatorGroups?: RemovalBehaviorValue;
      subscriptions?: RemovalBehaviorValue;
    };
    operatorGroup?: {
      name?: string;
      namespace?: string;
      selector?: {
        matchLabels?: Record<string, string>;
      };
    };
    subscription?: {
      name?: string;
      namespace?: string;
      source?: string;
      sourceNamespace?: string;
      channel?: string;
      startingCSV?: string;
      /** OLM subscription config (resources, env, volumeMounts, …). */
      config?: Record<string, unknown>;
    };
    upgradeApproval?: 'Automatic' | 'None';
    versions?: string[];
  };
};

export type OperatorPolicyList = {
  apiVersion: string;
  kind: 'OperatorPolicyList';
  items: OperatorPolicyKind[];
};
