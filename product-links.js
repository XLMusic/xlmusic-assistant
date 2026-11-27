const origin = "https://www.xlmusic.fr";
const verifiedSquier = {
  id: "037-3150-547",
  gtin: "197955143101",
  // The public XLMusic listing identifies this exact SKU.
  url: origin + "/squier-sonic-stratocaster-sienna-sunburst-c2x42636242"
};

function shopProduct(value) {
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || url.username || url.password) return null;
    if (/^\/[a-z0-9-]*-c2x\d+\/?$/i.test(url.pathname)) return url.origin + url.pathname;
    if (/^\/PBSCProduct\.asp$/i.test(url.pathname) && /^[1-9]\d*$/.test(url.searchParams.get("ItmID") ?? "")) {
      return origin + "/PBSCProduct.asp?ItmID=" + url.searchParams.get("ItmID");
    }
  } catch {
    return null;
  }
  return null;
}

function confirmsIdentity(html, product) {
  const sku = String(product.id ?? "").trim().toLowerCase();
  const gtin = String(product.gtin ?? "").trim();
  const schema = /schema\.org\/Product|property\s*=\s*["']og:type["']\s+content\s*=\s*["']product["']|"@type"\s*:\s*"Product"/i;
  if (!schema.test(html)) return false;
  const identifiers = [...html.matchAll(/"(?:sku|gtin(?:8|12|13|14)?)"\s*:\s*"?([^"\s,}<]+)"?/gi)];
  if (identifiers.some(([, value]) => [sku, gtin].filter(Boolean).includes(value.toLowerCase()))) return true;
  const visibleText = html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ");
  const codes = [...visibleText.matchAll(/\b(?:code|réf(?:érence)?|ean)\s*:\s*([^\n()]+)/gi)];
  return codes.some(([, value]) => [sku, gtin].filter(Boolean).some(id => {
    const code = value.trim().toLowerCase();
    return code === id || code.startsWith(id + " ");
  }));
}

function confirmsPrimaryProduct(html, product) {
  const identifiers = [product.id, product.gtin].filter(Boolean).map(value => String(value).trim().toLowerCase());
  const script = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const data = [...html.matchAll(script)].map(([, value]) => value);
  if (html.trimStart().startsWith("{")) data.push(html);
  const main = [];
  const described = [];
  const isProduct = node => [node?.["@type"]].flat().some(type => typeof type === "string" &&
    /(?:^|\/)Product$/i.test(type));
  for (const value of data) {
    let root;
    try { root = JSON.parse(value); } catch { continue; }
    for (const node of [root].flat().flatMap(entry => Array.isArray(entry?.["@graph"]) ? entry["@graph"] : [entry])) {
      if (isProduct(node)) described.push(node);
      if (isProduct(node?.mainEntity)) main.push(node.mainEntity);
    }
  }
  const matches = node => [node.sku, node.gtin, node.gtin8, node.gtin12, node.gtin13, node.gtin14]
    .some(value => value != null && identifiers.includes(String(value).trim().toLowerCase()));
  const primary = main.length ? main : described;
  if (primary.length) return primary.every(matches);
  const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const comparable = value => String(value ?? "").replace(/<[^>]*>/g, " ").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const title = comparable(product.title);
  return Boolean(title && title === comparable(heading)) && confirmsIdentity(html, product);
}

function routeId(value) {
  const url = new URL(value);
  return url.pathname.match(/-c2x(\d+)\/?$/i)?.[1] ?? url.searchParams.get("ItmID");
}

export function createProductLinkVerifier(fetchImpl = fetch, { strict = false } = {}) {
  const cache = new Map();
  return async product => {
    const isVerifiedSquier = product.id === verifiedSquier.id &&
      (!product.gtin || product.gtin === verifiedSquier.gtin);
    const fallback = isVerifiedSquier ? verifiedSquier.url : null;
    const oxId = String(product.oxId ?? "");
    const lookup = /^[1-9]\d*$/.test(oxId) ? `${origin}/PBSCProduct.asp?ItmID=${oxId}` : "";
    const possible = [...new Set([shopProduct(product.url), fallback, shopProduct(lookup)].filter(Boolean))];
    const starts = strict ? possible.filter(url => !oxId || routeId(url) === oxId) : possible.slice(0, 1);
    if (!starts.length) return strict ? null : fallback;
    const key = JSON.stringify([starts, product.id, product.gtin, oxId]);
    const cached = cache.get(key);
    if (cached?.expires > Date.now()) return cached.result;
    const signal = AbortSignal.timeout(2500);
    const visited = new Set();
    let link = null;
    let definitivelyMissing = false;
    for (const start of starts) {
      let url = start;
      try {
        for (let redirects = 0; url && !visited.has(url) && redirects <= 2; redirects++) {
          if (strict && oxId && routeId(url) !== oxId) break;
          visited.add(url);
          const response = await fetchImpl(url, { redirect: "manual", signal });
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            await response.body?.cancel();
            const location = response.headers.get("location");
            url = location ? shopProduct(new URL(location, url)) : null;
            if (!url) definitivelyMissing = true;
            continue;
          }
          if (response.ok) {
            const html = await response.text();
            const confirmed = strict ? confirmsPrimaryProduct(html, product) : confirmsIdentity(html, product);
            if (confirmed) link = url;
            else definitivelyMissing = true;
          } else {
            if ([404, 410].includes(response.status)) definitivelyMissing = true;
            await response.body?.cancel();
          }
          break;
        }
      } catch {
        // A public product page can be temporarily unavailable independently of Oxatis.
      }
      if (link || signal.aborted) break;
    }
    const result = link || (!strict && !definitivelyMissing && fallback);
    if (cache.size >= 2000) cache.delete(cache.keys().next().value);
    const lifetime = strict ? (link ? 300_000 : 30_000) : (link ? 3_600_000 : 300_000);
    cache.set(key, { result: result || null, expires: Date.now() + lifetime });
    return result || null;
  };
}
