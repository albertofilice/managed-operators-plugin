/** True for a Kubernetes API "not found" (the console fetch error carries the HTTP response). */
export function isNotFoundError(e: unknown): boolean {
  const err = e as { response?: { status?: number }; code?: number; status?: number } | null;
  return err?.response?.status === 404 || err?.code === 404 || err?.status === 404;
}
