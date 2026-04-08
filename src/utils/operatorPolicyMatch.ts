import { PLUGIN_CREATED_ANNOTATION } from '../constants/operatorPolicyPlugin';
import type { OperatorPolicyKind } from '../types/operatorPolicy';
import type { PackageManifestKind } from '../types/packageManifest';

/** Plugin-created OperatorPolicies that match this PackageManifest (same package + catalog). */
export function pluginPoliciesMatchingPackage(
  pm: PackageManifestKind,
  policies: OperatorPolicyKind[],
): OperatorPolicyKind[] {
  return policies.filter((pol) => matchesPackageManifest(pm, pol));
}

export function matchesPackageManifest(pm: PackageManifestKind, pol: OperatorPolicyKind): boolean {
  if (pol.metadata?.annotations?.[PLUGIN_CREATED_ANNOTATION] !== 'true') return false;
  const s = pol.spec?.subscription;
  if (!s?.name) return false;
  const pkg = pm.metadata?.name ?? '';
  const src = (pm.status?.catalogSource ?? '').trim();
  const srcNs = (pm.status?.catalogSourceNamespace ?? '').trim();
  return (
    s.name === pkg &&
    (s.source ?? '').trim() === src &&
    (s.sourceNamespace ?? '').trim() === srcNs
  );
}
