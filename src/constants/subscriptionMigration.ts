/**
 * Opt-in label on an OLM Subscription for "manual → OperatorPolicy" migration.
 * Cluster automation (or an admin) can watch this label and create a matching OperatorPolicy;
 * until then, use **Install operators** to define the policy from this console.
 */
export const SUBSCRIPTION_ENROLL_OPERATOR_POLICY_LABEL =
  'managed-operators-plugin.openshift.io/enroll-operator-policy';
