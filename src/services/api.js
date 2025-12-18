
// api.ts
// Lightweight, dependency-free fetch helper with retries, timeout, and robust errors.

export class ApiError extends Error {
  constructor(message, init) {
    super(message);
    this.name = 'ApiError';
    this.status = init?.status;
    this.body = init?.body;
    this.response = init?.response;
  }
}

// Helper types removed (JS file). Query is a plain object map.
// ExpectType: 'json' | 'text' | 'blob' | 'void'

// RetryOptions and RequestOptions are documented in JSDoc comments below.


function toUrl(base, path, query) {
  // Ensure base + path are joined correctly even when `path` starts with '/'.
  // Example: base="/api" and path="/auth/login" should result in 
  // window.location.origin + "/api/auth/login" (not replace `/api` with `/auth/login`).
  const host = base.startsWith('http') ? base : window.location.origin + base;
  const full = host.replace(/\/$/, '') + '/' + String(path).replace(/^\//, '');
  const url = new URL(full);
  if (query) {
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    });
  }
  return url.toString();
}

function isFormData(body) {
  return typeof FormData !== 'undefined' && body instanceof FormData;
}

async function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function parseResponse(res, expect) {
  if (res.status === 204 || expect === 'void') return undefined;

  const contentType = res.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');

  if (expect === 'text') return res.text();
  if (expect === 'blob') return res.blob();
  if (expect === 'json' || isJson) {
    // Guard against empty bodies
    const text = await res.text();
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      // Fallback to raw text if JSON invalid
      return text;
    }
  }

  // Default: try text
  return res.text();
}

export function createApi(config) {
  const {
    baseURL,
    getToken,
    credentials = 'same-origin', // safe default
  } = config;

  async function request(path, opts = {}) {
    const {
      json,
      body: rawBody,
      query,
      headers: hdrs,
      timeoutMs = 15000,
      retry,
      expect,
      ...rest
    } = opts;

    const url = toUrl(baseURL, path, query);

    const headers = new Headers(hdrs || {});
    const token = getToken?.();
    if (token) headers.set('Authorization', `Bearer ${token}`);

    let body = rawBody;

    if (json !== undefined && rawBody !== undefined) {
      console.warn('Both `json` and `body` provided; `body` takes precedence.');
    }

    if (rawBody === undefined && json !== undefined) {
      // Only set JSON header if client sends JSON
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
      body = JSON.stringify(json);
    }

    // If body is FormData, remove Content-Type so the browser sets it with boundary
    if (body && isFormData(body)) {
      headers.delete('Content-Type');
    }

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);

    const retryCfg = {
      retries: retry?.retries ?? 0,
      factor: retry?.factor ?? 2,
      minTimeout: retry?.minTimeout ?? 400,
      statusCodes: retry?.statusCodes ?? [502, 503, 504],
    };

    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const res = await fetch(url, {
          method: 'GET',
          ...rest,
          headers,
          body,
          credentials,
          signal: controller.signal,
        });

        const parsed = await parseResponse(res, expect);

        if (res.ok) {
          clearTimeout(id);
          return parsed;
        }

        // Non-2xx
        const errMsg = parsed && typeof parsed === 'object' && 'error' in parsed ? parsed.error : res.statusText || 'Request failed';
        const err = new ApiError(errMsg, { status: res.status, body: parsed, response: res });

        const shouldRetry =
          attempt < retryCfg.retries && retryCfg.statusCodes.includes(res.status);

        if (shouldRetry) {
          attempt += 1;
          const delay = retryCfg.minTimeout * Math.pow(retryCfg.factor, attempt - 1);
          await sleep(delay);
          continue;
        }

        clearTimeout(id);
        throw err;
      } catch (e) {
        const isAbort = e?.name === 'AbortError';
        const isNetwork = e instanceof TypeError && !isAbort;

        const canRetry = isNetwork && attempt < retryCfg.retries;
        if (canRetry) {
          attempt += 1;
          const delay = retryCfg.minTimeout * Math.pow(retryCfg.factor, attempt - 1);
          await sleep(delay);
          continue;
        }

        clearTimeout(id);
        if (isAbort) {
          throw new ApiError('Request timed out or aborted', { status: 0 });
        }
        throw e;
      }
    }
  }

  // ---- Domain endpoints (small, testable wrappers) ----
  function login(payload) {
    return request('/auth/login', { method: 'POST', json: payload, expect: 'json' });
  }

  function register(payload) {
    return request('/auth/register', { method: 'POST', json: payload, expect: 'json' });
  }

  function getMachines() {
    return request('/admin/machines', { method: 'GET', expect: 'json' });
  }

  function createMachine(payload) {
    return request('/admin/machines', { method: 'POST', json: payload, expect: 'json' });
  }

  function getUsers() {
    return request('/admin/users', { method: 'GET', expect: 'json' });
  }

  function rotateUserKey(id) {
    return request(`/admin/users/${id}/rotate`, { method: 'POST', expect: 'json' });
  }

  // Note: `me()` removed — use tokens returned from /auth/login and backend-provided JWT payloads when needed.

  return {
    request,
    login,
    register,
    getMachines,
    createMachine,
    getUsers,
    rotateUserKey,
  };
}

// ---- Default instance (adjust to your app) ----
const BASE_URL = import.meta?.env?.VITE_API_BASE ?? '/api';
const getToken = () => localStorage.getItem('ws_token');

export const api = createApi({
  baseURL: BASE_URL,
  getToken,
  // If you move to httpOnly cookies:
  // credentials: 'include',
});

// Prefer named exports for tree-shaking
export const {
  request,
  login,
  register,
  getMachines,
  createMachine,
  getUsers,
  rotateUserKey,
} = api;

export default api;
