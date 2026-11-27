import assert from "node:assert/strict";
import test from "node:test";
import { advise, adviseExactProduct } from "../advisor.js";
import { normalizeProduct } from "../oxatis.js";
import { createProductLinkVerifier } from "../product-links.js";
import { shoppingInput, shoppingPlan } from "../shopping-intent.js";

const guitarAndAmp = "Je débute la guitare électrique, j’aime le rock et j’ai un budget de 400 € pour une guitare et un ampli. Que me conseillez-vous ?";
const brands = "Quelles guitares électriques de marque Ibanez ou Squier avez-vous en stock à moins de 200 € ?";
const lowBudget = "Quelles guitares électriques avez-vous en stock à moins de 150 €, toutes marques confondues ?";
const headphones = "Je possède une guitare électrique Fender Stratocaster et je souhaite jouer au casque sans utiliser mon ampli. Quelles solutions pouvez-vous me proposer parmi vos produits en stock ?";
const singer = "Je suis chanteur et je recherche une enceinte autonome sur batterie avec Bluetooth, pour chanter lors de petites prestations devant une cinquantaine de personnes. Mon budget est de 600 €. Que me conseillez-vous ?";
const outdoors = "En extérieur, et j’ai déjà un micro.";

const slot = (family, fields = {}) => ({
  family, names: [], brands: [], required: [], evidence: [], excluded: [], preferred: [], ...fields
});
const intent = (slots, fields = {}) => ({
  slots, continuity: "new", allowOverBudget: true, maxCents: null, exclusive: false, inStock: false,
  question: "none", outdoor: false, ownsMicrophone: false, ...fields
});

function product(oxId, title, price, fields = {}) {
  return { oxId, id: oxId, visible: true, canOrder: true, title, price: price + " EUR",
    availability: "in stock", quantity: 1, ...fields };
}

const squier = product("42636242", "Squier Sonic Stratocaster Sienna Sunburst", 199,
  { id: "037-3150-547", gtin: "197955143101", brand: "Squier", productType: "Guitares électriques" });
const mikro = product("102", "Ibanez Mikro Guitare électrique Rock Débutant", 239,
  { brand: "Ibanez", description: "Petit diapason pour les petites mains." });
const amp = product("103", "Blackstar ID:CORE 10 V4", 128, {
  productType: "Amplis guitare", description: "Canal overdrive. Commandes simples."
});
const traditional = product("104", "Combo ampli guitare à transistors", 129, {
  productType: "Amplis guitare", description: "Une sortie casque."
});
const ibanez200 = product("105", "Ibanez Guitare électrique", 200, { brand: "Ibanez" });
const mustang = product("106", "Fender Mustang Micro Plus", 129, {
  brand: "Fender", productType: "Guitare", description: "Branchez un casque à la sortie stéréo."
});
const portable = product("107", "Enceinte de sonorisation portable", 559, {
  availability: "sur commande, délai à confirmer", quantity: 0, daysToShip: 4,
  description: "Fonctionnement sur batterie. Bluetooth. Entrée combo XLR/jack."
});
const bundled = product("108", "Enceinte amplifiée autonome avec deux micros", 529, {
  description: "Batterie interne. Bluetooth. Deux micros sans fil inclus. Sans entrée micro."
});
const plugOnly = product("109", "Enceinte amplifiée 1000 W", 299, {
  description: "Batterie non incluse. Fonctionne sur secteur uniquement. Bluetooth. Entrée micro."
});
const accessories = [
  product("110", "Plaque de protection pour guitare électrique", 14, { productType: "Guitares électriques" }),
  product("111", "Cordes pour guitare électrique", 8),
  product("112", "Capodastre guitare électrique", 12),
  product("113", "Guitare classique 4/4", 149),
  product("114", "Ibanez Guitare électrique en rupture", 159,
    { brand: "Ibanez", canOrder: false, availability: "out of stock", quantity: 0 })
];
const catalog = [...accessories, squier, mikro, amp, traditional, ibanez200, mustang, portable, bundled, plugOnly];
const services = {
  readLive: async id => catalog.find(item => item.oxId === id),
  productLink: createProductLinkVerifier(async url => {
    const id = new URL(url).searchParams.get("ItmID");
    return Response.json({ "@type": "Product", sku: id || squier.id });
  }, { strict: true })
};
const titles = result => result.products.map(item => item.title);
const plan = (parsed, message, history = []) => shoppingPlan(parsed, message, history, shoppingInput(history, message).autonomous);

