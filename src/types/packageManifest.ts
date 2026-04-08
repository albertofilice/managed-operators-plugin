import { K8sResourceCommon } from '@openshift-console/dynamic-plugin-sdk';

/** `packages.operators.coreos.com/v1` — same data as `oc get packagemanifest` on that cluster. */
export type PackageManifestKind = K8sResourceCommon & {
  apiVersion: 'packages.operators.coreos.com/v1';
  kind: 'PackageManifest';
  status?: {
    /** CatalogSource name (e.g. redhat-operators). */
    catalogSource?: string;
    /** Namespace of the CatalogSource CR (often openshift-marketplace). */
    catalogSourceNamespace?: string;
    provider?: { name?: string };
    defaultChannel?: string;
    channels?: Array<{ name: string; currentCSV?: string }>;
  };
};

export type PackageManifestList = {
  apiVersion: string;
  kind: 'PackageManifestList';
  items: PackageManifestKind[];
};
