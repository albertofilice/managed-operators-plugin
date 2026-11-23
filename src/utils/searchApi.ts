import { consoleFetchJSON } from '@openshift-console/dynamic-plugin-sdk';

/** RHACM Search (GraphQL) as exposed by the MCE console backend; results follow the user's RBAC. */
export const SEARCH_PATH = '/api/proxy/plugin/mce/console/multicloud/proxy/search';

export type SearchItem = Record<string, string>;
export type SearchFilter = { property: string; values: string[] };
// eslint-disable-next-line no-unused-vars
export type SearchPoster = (_url: string, _body: unknown) => Promise<unknown>;

const QUERY = `query searchResult($input: [SearchInput]) {
  searchResult: search(input: $input) { count items }
}`;

/** A hung Search backend must not keep the page loading: fail fast so callers fall back to the proxy. */
export const SEARCH_TIMEOUT_MS = 20_000;

const defaultPoster: SearchPoster = (url, body) =>
  consoleFetchJSON.post(url, body, undefined, SEARCH_TIMEOUT_MS);

/** Runs one Search query. Any HTTP or GraphQL error rejects, so callers can fall back. */
export async function searchItems(
  filters: SearchFilter[],
  poster: SearchPoster = defaultPoster,
): Promise<SearchItem[]> {
  const res = (await poster(SEARCH_PATH, {
    operationName: 'searchResult',
    query: QUERY,
    variables: { input: [{ filters, limit: -1 }] },
  })) as {
    data?: { searchResult?: Array<{ items?: SearchItem[] }> | null } | null;
    errors?: Array<{ message?: string }>;
  };
  if (res?.errors?.length) {
    throw new Error(res.errors.map((e) => e.message ?? 'unknown error').join('; '));
  }
  const result = res?.data?.searchResult;
  if (!Array.isArray(result)) throw new Error('Unexpected Search response');
  return result[0]?.items ?? [];
}