test("V8 1 — le panier débutant rock privilégie le format standard, propose deux liens et recalcule le total", async () => {
  const shopping = plan(intent([slot("electric", { preferred: ["rock", "débutant"] }), slot("amp")], {
    question: "cable"
  }), guitarAndAmp);
  const reply = await advise(catalog, shopping, { ...services, choose: async options => {
    assert.ok(options.every(option => option.items.every(item => !item.title.includes("Mikro"))));
    return { option: 999, benefits: [-1, 999] };
  } });
  assert.deepEqual(titles(reply), [squier.title, amp.title]);
  assert.match(reply.reply, /327,00\s*€ TTC/);
  assert.match(reply.reply, /débuter le rock/);
  assert.match(reply.reply, /saturation/);
  assert.equal(reply.products.filter(item => item.url).length, 2);
});

test("V8 2 — une recherche autonome après le panier repart avec un seul achat et un seuil strict", async () => {
  assert.deepEqual(shoppingInput([guitarAndAmp], brands).messages, [{ role: "user", content: brands }]);
  const shopping = plan(intent([slot("electric", { brands: ["Squier", "Ibanez"] })], {
    maxCents: 24500, continuity: "followup"
  }), brands, [guitarAndAmp]);
  assert.equal(shopping.continuity, "new");
  assert.equal(shopping.maxCents, 20000);
  assert.equal(shopping.exclusive, true);
  assert.equal(shopping.inStock, true);
  const reply = await advise(catalog, shopping, services);
  assert.deepEqual(titles(reply), [squier.title]);
  assert.match(reply.products[0].url, /-c2x42636242$/);
  assert.doesNotMatch(reply.reply, /au-dessus/);
});

test("V8 3 — 150 € ne donne aucun accessoire et l’alternative vérifiée coûte 49 € de plus", async () => {
  const shopping = plan(intent([slot("electric")]), lowBudget);
  const reply = await advise(catalog, shopping, services);
  assert.deepEqual(titles(reply), [squier.title]);
  assert.match(reply.reply, /199,00\s*€ TTC, soit 49,00\s*€ au-dessus/);
  const strict = plan(intent([slot("electric")]), lowBudget + " Aucun dépassement.");
  const rejected = await advise(catalog, strict, services);
  assert.deepEqual(rejected.products, []);
  assert.doesNotMatch(rejected.reply, /199|Squier|accessoire/i);
});

test("V8 4 — la Stratocaster possédée n’est pas recommandée et un combo est exclu du jeu au casque", async () => {
  const shopping = plan(intent([slot("headphoneRig")]), headphones);
  const reply = await advise(catalog, shopping, services);
  assert.deepEqual(titles(reply), [mustang.title]);
  assert.match(reply.reply, /sortie casque/);
  assert.match(reply.reply, /129,00\s*€/);
});

