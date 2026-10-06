// Parse a Philibert product page (PrestaShop).
//   - barcode: the "EAN" line of the "Fiche technique" section (product-features__name / __value), and
//     only that one: the JSON-LD gtin and the EAN at the end of the URL are kept apart (gtin_jsonld,
//     url_ean) and never used for matching.
//   - pictures: the product gallery (product-image__item), largest size (thickbox_default), one per image.
// Philibert rules PDFs are not collected (not asked for).

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export const decode = (s) =>
  String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
    e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m,
  );
const text = (html) => decode(String(html ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const tryJson = (s) => { try { return JSON.parse(s); } catch { return null; } };

/** The "Fiche technique" section as { label: value } (values of a label listed several times are joined). */
export function features(html) {
  const sheet = {};
  for (const m of html.matchAll(/class="product-features__name[^"]*"[^>]*>([\s\S]*?)<\/span>([\s\S]*?)<\/li>/g)) {
    const label = text(m[1]);
    const values = [...m[2].matchAll(/class="product-features__value[^"]*"[^>]*>([\s\S]*?)<\/(?:span|a|div)>/g)].map((v) => text(v[1])).filter(Boolean);
    if (label && values.length && !(label in sheet)) sheet[label] = values.join(', ');
  }
  return sheet;
}

function jsonLdProduct(html) {
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    const o = tryJson(m[1].trim());
    for (const x of [].concat(o ?? [], o?.['@graph'] ?? [])) if ([].concat(x?.['@type'] ?? []).includes('Product')) return x;
  }
  return null;
}

export function parseProduct(html, url) {
  const id = Number(url.match(/\/(\d+)-[^/]*\.html$/)?.[1]) || null;
  const sheet = features(html);
  const ld = jsonLdProduct(html);
  const name = text(html.match(/<h1[^>]*id="product-title"[^>]*>([\s\S]*?)<\/h1>/)?.[1]) || ld?.name || null;
  if (!id || !name) return null;

  const ean = (sheet.EAN ?? sheet.EAN13 ?? '').replace(/\D/g, '');
  const canonical = decode(html.match(/<link rel="canonical" href="([^"]+)"/)?.[1] ?? '') || url;
  const gallery = [...html.matchAll(/class="product-image__item"[^>]*>\s*<img[^>]*src="(https:\/\/cdn\d*\.philibertnet\.com\/(\d+)-[a-z_]+\/[^"]+)"/g)];
  const byId = new Map();
  for (const [, src, imageId] of gallery) if (!byId.has(imageId)) byId.set(imageId, src.replace(/\/\d+-[a-z_]+\//, `/${imageId}-thickbox_default/`));
  const og = decode(html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] ?? '');
  if (!byId.size && og) byId.set('og', og);
  const offer = [].concat(ld?.offers ?? [])[0];
  return {
    id,
    url: canonical,
    name,
    barcode: [8, 12, 13, 14].includes(ean.length) ? ean : null,
    barcode_raw: sheet.EAN ?? sheet.EAN13 ?? null,
    gtin_jsonld: ld?.gtin ?? ld?.gtin13 ?? null,
    url_ean: url.match(/-(\d{8,14})\.html$/)?.[1] ?? null,
    reference: text(html.match(/class="[^"]*product-reference[^"]*"[^>]*>[\s\S]*?<span>([\s\S]*?)<\/span>/)?.[1]) || ld?.sku || null,
    publisher: url.split('/')[4] ?? null,
    price_eur: Number(offer?.price) || null,
    details: sheet,
    images: [...byId.values()],
    rules: [],
  };
}
