/** Set on OperatorPolicy metadata when created from this console plugin (edit allowed from Installed Operators). */
export const PLUGIN_CREATED_ANNOTATION = 'console.openshift.io/managed-operators-plugin-created';

/**
 * Opt-in minor-line auto-approve: regex matched against the target CSV name of a pending InstallPlan
 * (e.g. `^smb-csi-driver-operator\\.v4\\.20\\..*$`). Executed by the in-cluster auto-approve CronJob
 * (see deploy/auto-approve/), not by the browser.
 */
export const AUTO_APPROVE_REGEX_ANNOTATION =
  'managed-operators-plugin.openshift.io/auto-approve-regex';