test("V8 5 — une enceinte autonome, puis un suivi extérieur avec micro déjà possédé", async () => {
  const interpreted = intent([slot("pa")], { question: "venue" });
  const first = await advise([portable, plugOnly], plan(interpreted, singer), services);
  assert.deepEqual(titles(first), [portable.title]);
  assert.match(first.reply, /intérieur ou en extérieur/);
  assert.match(first.reply, /sur commande, expédition indiquée sous 4 jours/);
  assert.deepEqual(shoppingInput([singer], outdoors).messages.map(turn => turn.content), [singer, outdoors]);
  const follow = plan(intent([slot("pa", { required: ["battery", "bluetooth", "microphone"] })],
    { continuity: "followup", maxCents: 60000, question: "venue" }), outdoors, [singer]);
  assert.equal(follow.maxCents, 60000);
  assert.equal(follow.ownsMicrophone, true);
  const reply = await advise(catalog, follow, { ...services, choose: async () => ({ option: 0, benefits: [2] }) });
  assert.deepEqual(titles(reply), [portable.title]);
  assert.match(reply.reply, /En extérieur/);
  assert.match(reply.reply, /connecteur/);
  assert.match(reply.reply, /amplifier le chant/);
  assert.doesNotMatch(reply.reply, /suffit pour|intérieur ou en extérieur/);
});

test("V8 — le prix, le stock, les preuves techniques et le lien estimés ne valent pas validation", async () => {
  const shopping = plan(intent([slot("electric")]), lowBudget);
  const result = await advise([squier, mikro], shopping, {
    ...services,
    readLive: async id => id === squier.oxId ? { ...squier, price: "220 EUR" } : { ...mikro, visible: false }
  });
  assert.deepEqual(titles(result), [squier.title]);
  assert.match(result.reply, /220,00\s*€ TTC, soit 70,00\s*€ au-dessus/);
  const badLink = await advise([squier], shopping, {
    ...services, productLink: createProductLinkVerifier(async () => new Response("Accès refusé", { status: 403 }), { strict: true })
  });
  assert.deepEqual(titles(badLink), [squier.title]);
  assert.equal(badLink.products[0].url, null);
  assert.doesNotMatch(badLink.reply, /https?:|\bnull\b/);
  const unreliable = await advise([portable], plan(intent([slot("pa")]), singer), {
    ...services, readLive: async () => ({ ...portable, description: "Bluetooth. Entrée micro. Batterie non incluse." })
  });
  assert.deepEqual(unreliable.products, []);
});

test("V8 — une hausse du prix du panier est recalculée en TTC avant et après refus de dépassement", async () => {
  const changed = { ...services, readLive: async id => id === amp.oxId ? { ...amp, price: "205 EUR" } : services.readLive(id) };
  const parsed = intent([slot("electric"), slot("amp")]);
  const result = await advise([amp, squier, mikro], plan(parsed, guitarAndAmp), changed);
  assert.match(result.reply, /404,00\s*€ TTC, soit 4,00\s*€ au-dessus/);
  assert.match(result.reply, /Total du matériel, hors livraison · 404,00\s*€ TTC/);
  const strict = await advise([amp, squier, mikro], plan(parsed, guitarAndAmp + " Pas plus de 400 €."), changed);
  assert.deepEqual(strict.products, []);
});

test("V8 — Oxatis expose les catégories, le délai publié et le statut commercial sans promesse arbitraire", () => {
  const fields = { OxID: "123", Visible: "true", ShowIfOutOfStock: "true",
    QuantityInStock: { Value: "0" }, SaleIfOutOfStock: "true", SaleIfOutOfStockScenario: "2",
    DaysToShip: "4", ShowDaysToship: "true", Category1: { Name: "Sono" }, Category2: { Name: "Enceintes" },
    LongDescription: "Entrée micro.", Description: "Bluetooth." };
  const converted = normalizeProduct(fields);
  assert.deepEqual(converted.categories, ["Sono", "Enceintes"]);
  assert.equal(converted.canOrder, true);
  assert.equal(converted.availability, "sur commande, délai à confirmer");
  assert.equal(converted.daysToShip, 4);
  assert.match(converted.description, /Bluetooth\.\nEntrée micro\./);
  const discontinued = normalizeProduct({ ...fields, SaleIfOutOfStockScenario: "3", ShowDaysToship: "false" });
  assert.equal(discontinued.canOrder, false);
  assert.equal(discontinued.availability, "out of stock");
  assert.equal(discontinued.daysToShip, null);
});

