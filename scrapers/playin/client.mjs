// Shared Play-In HTTP client: one global pacer for every request, retries with back-off,
// and helpers to read the Next.js pages (RSC payload) and call the site's search server action.
//
// Node's built-in fetch only uses HTTPS_PROXY with NODE_USE_ENV_PROXY=1 (set by the npm scripts).

export const BASE = 'https://www.play-in.com';
export const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

// Server action behind /fr/recherche (client name "fetchSearchResults"). Its id changes when the
// site is redeployed: find it again with
//   curl -s https://www.play-in.com/fr/recherche?search=x | grep -o '_next/static/chunks/[^"]*js'
// then grep those chunks for createServerReference("<id>", …, "fetchSearchResults").
export const SEARCH_ACTION = '40e606700053d613cc7e46a4154d27c89761f0696d';

export const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1] ?? true]);
    return acc;
  }, []),
);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- global pacer: one request start every `interval` ms ----------
const BASE_INTERVAL = Number(args.interval ?? 700);
let interval = BASE_INTERVAL;
let nextSlot = 0;
let lastThrottle = 0;
async function pace() {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + interval;
  if (slot > now) await sleep(slot - now);
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

async function request(url, init, attempt = 0) {
  await pace();
  let res;
  try {
    res = await fetch(url, { ...init, headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9', ...init?.headers }, signal: AbortSignal.timeout(45000) });
  } catch (e) {
    // network error / timeout: back off up to ~6 min total so a short outage pauses instead of skipping items
    if (attempt < 10) { await sleep(Math.min(60000, 2000 * 2 ** attempt)); return request(url, init, attempt + 1); }
    throw e;
  }
  if ((res.status === 429 || res.status === 403) && attempt < 8) {
    throttled();
    console.warn(`  ${res.status} on ${url}, interval now ${interval}ms`);
    return request(url, init, attempt + 1);
  }
  if (res.status >= 500 && attempt < 5) {
    await sleep(5000 * 2 ** attempt);
    return request(url, init, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

export const getHtml = (pathname) => request(`${BASE}${pathname}`);

/** Calls the search server action; returns { items, totalCount, catalog } (items: CatalogResult[]). */
export async function search({ searchTerms = '', page = 1, filters = {}, orderBy = [] }) {
  const text = await request(`${BASE}/fr/recherche`, {
    method: 'POST',
    headers: { 'Next-Action': SEARCH_ACTION, Accept: 'text/x-component', 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify([{ searchTerms, lang: 'fr', page, filters, orderBy }]),
  });
  const line = text.split('\n').find((l) => l.startsWith('1:'));
  if (!line) throw new Error(`Unexpected server action response (action id changed?): ${text.slice(0, 200)}`);
  return JSON.parse(line.slice(2));
}

// ---------- RSC payload of a server-rendered page ----------
/** Concatenated `self.__next_f.push([1, "…"])` chunks of a Next.js page. */
export function rscPayload(html) {
  let rsc = '';
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) rsc += JSON.parse(m[1]);
  return rsc;
}

/** Parses the JSON object that starts at s[i] === '{'. */
function objectAt(s, i) {
  let depth = 0;
  let str = false;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (str) {
      if (c === '\\') j++;
      else if (c === '"') str = false;
    } else if (c === '"') str = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(s.slice(i, j + 1));
  }
  throw new Error('unterminated object');
}

/** Every `{"__typename": "<typename>", …}` object of the payload. */
export function rscObjects(rsc, typename) {
  const out = [];
  for (const m of rsc.matchAll(new RegExp(`\\{"__typename":"${typename}"`, 'g'))) {
    try { out.push(objectAt(rsc, m.index)); } catch { /* truncated or non-JSON fragment */ }
  }
  return out;
}
