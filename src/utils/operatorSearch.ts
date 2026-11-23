import type { OperatorRow } from '../hooks/useManagedClusterSubscriptions';

/** Query param on /installed-operators holding the free-text search. */
export const SEARCH_TEXT_PARAM = 'q';

/** Splits the text into lower-case words; a row must match every word (AND). */
export function searchTerms(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter(Boolean);
}

function haystack(r: OperatorRow): string {
  return [
    r.name,
    r.csvFullName,
    r.installPrefillQuery?.packageName,
    r.namespace,
    r.clusterDisplayName,
    r.operatorPolicyManagedDisplay,
    r.operatorPolicyRef?.name,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/** True when every word of `text` appears in the operator, package, CSV, namespace, cluster or policy name. */
export function rowMatchesText(r: OperatorRow, text: string): boolean {
  const terms = searchTerms(text);
  if (terms.length === 0) return true;
  const h = haystack(r);
  return terms.every((t) => h.includes(t));
}
