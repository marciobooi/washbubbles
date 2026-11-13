
import { requestPinRenew } from '../lib/pinRenew'

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
    getTenantId,
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
      skipAuth = false,
      ...rest
    } = opts;

    const url = toUrl(baseURL, path, query);

    const headers = new Headers(hdrs || {});
    const token = getToken?.();
    const tenantId = getTenantId?.();
    // Did this request carry the logged-in user's token? Only then can a 401 mean "your session ran out".
    const carriesSession = !skipAuth && Boolean(token) && !headers.has('Authorization')
    // Only set Bearer Authorization if caller did not provide their own Authorization header and skipAuth is not set
    if (!skipAuth && token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
    // Attach tenant header when available and not already provided
    if (tenantId && !headers.has('X-Tenant-Id')) headers.set('X-Tenant-Id', String(tenantId));

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
        // The session expired (or was revoked): tell the app, which sends the admin to the login page. Not for the login call itself.
        if (res.status === 401 && carriesSession && !String(path).startsWith('/auth/') && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('auth:expired'));
        }

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

  function changePassword(payload) {
    return request('/auth/change-password', { method: 'POST', json: payload, expect: 'json' });
  }

  function forgotPassword(payload) {
    return request('/auth/forgot-password', { method: 'POST', json: payload, expect: 'json' });
  }

  function resetPassword(payload) {
    return request('/auth/reset-password', { method: 'POST', json: payload, expect: 'json' });
  }

  function getMachines() {
    return request('/admin/machines', { method: 'GET', expect: 'json' });
  }

  function getMachine(id) {
    return request(`/admin/machines/${id}`, { method: 'GET', expect: 'json' });
  }

  // Public/kiosk machines list. Pass e.g. { type: 'wash' } to filter.
  // Optionally pass `opts = { apiKey }` to set `x-api-key` header for kiosks.
  function getPublicMachines(query, opts) {
    const headers = opts?.apiKey ? { Authorization: `ApiKey ${String(opts.apiKey)}` } : undefined;
    // Kiosk calls should not attach the user's Bearer token
    return request('/pos/machines', { method: 'GET', expect: 'json', query, headers, skipAuth: true });
  }

  function createMachine(payload) {
    return request('/admin/machines', { method: 'POST', json: payload, expect: 'json' });
  }

  function updateMachine(id, payload) {
    return request(`/admin/machines/${id}`, { method: 'PUT', json: payload, expect: 'json' });
  }

  function deleteMachine(id) {
    return request(`/admin/machines/${id}`, { method: 'DELETE', expect: 'json' });
  }

  function logMachineService(id) {
    return request(`/admin/machines/${id}/service`, { method: 'POST', expect: 'json' });
  }

  // Maintenance tickets
  function getMaintenanceTickets(status) {
    return request('/admin/maintenance', { method: 'GET', query: status ? { status } : undefined, expect: 'json' });
  }
  function resolveMaintenanceTicket(id) {
    return request(`/admin/maintenance/${id}`, { method: 'PUT', expect: 'json' });
  }

  function getUsers() {
    return request('/admin/users', { method: 'GET', expect: 'json' });
  }


  function createUser(payload) {
    return request('/admin/users', { method: 'POST', json: payload, expect: 'json' });
  }

  function updateUser(id, payload) {
    return request(`/admin/users/${id}`, { method: 'PUT', json: payload, expect: 'json' });
  }

  function deleteUser(id) {
    return request(`/admin/users/${id}`, { method: 'DELETE', expect: 'json' });
  }


  // Transactions
  function getTransactions(query) {
    return request('/admin/transactions', { method: 'GET', expect: 'json', query });
  }

  // CSV exports. `expect: 'blob'` already existed in the fetch helper above
  // but had no caller until this — see backend routes/admin.js for the
  // hand-built CSV (no library needed for a shape this simple).
  function exportTransactionsCsv(query) {
    return request('/admin/transactions/export.csv', { method: 'GET', query, expect: 'blob' });
  }

  function exportRevenueCsv() {
    return request('/admin/analytics/revenue.csv', { method: 'GET', expect: 'blob' });
  }

  // Triggers a browser download for a Blob returned by one of the exports
  // above — no <a download> link exists anywhere in this app yet to reuse.
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }


  function createTransaction(payload) {
    return request('/admin/transactions', { method: 'POST', json: payload, expect: 'json' });
  }

  // Reverses a sale: credits the card back (if any) and records a new
  // `refund`-type Sale rather than deleting anything. See routes/admin.js.
  function refundTransaction(id, reason, extra = {}) {
    return request(`/admin/transactions/${id}/refund`, { method: 'POST', json: { reason, ...extra }, expect: 'json' });
  }

  // Audit log
  function getAuditLog(query) {
    return request('/admin/audit-log', { method: 'GET', query, expect: 'json' });
  }

  // Gateways (kiosk)
  function gatewayGetCard(code, opts) {
    const headers = opts?.apiKey ? { Authorization: `ApiKey ${String(opts.apiKey)}` } : undefined
    return request(`/gateways/cards/${encodeURIComponent(code)}`, { method: 'GET', expect: 'json', headers, skipAuth: true })
  }

  // Verify the operator's admin PIN. The PIN itself is never returned — the
  // server compares it and answers ok / 401, so it cannot leak to a renderer
  // running on a public terminal.
  // A staff PIN that is right but expired (it is renewed every Monday): ask the person at the kiosk for a new one (components/PinRenewHost).
  function renewStaffPin(payload, opts) {
    const headers = opts?.apiKey ? { Authorization: `ApiKey ${String(opts.apiKey)}` } : undefined
    return request('/pos/admin/renew-pin', { method: 'POST', json: payload, headers, skipAuth: true, expect: 'json' })
  }

  function verifyAdminPin(pin, opts) {
    const headers = opts?.apiKey ? { Authorization: `ApiKey ${String(opts.apiKey)}` } : undefined
    return request('/pos/admin/verify-pin', { method: 'POST', json: { pin }, headers, skipAuth: true, expect: 'json' })
      .catch((e) => { if (e?.status === 410) requestPinRenew({ apiKey: opts?.apiKey }); throw e }) // right PIN, expired: the popup asks for a new one
  }

  // Kiosk day-close: same reconciliation as the admin dashboard's, reachable
  // with the kiosk's own apiKey. The POST additionally carries the staff PIN,
  // verified again server-side — see routes/pos.js.
  function getKioskDayCloseSummary(opts) {
    const headers = { ...(opts?.apiKey ? { Authorization: `ApiKey ${String(opts.apiKey)}` } : {}), ...(opts?.pin ? { 'X-Staff-Pin': String(opts.pin) } : {}) }
    return request('/pos/day-close/summary', { method: 'GET', headers, skipAuth: true, expect: 'json' })
  }

  function createKioskDayClose(payload, opts) {
    const headers = opts?.apiKey ? { Authorization: `ApiKey ${String(opts.apiKey)}` } : undefined
    return request('/pos/day-close', { method: 'POST', json: payload, headers, skipAuth: true, expect: 'json' })
  }

  function emailKioskDayCloseReceipt(id, email, opts) {
    const headers = opts?.apiKey ? { Authorization: `ApiKey ${String(opts.apiKey)}` } : undefined
    return request(`/pos/day-close/${id}/email`, { method: 'POST', json: { email, pin: opts?.pin }, headers, skipAuth: true, expect: 'json' })
  }

  function gatewayTopupCard(code, payload, opts) {
    const headers = opts?.apiKey ? { Authorization: `ApiKey ${String(opts.apiKey)}` } : undefined
    return request(`/gateways/cards/${encodeURIComponent(code)}/topup`, { method: 'POST', json: payload, expect: 'json', headers, skipAuth: true })
  }

  function gatewayCardPay(payload, opts) {
    const headers = opts?.apiKey ? { Authorization: `ApiKey ${String(opts.apiKey)}` } : undefined
    return request('/gateways/card/pay', { method: 'POST', json: payload, expect: 'json', headers, skipAuth: true })
  }

  function gatewayCashPay(payload, opts) {
    const headers = opts?.apiKey ? { Authorization: `ApiKey ${String(opts.apiKey)}` } : undefined
    // A big change payout (coins one by one) takes much longer than the usual 15 s: do not give up while the hopper pays.
    return request('/gateways/cash/pay', { method: 'POST', json: payload, expect: 'json', headers, skipAuth: true, timeoutMs: 120000 })
  }

  // Post-purchase guest-WiFi voucher (batchId of a wash/dry sale)
  function wifiVoucher(batchId, opts) {
    const headers = opts?.apiKey ? { Authorization: `ApiKey ${String(opts.apiKey)}` } : undefined
    return request('/wifi/voucher', { method: 'POST', json: { batchId }, expect: 'json', headers, skipAuth: true })
  }

  // Email a plain (non-fiscal) purchase confirmation for a sale batch
  function emailReceipt(batchId, email, opts) {
    const headers = opts?.apiKey ? { Authorization: `ApiKey ${String(opts.apiKey)}` } : undefined
    return request('/pos/receipt', { method: 'POST', json: { batchId, email }, expect: 'json', headers, skipAuth: true })
  }

  // Day Close
  function getDayCloseSummary() {
    return request('/admin/day-close/summary', { method: 'GET', expect: 'json' });
  }

  function getDayCloses() {
    return request('/admin/day-close', { method: 'GET', expect: 'json' });
  }

  function createDayClose(payload) {
    // payload: { amountToBank, floatLeft, countedCash?, countedDenominations, coinMechanismInventory, hopperCoins, notes }
    return request('/admin/day-close', { method: 'POST', json: payload, expect: 'json' });
  }

  // Cash taken out of the machine between closes: { amount, notes? }
  // The coins of the bank deposit come out of the hopper like change: { amount }
  function payoutBankCoins(payload) {
    return request('/admin/day-close/payout-coins', { method: 'POST', json: payload, expect: 'json' })
  }

  function exchangeCash(payload) {
    return request('/admin/day-close/exchange', { method: 'POST', json: payload, expect: 'json' })
  }

  function withdrawCash(payload) {
    return request('/admin/day-close/withdraw', { method: 'POST', json: payload, expect: 'json' })
  }

  function restoreHopper(payload) {
    return request('/admin/hopper/restore', { method: 'POST', json: payload, expect: 'json' })
  }
  // Gift card (free card, credit default 0): the kiosk sends the staff PIN with every call; the admin is logged in.
  function giftKioskCard(payload, opts) {
    const headers = opts?.apiKey ? { Authorization: `ApiKey ${String(opts.apiKey)}` } : undefined
    return request('/pos/card/gift', { method: 'POST', json: payload, headers, skipAuth: true, expect: 'json' })
  }
  function staffStartMachine(id, payload, opts) {
    const headers = opts?.apiKey ? { Authorization: `ApiKey ${String(opts.apiKey)}` } : undefined
    return request(`/pos/staff/machines/${id}/start`, { method: 'POST', json: payload, headers, skipAuth: true, expect: 'json' })
  }
  function staffEndMachine(id, payload, opts) {
    const headers = opts?.apiKey ? { Authorization: `ApiKey ${String(opts.apiKey)}` } : undefined
    return request(`/pos/staff/machines/${id}/end`, { method: 'POST', json: payload, headers, skipAuth: true, expect: 'json' })
  }
  // Kiosk key: rotate it from the admin (staged, shown once) and enter it at the kiosk (staff PIN).
  function rotateUserKey(id) { return request(`/admin/users/${id}/rotate`, { method: 'POST', expect: 'json' }) }
  function setCentralKey(payload, opts) {
    const headers = opts?.apiKey ? { Authorization: `ApiKey ${String(opts.apiKey)}` } : undefined
    return request('/pos/central-key', { method: 'POST', json: payload, headers, skipAuth: true, expect: 'json' })
  }
  function centralKeyStatus(opts) {
    const headers = opts?.apiKey ? { Authorization: `ApiKey ${String(opts.apiKey)}` } : undefined
    return request('/pos/central-key/status', { method: 'GET', headers, skipAuth: true, expect: 'json' })
  }
  function adminGiftCard(payload) { return request('/admin/cards/gift', { method: 'POST', json: payload, expect: 'json' }) }

  function blankCardAtReader() { return request('/admin/cards/blank-reader', { method: 'POST', json: { confirm: true }, expect: 'json' }) }

  function updateCardProfile(code, payload, opts) {
    const headers = opts?.apiKey ? { Authorization: `ApiKey ${String(opts.apiKey)}` } : undefined
    return request(`/pos/cards/${encodeURIComponent(code)}/profile`, { method: 'POST', json: payload, headers, skipAuth: true, expect: 'json' })
  }

  function adminCommand(id) { return request(`/admin/commands/${id}`, { method: 'GET', expect: 'json' }) }

  function reinitHardware() {
    return request('/admin/hardware/reinit', { method: 'POST', json: {}, expect: 'json' })
  }
  function keepCredit() {
    return request('/admin/credit/keep', { method: 'POST', json: { confirm: true }, expect: 'json' })
  }
  function resetControllerLink() {
    return request('/admin/hardware/reset-link', { method: 'POST', json: {}, expect: 'json' })
  }
  function getHardwareHealth() {
    return request('/admin/hardware/health', { method: 'GET', expect: 'json' })
  }
  function kioskResetControllerLink(payload, opts) {
    const headers = opts?.apiKey ? { Authorization: `ApiKey ${String(opts.apiKey)}` } : undefined
    return request('/pos/hardware/reset-link', { method: 'POST', json: payload, headers, skipAuth: true, expect: 'json' })
  }
  function emptyHopper() {
    return request('/admin/hopper/empty', { method: 'POST', json: { confirm: true }, expect: 'json' })
  }

  function payoutBankCoinsKiosk(payload, opts) {
    const headers = opts?.apiKey ? { Authorization: `ApiKey ${String(opts.apiKey)}` } : undefined
    return request('/pos/day-close/payout-coins', { method: 'POST', json: payload, headers, skipAuth: true, expect: 'json' })
  }

  function withdrawKioskCash(payload, opts) {
    const headers = opts?.apiKey ? { Authorization: `ApiKey ${String(opts.apiKey)}` } : undefined
    return request('/pos/day-close/withdraw', { method: 'POST', json: payload, headers, skipAuth: true, expect: 'json' })
  }

  function refillKioskHopper(payload, opts) {
    const headers = opts?.apiKey ? { Authorization: `ApiKey ${String(opts.apiKey)}` } : undefined
    return request('/pos/hopper/refill', { method: 'POST', json: payload, headers, skipAuth: true, expect: 'json' })
  }

  // The same actions as the admin's, for the person at the kiosk (staff PIN in the payload).
  function exchangeKioskCash(payload, opts) {
    const headers = opts?.apiKey ? { Authorization: `ApiKey ${String(opts.apiKey)}` } : undefined
    return request('/pos/day-close/exchange', { method: 'POST', json: payload, headers, skipAuth: true, expect: 'json' })
  }
  function restoreKioskHopper(payload, opts) {
    const headers = opts?.apiKey ? { Authorization: `ApiKey ${String(opts.apiKey)}` } : undefined
    return request('/pos/hopper/restore', { method: 'POST', json: payload, headers, skipAuth: true, expect: 'json' })
  }
  function emptyKioskHopper(payload, opts) {
    const headers = opts?.apiKey ? { Authorization: `ApiKey ${String(opts.apiKey)}` } : undefined
    return request('/pos/hopper/empty', { method: 'POST', json: { confirm: true, ...payload }, headers, skipAuth: true, expect: 'json' })
  }

  function addDayCloseFloat(payload) {
    // payload: { denominations: [{value, count}], notes? } — top up the float
    // directly, without it counting as bankable sales money.
    return request('/admin/day-close/adjust-float', { method: 'POST', json: payload, expect: 'json' });
  }

  function emailDayCloseReceipt(id, email) {
    return request(`/admin/day-close/${id}/email`, { method: 'POST', json: { email }, expect: 'json' });
  }


  // Analytics
  function getAnalyticsRevenue() {
    return request('/admin/analytics/revenue', { method: 'GET', expect: 'json' });
  }
  function getAnalyticsMachines(month) {
    return request(`/admin/analytics/machines${month ? `?month=${encodeURIComponent(month)}` : ''}`, { method: 'GET', expect: 'json' });
  }
  function getAnalyticsInsights(days) {
    return request(`/admin/analytics/insights${days ? `?days=${encodeURIComponent(days)}` : ''}`, { method: 'GET', expect: 'json' });
  }
  function getAnalyticsRhythm(month) {
    return request(`/admin/analytics/rhythm${month ? `?month=${encodeURIComponent(month)}` : ''}`, { method: 'GET', expect: 'json' });
  }
  function getAnalyticsMachineMonths() {
    return request('/admin/analytics/machines/months', { method: 'GET', expect: 'json' });
  }
  function getKioskHealth() {
    return request('/admin/kiosks/health', { method: 'GET', expect: 'json' });
  }

  // Settings
  function getSettings() {
    return request('/admin/settings', { method: 'GET', expect: 'json' });
  }

  function getSetting(key) {
    return request(`/admin/settings/${encodeURIComponent(key)}`, { method: 'GET', expect: 'json' }).catch((e) => {
      // Return null for missing settings (404) instead of throwing an ApiError
      if (e && e.status === 404) return null
      throw e
    })
  }

  // Public settings lookup for branding values (no auth required)
  function getPublicSetting(key) {
    return request(`/settings/${encodeURIComponent(key)}`, { method: 'GET', expect: 'json', skipAuth: true }).catch((e) => {
      if (e && e.status === 404) return null
      throw e
    })
  }

  function setSetting(payload) {
    return request('/admin/settings', { method: 'POST', json: payload, expect: 'json' });
  }

  function deleteSetting(key) {
    return request(`/admin/settings/${encodeURIComponent(key)}`, { method: 'DELETE', expect: 'json' });
  }

  // Uploads one banner image, returns { url }. Saving it onto a slide (and
  // persisting the `banners` setting array) is a separate setSetting call —
  // see AdminSettings.jsx's Banner tab.
  function uploadBannerImage(file) {
    const fd = new FormData();
    fd.append('image', file);
    return request('/admin/settings/banner-image', { method: 'POST', body: fd, expect: 'json' });
  }

  // Interfaces
  function getInterfaces() {
    return request('/admin/interfaces', { method: 'GET', expect: 'json' });
  }


  function createInterface(payload) {
    return request('/admin/interfaces', { method: 'POST', json: payload, expect: 'json' });
  }

  function updateInterface(id, payload) {
    return request(`/admin/interfaces/${id}`, { method: 'PUT', json: payload, expect: 'json' });
  }

  function deleteInterface(id) {
    return request(`/admin/interfaces/${id}`, { method: 'DELETE', expect: 'json' });
  }

  function setInterfaceStatus(id, status) {
    return request(`/admin/interfaces/${id}/status`, { method: 'POST', json: { status }, expect: 'json' });
  }

  // Prices
  function getPrices() {
    return request('/admin/prices', { method: 'GET', expect: 'json' });
  }

  function getPrice(id) {
    return request(`/admin/prices/${id}`, { method: 'GET', expect: 'json' });
  }

  function getPriceByTypeWeight(type, weight) {
    return request(`/admin/prices/lookup?type=${type}&weight=${weight}`, { method: 'GET', expect: 'json' });
  }

  // Public POS price lookup (no authentication required)
  function getPriceByTypeWeightPublic(type, weight) {
    return request(`/pos/prices/lookup?type=${type}&weight=${weight}`, { method: 'GET', expect: 'json', skipAuth: true });
  }

  function createPrice(payload) {
    return request('/admin/prices', { method: 'POST', json: payload, expect: 'json' });
  }

  function updatePrice(id, payload) {
    return request(`/admin/prices/${id}`, { method: 'PUT', json: payload, expect: 'json' });
  }

  function deletePrice(id) {
    return request(`/admin/prices/${id}`, { method: 'DELETE', expect: 'json' });
  }

  // Coupons
  function getCoupons() {
    return request('/admin/coupons', { method: 'GET', expect: 'json' });
  }
  function createCoupon(payload) {
    return request('/admin/coupons', { method: 'POST', json: payload, expect: 'json' });
  }
  function updateCoupon(id, payload) {
    return request(`/admin/coupons/${id}`, { method: 'PUT', json: payload, expect: 'json' });
  }
  function deleteCoupon(id) {
    return request(`/admin/coupons/${id}`, { method: 'DELETE', expect: 'json' });
  }

  // Marketing
  function getMarketingOptInCount() {
    return request('/admin/marketing/opt-in-count', { method: 'GET', expect: 'json' });
  }
  function sendMarketingBroadcast(payload) {
    return request('/admin/marketing/broadcast', { method: 'POST', json: payload, expect: 'json' });
  }

  // Peripherals
  function getPeripherals() {
    return request('/admin/peripherals', { method: 'GET', expect: 'json' });
  }


  function createPeripheral(payload) {
    return request('/admin/peripherals', { method: 'POST', json: payload, expect: 'json' });
  }

  function updatePeripheral(id, payload) {
    return request(`/admin/peripherals/${id}`, { method: 'PUT', json: payload, expect: 'json' });
  }


  // WhatsApp (Round 14 — Baileys)
  function getWhatsappStatus() {
    return request('/admin/whatsapp/status', { method: 'GET', expect: 'json' });
  }
  function disconnectWhatsapp() {
    return request('/admin/whatsapp/disconnect', { method: 'POST', expect: 'json' });
  }

  // Middleware / CoinMachine
  function activateMachine(machineData) {
    return request('/middleware/activate-machine', { method: 'POST', json: machineData, expect: 'json' });
  }

  // Start / release a machine with no payment. On the central server this is queued for the
  // shop and answers { queued: true }; on the shop PC it happens at once.
  function adminStartMachine(id, blocks) {
    return request(`/admin/machines/${id}/start`, { method: 'POST', json: blocks > 1 ? { blocks } : undefined, expect: 'json' });
  }
  function adminShopStatus() {
    return request('/admin/shop-status', { method: 'GET', expect: 'json' });
  }
  function adminEndMachine(id) {
    return request(`/admin/machines/${id}/end`, { method: 'POST', expect: 'json' });
  }




  // Tenant management (admin)
  function getTenants() {
    return request('/admin/tenants', { method: 'GET', expect: 'json' })
  }

  function createTenant(payload) {
    return request('/admin/tenants', { method: 'POST', json: payload, expect: 'json' })
  }

  function updateTenant(id, payload) {
    return request(`/admin/tenants/${id}`, { method: 'PUT', json: payload, expect: 'json' })
  }

  function assignTenantUser(tenantId, userId, role) {
    return request(`/admin/tenants/${tenantId}/users`, { method: 'POST', json: { userId, role }, expect: 'json' })
  }

  // Note: `me()` removed — use tokens returned from /auth/login and backend-provided JWT payloads when needed.

  return {
    request,
    login,
    changePassword,

    // Machines
    getMachines,
    getMachine,
    getPublicMachines,
    createMachine,
    updateMachine,
    deleteMachine,
    logMachineService,
    getMaintenanceTickets,
    resolveMaintenanceTicket,

    // Users
    getUsers,
    createUser,
    updateUser,
    deleteUser,

    // Transactions
    getTransactions,
    createTransaction,
    refundTransaction,
    getAuditLog,
    exportTransactionsCsv,
    exportRevenueCsv,
    downloadBlob,

    // Settings
    getAnalyticsRevenue,
    getAnalyticsMachines,
    getAnalyticsMachineMonths,
    getAnalyticsRhythm,
    getAnalyticsInsights,
    getKioskHealth,
    getSettings,
    getSetting,
    getPublicSetting,
    setSetting,
    deleteSetting,
    uploadBannerImage,

    // Gateways
    gatewayGetCard,
    gatewayTopupCard,
    verifyAdminPin,
    renewStaffPin,
  getKioskDayCloseSummary,
  createKioskDayClose,
    getKioskDayCloseSummary,
    createKioskDayClose,
    emailKioskDayCloseReceipt,
    gatewayCardPay,
    gatewayCashPay,
    wifiVoucher,
    emailReceipt,

    // Interfaces
    getInterfaces,
    createInterface,
    updateInterface,
    deleteInterface,
    setInterfaceStatus,

    // Prices
    getPrices,
    getPrice,
    getPriceByTypeWeight,
    getPriceByTypeWeightPublic,
    createPrice,
    updatePrice,
    deletePrice,

    // Coupons
    getCoupons,
    createCoupon,
    updateCoupon,
    deleteCoupon,

    // Marketing
    getMarketingOptInCount,
    sendMarketingBroadcast,

    // Peripherals
    getPeripherals,
    createPeripheral,
    updatePeripheral,

    // WhatsApp
    getWhatsappStatus,
    disconnectWhatsapp,

    // Middleware
    activateMachine,
    adminStartMachine,
    adminEndMachine,
    adminShopStatus,

    // Day Close
    getDayCloseSummary,
    getDayCloses,
    createDayClose,
    addDayCloseFloat,
    restoreHopper,
    withdrawCash,
    exchangeCash,
    payoutBankCoins,
    payoutBankCoinsKiosk,
    withdrawKioskCash,
    emptyHopper,
    reinitHardware,
    resetControllerLink,
    keepCredit,
    getHardwareHealth,
    kioskResetControllerLink,
    adminCommand,
    updateCardProfile,
    blankCardAtReader,
    giftKioskCard,
    rotateUserKey,
    setCentralKey,
    centralKeyStatus,
    staffStartMachine,
    staffEndMachine,
    adminGiftCard,
    refillKioskHopper,
    exchangeKioskCash,
    restoreKioskHopper,
    emptyKioskHopper,
    emailDayCloseReceipt,

    // Tenants
    getTenants,
    createTenant,
    updateTenant,
    assignTenantUser,
  };
}

