import { readFile } from "node:fs/promises";
import { cents, isStock, normalize } from "./recommendations.js";

const defaultBrands = ["Savarez", "Mac Mah", "Elokance", "Lâg", "PRS", "Ibanez"];
const brandOf = value => normalize(value).replace(/ guitars?$/, "");
const localFamilies = new Set(["electric", "amp", "headphoneRig", "pa"]);
const localCategories = /\b(?:guitares?|basses?|amplis?|amplificateurs?|sonorisations?|enceintes?|pedales? (?:d effets?|guitare)|effects? pedals?)\b/;
const accessoryTitle = /\b(?:cordes?|housses?|etuis?|cables?|supports?|mediators?|sangles?|alimentations?) (?:de |d |pour )/;

export function commercialPolicy(input = {}) {
  const priority = Array.isArray(input.priorityBrands) ? input.priorityBrands : ["Prodipe"];
  const preferred = Array.isArray(input.preferredBrands) ? input.preferredBrands : defaultBrands;
  const threshold = Number.isSafeInteger(input.localStockBelowCents) && input.localStockBelowCents >= 0
    ? input.localStockBelowCents : 6000;
  const products = input.products ?? {};
  if (typeof products !== "object" || Array.isArray(products)) throw new TypeError("Invalid product policies");
  const entries = new Map(Object.entries(products).map(([sku, rule]) => [sku.trim().toUpperCase(), rule]));
  const brands = [priority, preferred].map(group => group.map(brandOf).filter(Boolean));
  const matchesBrand = (product, names) => {
    const brand = brandOf(product.brand);
    const title = normalize(product.title);
    return names.some(name => brand === name || (!brand && (title === name || title.startsWith(name + " "))));
  };
  return (product, slot, now) => {
    const rule = entries.get(String(product.id ?? "").trim().toUpperCase());
    const price = cents(product.price);
    const identity = normalize([product.title, product.productType, ...(product.categories ?? [])].join(" "));
    const local = (price !== null && price < threshold) || localFamilies.has(slot.family) ||
      slot.bass || ["pedal", "multi"].includes(slot.effectKind) || (!accessoryTitle.test(normalize(product.title)) && localCategories.test(identity));
    const configuredSource = Date.parse(rule?.stockValidUntil) > now ? rule.stockSource : null;
    const source = configuredSource ?? product.stockSource;
    const stockRank = local ? (source === "store" && isStock(product) ? 2 : source === "supplier" ? 0 : 1) : 1;
    const activePromotion = price !== null && cents(product.referencePrice) > price;
    const currentCampaign = !rule?.campaignValidUntil || Date.parse(rule.campaignValidUntil) > now;
    const clearance = (product.categories ?? []).some(category => /^(?:destockage|liquidation de stock)$/.test(normalize(category)));
    const promotion = (currentCampaign && ["clearance", "promotion"].includes(rule?.campaign)) || activePromotion || clearance;
    const matches = slot.preferredBrand && matchesBrand(product, [brandOf(slot.preferredBrand)]) ? 3
      : matchesBrand(product, brands[0]) ? 2 : matchesBrand(product, brands[1]) ? 1 : 0;
    return [stockRank, Number(currentCampaign && rule?.push === true), Number(promotion), isStock(product) ? matches : 0];
  };
}

export const defaultCommercialPolicy = commercialPolicy();
export const compareCommercialRank = (a, b) => {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return b[i] - a[i];
  }
  return 0;
};
export const sumCommercialRank = (a, b) => a.map((value, index) => value + b[index]);

export function createCommercialPolicyReader(path) {
  let last = defaultCommercialPolicy;
  let previous;
  return async () => {
    if (!path) return last;
    try {
      const content = await readFile(path, "utf8");
      if (previous !== content) {
        const config = JSON.parse(content);
        if (!config || typeof config !== "object" || Array.isArray(config)) throw new TypeError("Invalid policy");
        last = commercialPolicy(config);
        previous = content;
      }
    } catch {
      // Keep serving the last valid policy after an unavailable or interrupted update.
      console.warn("Configuration commerciale indisponible ou invalide.");
    }
    return last;
  };
}
