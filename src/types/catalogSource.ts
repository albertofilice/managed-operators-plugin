import { K8sResourceCommon } from '@openshift-console/dynamic-plugin-sdk';

export type CatalogSourceKind = K8sResourceCommon & {
  apiVersion: 'operators.coreos.com/v1alpha1';
  kind: 'CatalogSource';
  metadata?: { name?: string; namespace?: string };
  spec?: { displayName?: string };
};

export type CatalogSourceList = {
  apiVersion: string;
  kind: 'CatalogSourceList';
  items: CatalogSourceKind[];
};