test("V8 — si le conseil éditorial échoue, un produit vérifié et son prix restent disponibles", async () => {
  const reply = await advise([squier], plan(intent([slot("electric")]), brands),
    { ...services, choose: async () => { throw new Error("timeout"); } });
  assert.deepEqual(titles(reply), [squier.title]);
});

test("V8 — un SKU dans des produits associés ne valide pas le lien principal", async () => {
  const verifier = createProductLinkVerifier(async () => new Response(`
    <script type="application/ld+json">
      {"@graph":[{"@type":"Product","sku":"autre"},{"@type":"Product","sku":"037-3150-547"}]}
    </script>`), { strict: true });
  assert.equal(await verifier(squier), null);
  const redirect = createProductLinkVerifier(async url => new URL(url).pathname.includes("squier")
    ? Response.redirect("https://www.xlmusic.fr/fiche-differente-c2x555")
    : Response.json({ "@type": "Product", sku: squier.id }), { strict: true });
  assert.equal(await redirect(squier), "https://www.xlmusic.fr/PBSCProduct.asp?ItmID=42636242");
});

test("V8 — un modèle précis indisponible est signalé sans offre de vente", async () => {
  const model = accessories.at(-1);
  const shopping = plan(intent([slot("electric", { names: [model.id] })]), "Avez-vous le modèle 114 ?");
  const reply = await advise(catalog, shopping, services);
  assert.deepEqual(reply.products, []);
  assert.match(reply.reply, /est actuellement indisponible/);
});

test("V8 — le suivi conserve un budget omis et accepte son abandon explicite", () => {
  const parsed = intent([slot("pa")], { continuity: "followup", maxCents: null });
  const history = [{ message: singer, question: "Intérieur ou extérieur ?", products: [portable.title] }];
  assert.equal(plan(parsed, outdoors, history).maxCents, 60000);
  assert.equal(plan({ ...parsed, maxCents: 60000 }, "Finalement, sans limite de budget.", history).maxCents, null);
});

test("V8 — une guitare 7 cordes reste un instrument et un appareil casque peut être classé en accessoires", async () => {
  const seven = product("115", "Guitare électrique 7 cordes", 135, { productType: "Guitares électriques" });
  const instrument = await advise([seven], plan(intent([slot("electric")]), lowBudget), {
    ...services, readLive: async () => seven
  });
  assert.deepEqual(titles(instrument), [seven.title]);
  const personal = { ...mustang, productType: "Accessoires guitare" };
  const solution = await advise([personal], plan(intent([slot("headphoneRig")]), headphones), {
    ...services, readLive: async () => personal
  });
  assert.deepEqual(titles(solution), [personal.title]);
});

test("V8 — le volume des appels Oxatis reste plafonné sur un catalogue de 2 718 références", async () => {
  const large = Array.from({ length: 2718 }, (_, index) =>
    product(String(20000 + index), "Guitare électrique " + index, 199 + index));
  let checks = 0;
  const result = await advise(large, plan(intent([slot("electric")]), lowBudget), {
    ...services, readLive: async id => {
      checks++;
      return large[Number(id) - 20000];
    }
  });
  assert.equal(checks, 12);
  assert.equal(result.products[0].title, large[0].title);
});

test("le Mustang est trouvé par SKU ou par nom, même sans lien", async () => {
  const candidate = { ...mustang, id: "231-1600-000", title: "Fender, Mustang® Micro Plus" };
  const access = { readLive: async () => candidate, productLink: async () => { throw new Error("réseau"); } };
  for (const message of [candidate.id, "Avez-vous le Fender Mustang Micro Plus en stock et à quel prix ?"]) {
    const result = await adviseExactProduct([candidate], message, access);
    assert.deepEqual(titles(result), [candidate.title]);
    assert.equal(result.products[0].url, null);
    assert.match(result.reply, /129,00.*en stock/);
    assert.match(result.reply, /231-1600-000/);
  }
  assert.equal(await adviseExactProduct([candidate], "Je cherche un ampli à 400 €", access), null);
  const hidden = await adviseExactProduct([candidate], candidate.id, {
    ...access, readLive: async () => ({ ...candidate, visible: false })
  });
  assert.deepEqual(hidden.products, []);
});

