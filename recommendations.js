export const normalize = value => String(value ?? "").toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

const patterns = {
  electric: /\bguitares? electriques?\b/,
  amp: /\b(?:amplis?|amplificateurs?) (?:combo |a lampes |a transistors )?(?:de |pour )?guitare\b|\bcombos? (?:pour )?guitare\b/,
  headphoneRig: /\b(?:amplis?|amplificateurs?|ampli casque) (?:de |pour )casque\b|\bampli casque\b|\b(?:multi effets?|modeliseurs?|processeurs? d effets?)\b/,
  pa: /\benceintes?\b|\b(?:sono(?:risation)?|systemes? de sonorisation) (?:portable|autonome|amplifiee?)\b/
};

export const traits = {
  battery: /\b(?:sur batterie|batterie (?:integree|interne|rechargeable|lithium)|(?:fonctionnement|alimentation|fonctionne) (?:sur |par |avec )?(?:piles?|batterie))\b/,
  bluetooth: /\bbluetooth\b/,
  headphone: /\b(?:(?:sortie|prise|jack) (?:pour )?casque|ampli casque)\b/,
  microphone: /\b(?:(?:entrees?|prises?) (?:pour )?micro(?:phones?)?|micro(?:phones?)? sans fil (?:inclus|fourni|livre)s?|(?:avec|inclus|fournis avec|livre avec) (?:deux |un |2 )?micros?)\b/
};

const personalGuitarAmp = /\bamplificateur (?:de|pour) guitare personnel\b/;
const directGuitar = /\b(?:directement (?:dans|sur|a|a la|au) (?:la |votre )?guitare|directement (?:sur|dans) (?:la |votre )?prise jack)\b/;
export const isStock = product => ["in stock", "in_stock"].includes(product.availability);

const clarification = "Vous pouvez me préciser le matériel recherché et les critères indispensables ?";
const stringList = { type: "array", items: { type: "string" } };
const object = properties => ({
  type: "object", properties, required: Object.keys(properties), additionalProperties: false
});

export const intentFormat = {
  type: "json_schema", name: "xlmusic_achat", strict: true,
  schema: object({
    slots: { type: "array", items: object({
      family: { type: "string", enum: [...Object.keys(patterns), "other"] },
      names: stringList, brands: stringList,
      required: { type: "array", items: { type: "string", enum: Object.keys(traits) } },
      evidence: stringList, excluded: stringList, preferred: stringList
    }) },
    maxCents: { type: ["integer", "null"] },
    exclusive: { type: "boolean" },
    inStock: { type: "boolean" },
    question: { type: "string", enum: ["none", "clarify", "venue", "microphone", "headphones", "cable", "usage"] }
  })
};

export const intentInstructions = `Analyse les messages successifs du client pour rechercher du matériel chez XLMusic.
Le dernier message prime en cas de correction. Conserve les contraintes précédentes dans un suivi pertinent.
Décris l'achat en 1 ou 2 slots, un par article à acheter. Des alternatives occupent le même slot.
Si le panier dépasse deux articles ou si une contrainte impérative ne peut pas être représentée sans deviner, renvoie slots vide et question clarify.
electric = guitare électrique, amp = ampli guitare traditionnel, headphoneRig = système pour casque sans ampli traditionnel (exige headphone), pa = enceinte de sonorisation.
Pour other, names doit donner des synonymes précis du type de produit recherché, à reconnaître dans le titre ou la catégorie (ou la référence exacte).
Pour les autres familles, laisse names vide sauf demande de modèle précis. Ne mets jamais un produit déjà possédé dans un slot ni dans brands.
brands contient seulement les marques explicitement demandées, en OU. required contient toutes les fonctions impératives reconnues. evidence contient les autres caractéristiques impératives en expressions littérales françaises courtes. excluded contient les caractéristiques explicitement refusées. preferred contient les souhaits souples, par ex. rock ou débutant.
Pour chanter avec une enceinte, exige microphone, même si le client a déjà un micro. N'estime pas une jauge uniquement par la puissance. Question venue si intérieur/extérieur n'est pas précisé.
maxCents est le budget total TTC en centimes, même pour un ensemble. exclusive vaut vrai pour « moins de ». Un montant approximatif reste un plafond. Ne confonds pas quantité, jauge ou numéro de modèle avec un budget.
inStock est vrai si le stock est impératif. Utilise question uniquement si une réponse change le conseil, et ne repose pas une question déjà répondue.
Ne produis ni conseil, ni produit, ni prix. Retourne seulement l'intention structurée.`;

