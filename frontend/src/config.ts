/**
 * Centralized Application Configuration
 *
 * In development mode (import.meta.env.DEV), defaults to local backend 'http://127.0.0.1:8000'
 * if VITE_API_BASE_URL is not explicitly configured.
 *
 * In production mode (import.meta.env.PROD), defaults strictly to '' (clean relative path / same origin)
 * to ensure that NO user-facing action in the production UI can trigger a request to 127.0.0.1:8000.
 */
export const API_BASE_URL: string = (
  import.meta.env?.VITE_API_BASE_URL ||
  (import.meta.env?.DEV ? "http://127.0.0.1:8000" : "")
);

/**
 * Returns a fully-qualified or clean relative API URL for the given endpoint path.
 */
export function getApiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}
