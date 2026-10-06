// Shared MyLudo HTTP client: session cookie + CSRF token, and one global pacer
// for every request, since the site rate-limits (HTTP 429) around ~1.3 req/s.

export const BASE = 'https://www.myludo.fr';
export const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

export const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1] ?? true]);
    return acc;
  }, []),
);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- global pacer: one request start every `interval` ms ----------
const BASE_INTERVAL = Number(args.interval ?? 800);
let interval = BASE_INTERVAL;
let nextSlot = 0;
let lastThrottle = 0;
async function pace() {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + interval;
  if (slot > now) await sleep(slot - now);
  // slowly relax back toward the base interval after a 429
  if (interval > BASE_INTERVAL && Date.now() - lastThrottle > 120000) {
    interval = Math.max(BASE_INTERVAL, Math.round(interval * 0.9));
    lastThrottle = Date.now();
  }
}
function throttled() {
  interval = Math.min(5000, Math.round(interval * 1.25));
  lastThrottle = Date.now();
  nextSlot = Date.now() + 10000;
}
export const currentInterval = () => interval;

// ---------- session (cookie + CSRF token) ----------
let cookies = {};
let token = null;
let tokenPromise = null;

function storeCookies(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    cookies[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
}
const cookieHeader = () => Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');

async function refreshToken() {
  if (tokenPromise) return tokenPromise;
  tokenPromise = (async () => {
    if (!Object.keys(cookies).length) {
      const home = await fetch(`${BASE}/`, { headers: { 'User-Agent': UA } });
      storeCookies(home);
    }
    const res = await fetch(`${BASE}/views/login/datas.php?type=token`, {
      headers: { 'User-Agent': UA, Cookie: cookieHeader(), 'X-Requested-With': 'XMLHttpRequest' },
    });
    storeCookies(res);
    const json = await res.json();
    if (!json.token) throw new Error('No CSRF token returned');
    token = json.token;
  })().finally(() => { tokenPromise = null; });
  return tokenPromise;
}

// GET views/<view>/datas.php?<params>; returns parsed JSON, or null on 404 / empty body.
export async function api(view, params, attempt = 0) {
  if (!token) await refreshToken();
  const url = `${BASE}/views/${view}/datas.php?${new URLSearchParams({ ...params, _: Date.now() })}`;
  await pace();
  let res;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Cookie: cookieHeader(),
        'X-Csrf-Token': token,
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `${BASE}/`,
      },
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    // network error / timeout: back off up to ~6 min total so a short outage pauses instead of skipping items
    if (attempt < 10) { await sleep(Math.min(60000, 2000 * 2 ** attempt)); return api(view, params, attempt + 1); }
    throw e;
  }
  storeCookies(res);
  if (res.status === 401 && attempt < 3) { token = null; await refreshToken(); return api(view, params, attempt + 1); }
  if (res.status === 429 && attempt < 8) {
    throttled();
    console.warn(`  429 on ${view}/${params.type}/${params.id}, interval now ${interval}ms`);
    return api(view, params, attempt + 1);
  }
  if (res.status >= 500 && attempt < 5) {
    await sleep(5000 * 2 ** attempt);
    return api(view, params, attempt + 1);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${view}/${params.type}/${params.id}`);
  const text = await res.text();
  if (!text.trim()) return null;
  return JSON.parse(text);
}