test("un panier reste disponible lorsqu’un lien ne peut être confirmé", async () => {
  const result = await advise([squier, amp], plan(intent([slot("electric"), slot("amp")]), guitarAndAmp), {
    ...services, productLink: async () => null
  });
  assert.deepEqual(titles(result), [squier.title, amp.title]);
  assert.match(result.reply, /327,00/);
});

test("V8 — un panier sans précision exclut le modèle gaucher, même moins cher", async () => {
  const left = product("901", "Guitare électrique HSS Gaucher", 150);
  const catalog = [left, squier, amp];
  const access = { productLink: async () => null, readLive: async id => catalog.find(item => item.oxId === id) };
  const base = intent([slot("electric"), slot("amp")]);
  assert.deepEqual(titles(await advise(catalog, plan(base, guitarAndAmp), access)), [squier.title, amp.title]);
  const followup = { ...base, continuity: "followup" };
  assert.deepEqual(titles(await advise(catalog,
    plan(followup, "Précision : je suis gaucher.", [guitarAndAmp]), access)), [left.title, amp.title]);
  assert.deepEqual(titles(await advise(catalog,
    plan(followup, "Je ne suis pas gaucher.", [guitarAndAmp]), access)), [squier.title, amp.title]);
  const changed = { ...access, readLive: async id =>
    id === squier.oxId ? { ...squier, title: squier.title + " Gaucher" } : access.readLive(id) };
  assert.deepEqual(titles(await advise(catalog, plan(base, guitarAndAmp), changed)), []);
});

test("V8 — une adresse bloquée laisse place à la fiche Oxatis si son identité est confirmée", async () => {
  const requests = [];
  const verifier = createProductLinkVerifier(async url => {
    requests.push(url);
    return url.includes("PBSCProduct")
      ? Response.json({ "@type": "Product", sku: squier.id })
      : new Response("Accès refusé", {status: 403});
  }, {strict:true});
  assert.equal(await verifier(squier), "https://www.xlmusic.fr/PBSCProduct.asp?ItmID=42636242");
  assert.equal(requests.length, 2);
});

test("le panier garde une Squier rangée sous Guitares–Amplis–Effets–Accessoires", async () => {
  const guitar = { ...squier, productType: "Guitares - Amplis - Effets - Accessoires > Guitares Electriques" };
  const expensive = Array.from({length: 20}, (_, i) => product(String(500 + i), "Guitare électrique Rock", 390 + i));
  const catalog = [guitar, amp, ...expensive];
  const shopping = plan(intent([slot("other")]), guitarAndAmp);
  const response = await advise(catalog, shopping, {
    readLive: async id => catalog.find(item => item.oxId === id), productLink: async () => null
  });
  assert.deepEqual(titles(response), [guitar.title, amp.title]);
  assert.match(response.reply, /327,00/);
});

test("le flux public confirme le lien du Mustang lorsque la boutique bloque la lecture", async () => {
  const product = { oxId: "41209146", id: "231-1600-000", gtin: "717669896706", visible: true, published: true };
  const blocked = createProductLinkVerifier(async () => new Response("Accès refusé", {status:403}),
    {strict:true,indexedFallback:true});
  assert.equal(await blocked(product), "https://www.xlmusic.fr/PBSCProduct.asp?ItmID=41209146");
  assert.equal(await blocked({...product,id:"autre"}), null);
  const missing = createProductLinkVerifier(async () => new Response("Absent", {status:404}),
    {strict:true,indexedFallback:true});
  assert.equal(await missing(product), null);
});