// ---- Default instance (adjust to your app) ----
const BASE_URL = import.meta?.env?.VITE_API_BASE ?? '/api';
const getToken = () => localStorage.getItem('ws_token');
const getTenantId = () => localStorage.getItem('ws_tenant') || null;

export const api = createApi({
  baseURL: BASE_URL,
  getToken,
  getTenantId,
  // If you move to httpOnly cookies:
  // credentials: 'include',
});

// Prefer named exports for tree-shaking
export const {
  request,
  login,
  getMachines,
  getMachine,
  createMachine,
  updateMachine,
  deleteMachine,
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  getTransactions,
  createTransaction,
  getAnalyticsRevenue,
  getAnalyticsMachines,
  getKioskHealth,
  getSettings,
  getSetting,
  getPublicSetting,
  setSetting,
  deleteSetting,
  gatewayGetCard,
  gatewayTopupCard,
  verifyAdminPin,
  gatewayCardPay,
  gatewayCashPay,
  wifiVoucher,
  emailReceipt,
  getInterfaces,
  createInterface,
  updateInterface,
  deleteInterface,
  setInterfaceStatus,
  getPrices,
  getPrice,
  getPriceByTypeWeight,
  getPriceByTypeWeightPublic,
  createPrice,
  updatePrice,
  deletePrice,
  getPeripherals,
  createPeripheral,
  updatePeripheral,
  activateMachine,
  adminStartMachine,
  adminEndMachine,
  adminShopStatus,
  getDayCloseSummary,
  getDayCloses,
  createDayClose,
  addDayCloseFloat,
  emailDayCloseReceipt,
  emailKioskDayCloseReceipt,
} = api;

export default api;

