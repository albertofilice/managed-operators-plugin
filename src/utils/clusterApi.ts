/**
 * Builds API paths for the hub session or for a managed cluster via the MCE console proxy
 * (`/api/proxy/plugin/mce/console/multicloud/managedclusterproxy/...`).
 */
export function clusterApiPath(clusterName: string, path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  if (clusterName === '__hub_direct__') {
    return p;
  }
  return `/api/proxy/plugin/mce/console/multicloud/managedclusterproxy/${encodeURIComponent(clusterName)}${p}`;
}

/** Hub: subscriptions list (same context as `oc get subscription -A` on the hub). */
export const HUB_SUBSCRIPTIONS_PATH = '/apis/operators.coreos.com/v1alpha1/subscriptions';
