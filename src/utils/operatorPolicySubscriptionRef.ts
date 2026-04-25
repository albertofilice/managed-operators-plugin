/** RHACM sets subscription annotation to identify the governing OperatorPolicy. */
export const OP_POLICY_MANAGED_ANNOTATION =
  'operatorpolicy.policy.open-cluster-management.io/managed';

export const OP_POLICY_MANAGED_LABEL = 'operatorpolicy.policy.open-cluster-management.io/managed';

/**
 * Parses OperatorPolicy ref from subscription annotation: `namespace/name` or `namespace.policyname`
 * (first dot separates namespace from name when no slash).
 */
export function parseOperatorPolicyRefFromManagedValue(
  value: string,
): { namespace: string; name: string } | null {
  const v = value.trim();
  if (!v) return null;
  const slash = v.indexOf('/');
  if (slash > 0) {
    const namespace = v.slice(0, slash);
    const name = v.slice(slash + 1);
    if (namespace && name) return { namespace, name };
  }
  const dot = v.indexOf('.');
  if (dot <= 0) return null;
  const namespace = v.slice(0, dot);
  const name = v.slice(dot + 1);
  if (!namespace || !name) return null;
  return { namespace, name };
}

/** Canonical display for subscription annotation (ACM may use `ns/name` or `ns.name`). */
export function formatOperatorPolicyManagedDisplay(raw: string): string {
  const ref = parseOperatorPolicyRefFromManagedValue(raw);
  if (ref) return `${ref.namespace}/${ref.name}`;
  return raw.trim();
}
