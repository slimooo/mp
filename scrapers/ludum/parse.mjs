// Parse a Ludum product page (PrestaShop, theme Alysum).
//   - barcode: the "EAN13" line of the "Détails du produit" tab (its <dl class="data-sheet"> lists,
//     the EAN13 being under "Références spécifiques"), and
//     only that one: the JSON-LD gtin13 is kept apart (gtin13_jsonld) and never used for matching.
//   - pictures: product images (…/<imageId>-large_default/<slug>.jpg) from the JSON-LD Product (offers.image
//     holds the whole gallery) and og:image, one per image id (the page's other thumbnails are related products).
// Ludum has no rules PDFs: none are collected.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export const decode = (s) =>
  String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
    e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m,
  );
const text = (html) => decode(String(html ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const tryJson = (s) => { try { return JSON.parse(s); } catch { return null; } };

/** The "Détails du produit" tab (every data sheet after id="product-details") as { label: value }. */
export function dataSheet(html) {
  const sheet = {};
  const tab = html.slice(Math.max(0, html.indexOf('id="product-details"')));
  for (const [, dl] of tab.matchAll(/<dl class="data-sheet">([\s\S]*?)<\/dl>/g)) for (const m of dl.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g)) sheet[text(m[1])] = text(m[2]);
  return sheet;
}

function jsonLdProduct(html) {
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    const o = tryJson(m[1].trim());
    for (const x of [].concat(o ?? [], o?.['@graph'] ?? [])) if ([].concat(x?.['@type'] ?? []).includes('Product')) return x;
  }
  return null;
}

function productImages(urls) {
  const byId = new Map();
  for (const raw of urls) {
    if (typeof raw !== 'string') continue;
    const u = decode(raw);
    const id = u.match(/^https:\/\/www\.ludum\.fr\/(\d+)-[a-z_]+\/[^/]+\.(?:jpe?g|png|webp)$/i)?.[1];
    if (id && !byId.has(id)) byId.set(id, u.replace(/\/\d+-[a-z_]+\//, `/${id}-large_default/`));
  }
  return [...byId.values()];
}

export function parseProduct(html, url) {
  const id = Number(url.match(/-(\d+)(?:\.html)?$/)?.[1]) || null;
  const sheet = dataSheet(html);
  const ld = jsonLdProduct(html);
  const name = text(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]) || ld?.name || null;
  if (!id || !name || !html.includes('id="product-details"')) return null;

  const ean = (sheet.EAN13 ?? sheet['EAN 13'] ?? sheet.EAN ?? '').replace(/\D/g, '');
  const canonical = decode(html.match(/<link rel="canonical" href="([^"]+)"/)?.[1] ?? '') || url;
  const offer = [].concat(ld?.offers ?? [])[0];
  return {
    id,
    url: canonical,
    name,
    barcode: ean.length === 13 ? ean : null,
    barcode_raw: sheet.EAN13 ?? null,
    gtin13_jsonld: ld?.gtin13 ?? null,
    publisher: sheet['Éditeur France'] ?? sheet['Éditeur'] ?? (typeof ld?.brand === 'string' ? ld.brand : ld?.brand?.name) ?? null,
    category: url.split('/')[3] ?? null,
    availability: offer?.availability?.replace(/^https?:\/\/schema\.org\//, '') ?? html.match(/<meta property="product:availability" content="([^"]*)"/)?.[1] ?? null,
    price_eur: Number(offer?.price ?? html.match(/<meta property="product:price:amount" content="([^"]*)"/)?.[1]) || null,
    details: sheet,
    images: productImages([
      ...[...[].concat(offer?.image ?? []), ...[].concat(ld?.image ?? [])].map((im) => (typeof im === 'string' ? im : im?.url)),
      html.match(/<meta property="og:image" content="([^"]+)"/)?.[1],
    ]),
    rules: [],
  };
}