export function cents(value) {
  const match = String(value ?? "").trim().match(/^(\d+(?:[ .\u00a0\u202f]\d{3})*)(?:[,.](\d{1,2}))?\s*(?:EUR|€)?$/i);
  if (!match) return null;
  const result = Number(match[1].replace(/\D/g, "")) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(result) && result > 0 ? result : null;
}

function withExplicitBudget(plan, message) {
  const amount = "[0-9]+(?:[ \\u00a0\\u202f][0-9]{3})*(?:[,.][0-9]{1,2})?";
  const qualified = new RegExp(`(moins de|en dessous de|inférieur à|au maximum|maximum(?: de)?|jusqu['’]à|budget(?: total| global| de référence)?(?: de| à| est(?: de)?)?|autour de|pas plus de)\\s*(${amount})\\s*(?:€|euros?\\b|eur\\b)`, "giu");
  const ceiling = [...message.matchAll(qualified)].at(-1);
  const amounts = [...message.matchAll(new RegExp(`(${amount})\\s*(?:€|euros?\\b|eur\\b)`, "giu"))];
  // Defer when different amounts may represent different budgets.
  const trailingMaximum = new RegExp(`(${amount})\\s*(?:€|euros?\\b|eur\\b)\\s*(?:maximum|maxi|max|au plus)\\b`, "iu").exec(message);
  if (trailingMaximum && new Set(amounts.map(match => cents(match[1]))).size === 1) {
    return { ...plan, maxCents: cents(trailingMaximum[1]), exclusive: false };
  }
  if (!ceiling || new Set(amounts.map(match => cents(match[1]))).size !== 1) return plan;
  return { ...plan, maxCents: cents(ceiling[2]), exclusive: /moins de|en dessous|inférieur/i.test(ceiling[1]) };
}

export function applyExplicitConstraints(intent, message) {
  const plan = withExplicitBudget(intent, message);
  const text = normalize(message);
  const stockRequired = /\b(?:en stock uniquement|uniquement en stock|avez vous en stock|produits en stock)\b/.test(text);
  const headphonesWithoutAmp = /\b(?:jouer|jeu) au casque\b/.test(text) &&
    /\bsans (?:utiliser (?:(?:mon|l|un|d) )?)?(?:ampli|amplificateur)\b/.test(text);
  const batteryPa = /\benceinte\b/.test(text) && /\bsur batterie\b/.test(text);
  const family = headphonesWithoutAmp ? "headphoneRig" : batteryPa ? "pa" : null;
  if (family && !plan.slots.some(slot => slot.family === family)) return { ...plan, slots: [], question: "clarify" };
  const slots = plan.slots.map(slot => {
    const required = new Set(slot.required);
    if (slot.family === "headphoneRig") required.add("headphone");
    if (slot.family === "pa" && batteryPa) {
      required.add("battery");
      if (/\bavec bluetooth\b/.test(text)) required.add("bluetooth");
      if (/\b(?:pour chanter|je suis chanteur|je suis chanteuse)\b/.test(text)) required.add("microphone");
    }
    return { ...slot, required: [...required] };
  });
  return { ...plan, slots, inStock: plan.inStock || stockRequired };
}

const includes = (text, term) => Boolean(term) && ` ${text} `.includes(` ${term} `);
const matchesAny = (text, terms) => terms.some(term => includes(text, normalize(term)));

