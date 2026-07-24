/** Read a single query-string param, guarded for SSR/no-window. */
export function urlParam(key: string): string | null {
  if (typeof location === "undefined") return null;
  try {
    return new URLSearchParams(location.search).get(key);
  } catch {
    return null;
  }
}