function confirms(product, pattern) {
  const clauses = [product.title, ...(product.description ?? "").split(/[.;!?\n]|\bmais\b/i)]
    .map(normalize).filter(clause => pattern.test(clause));
  const negated = /\b(?:sans (?!fil\b)|pas de|non compatible|en option|vendue?s? separement|uniquement sur secteur|desactivee?)\b/;
  return clauses.length > 0 && clauses.every(clause => !negated.test(clause)) &&
    (pattern !== traits.battery || !/\b(?:sans batterie|sur secteur uniquement|uniquement sur secteur|batterie non incluse)\b/.test(normalize(product.description)));
}

export function familyMatches(product, slot) {
  const title = normalize(product.title);
  const category = normalize(product.productType);
  const identity = [title, category, normalize(product.id), normalize(product.gtin)];
  if (slot.names.length && !identity.some(field => matchesAny(field, slot.names))) return false;
  if (slot.family === "other") return slot.names.length > 0;
  if (slot.family === "electric" && /\b(?:cable|cordes|housse|etui|support|pedale|micro pour|ampli|amplificateur|casque|piece|pack)\b/.test(title)) return false;
  if (slot.family === "pa" && /\b(?:housse|pied|support|enceintes? passives?|enceintes? de monitoring|enceintes? de studio|batterie de rechange|extension battery|batterie supplementaire)\b/.test(title)) return false;
  if (slot.family === "headphoneRig" && /\b(?:combos?|amplis? a lampes|amplis? a transistors)\b/.test(title)) return false;
  if (patterns[slot.family].test(title) || patterns[slot.family].test(category)) return true;
  if (slot.family !== "headphoneRig") return false;
  const description = normalize(product.description);
  return /\bampli(?:ficateur)? (?:de |pour )?casque\b/.test(description) ||
    (personalGuitarAmp.test(description) && directGuitar.test(description));
}

function productKey(product) {
  return String(product.oxId ?? product.id);
}

function fit(product, slot, plan) {
  const stock = isStock(product);
  const order = product.availability === "sur commande, délai à confirmer" || product.availability === "backorder";
  const price = cents(product.price);
  if (product.visible === false || (!stock && (!order || plan.inStock)) || price === null ||
      !within(price, plan) || !familyMatches(product, slot)) return null;
  const title = normalize(product.title);
  const brand = normalize(product.brand);
  if (slot.brands.length && !slot.brands.some(name => brand ? brand === normalize(name) : includes(title, normalize(name)))) return null;
  const text = normalize([product.title, product.productType, product.description].join(" "));
  if (matchesAny(text, slot.excluded) || slot.required.some(trait => !confirms(product, traits[trait])) ||
      slot.evidence.some(term => {
        const phrase = normalize(term);
        return !phrase || !confirms(product, new RegExp(`\\b${phrase}\\b`));
      })) return null;
  const preference = slot.preferred.filter(term => includes(text, normalize(term))).length;
  const complexBridge = slot.family === "electric" && matchesAny(normalize(slot.preferred.join(" ")), ["debutant", "debuter"]) &&
    /\b(?:floyd rose|vibrato flottant)\b/.test(text);
  return { product, price, score: (stock ? 10 : 0) + preference - (complexBridge ? 4 : 0) };
}

export function within(price, { maxCents, exclusive }) {
  return maxCents === null || (exclusive ? price < maxCents : price <= maxCents);
}

function assortments(products, plan, limit) {
  const parts = plan.slots.map(slot => products.map(product => fit(product, slot, plan)).filter(Boolean));
  if (parts.length === 1) return parts[0].sort(compare).slice(0, limit).map(item => [item]);
  const best = [];
  for (const first of parts[0]) {
    for (const second of parts[1]) {
      if (productKey(first.product) === productKey(second.product) || !within(first.price + second.price, plan)) continue;
      const bundle = { items: [first, second], price: first.price + second.price, score: first.score + second.score };
      const index = best.findIndex(item => compare(bundle, item) < 0);
      if (index >= 0) best.splice(index, 0, bundle);
      else if (best.length < limit) best.push(bundle);
      if (best.length > limit) best.pop();
    }
  }
  return best.map(bundle => bundle.items);
}

function compare(a, b) {
  return b.score - a.score || a.price - b.price;
}

export const questions = {
  venue: "Vos prestations ont-elles lieu surtout en intérieur ou en extérieur ?",
  microphone: "Avez-vous déjà un micro pour vos prestations ?",
  headphones: "Avez-vous déjà un casque filaire ?",
  cable: "Avez-vous déjà un câble jack pour relier la guitare à l’ampli ?",
  usage: "Dans quelles conditions comptez-vous utiliser ce matériel ?",
  clarify: clarification
};

const euro = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
export const money = value => euro.format(value / 100);

export async function recommend(products, plan, { readLive, productLink = async () => null } = {}) {
  if (!plan.slots.length || plan.slots.length > 2 || plan.question === "clarify" ||
      (plan.maxCents !== null && (!Number.isSafeInteger(plan.maxCents) || plan.maxCents <= 0))) {
    return { reply: clarification, products: [] };
  }
  let choices = assortments(products, plan, 12);
  const candidates = new Map();
  for (const choice of choices) {
    for (const { product } of choice) candidates.set(productKey(product), product);
    if (candidates.size >= 4) break;
  }
  if (readLive && candidates.size) {
    const checked = await Promise.allSettled([...candidates.values()].slice(0, 4).map(p => readLive(p.oxId)));
    choices = assortments(checked.flatMap(result =>
      result.status === "fulfilled" && result.value?.visible && result.value.title ? [result.value] : []), plan, 3);
  }
  const followUp = questions[plan.question];
  if (!choices.length) {
    const opening = candidates.size
      ? "Je n’ai pas de disponibilité et de prix confirmés pour une solution qui réunit vos critères."
      : plan.slots.length === 2 && plan.maxCents !== null
        ? "Je n’ai pas d’ensemble complet à vous proposer dans ce budget."
        : "Je n’ai pas de modèle à vous proposer qui réunit tous vos critères pour le moment.";
    return { reply: [opening, followUp].filter(Boolean).join("\n\n"), products: [] };
  }
  const selected = plan.slots.length === 2 || plan.slots[0].family !== "electric" ? choices[0] : choices.slice(0, 3).flat();
  const items = await Promise.all(selected.map(async ({ product, price }) => ({
    title: product.title,
    price: money(price),
    availability: isStock(product) ? "en stock" : "sur commande, délai à confirmer",
    url: await productLink(product)
  })));
  const family = plan.slots[0].family;
  const opening = plan.slots.length === 2
    ? (plan.maxCents === null ? "Je vous conseille cet ensemble." : "Je vous conseille cet ensemble. Les deux articles tiennent dans votre budget.")
    : family === "headphoneRig"
      ? "Pour jouer au casque sans ampli traditionnel, je vous conseille cette solution."
      : family === "pa" && ["battery", "bluetooth", "microphone"].every(trait => plan.slots[0].required.includes(trait))
        ? "Je vous conseille cette enceinte sur batterie. Vous pourrez diffuser vos bandes-son en Bluetooth et utiliser un micro pour le chant."
        : items.length === 1 ? "Voici le modèle que je vous conseille." : "Voici les modèles qui correspondent à votre recherche.";
  const lines = items.map(item => `• ${item.title} — ${item.price} TTC, ${item.availability}${item.url ? `\n  ${item.url}` : ""}`);
  if (selected.some(({ product }) => product.discountRulePresent)) lines.push("Une remise peut s’appliquer selon les conditions en boutique.");
  if (plan.slots.length === 2) lines.push(`Total du matériel, hors livraison : ${money(selected.reduce((sum, item) => sum + item.price, 0))} TTC.`);
  return { reply: [opening, lines.join("\n"), followUp].filter(Boolean).join("\n\n"), products: items };
}
