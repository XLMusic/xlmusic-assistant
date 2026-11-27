import assert from "node:assert/strict";
import test from "node:test";
import { recommend, applyExplicitConstraints } from "../recommendations.js";
import { createProductLinkVerifier } from "../product-links.js";

function product(oxId, title, price, fields = {}) {
  return { oxId, id: oxId, visible: true, title, price, availability: "in stock", ...fields };
}
const squier = product("101", "Squier Sonic Stratocaster Sienna Sunburst", "199,00 EUR", {
  id: "037-3150-547", gtin: "197955143101", brand: "Squier", productType: "Guitares électriques"
});
const mustang = product("102", "Fender Mustang Micro Plus", "129.00 EUR", {
  productType: "Guitare", description: "Ampli casque pour guitare électrique. Sortie casque."
});
const blackstar = product("103", "Blackstar HT-1R", "398 EUR", {
  productType: "Amplis guitare", description: "Combo à lampes avec sortie casque émulée."
});
const elokance = product("104", "Elokance e-GO 8X – Enceinte amplifiée autonome", "559 EUR", {
  availability: "sur commande, délai à confirmer",
  description: "Sur batterie rechargeable, Bluetooth et deux microphones sans fil inclus."
});
const macMah = product("105", "Mac Mah SC-1000 Enceinte amplifiée", "599 EUR", {
  description: "Bluetooth et entrée microphone."
});
const classical = product("106", "Prodipe Primera 7/8 Guitare classique", "149 EUR");
const jackson = product("107", "Jackson JS32 Guitare électrique Rock", "399 EUR", {
  description: "Vibrato Floyd Rose."
});
const practiceAmp = product("108", "Ampli guitare Rock Débutant 15 W", "145 EUR");
const catalog = [jackson, blackstar, classical, macMah, ...Array.from({ length: 20 }, (_, index) =>
  product(String(index + 200), "Housse pour guitare électrique rock", "90 EUR")), elokance, mustang, practiceAmp, squier];

function slot(family, opts = {}) {
  return { family, names: [], brands: [], required: [], evidence: [], excluded: [], preferred: [], ...opts };
}
function plan(slots, opts = {}) {
  return { slots, maxCents: null, exclusive: false, inStock: false, question: "none", ...opts };
}
const readLive = async id => catalog.find(p => p.oxId === id);
const titles = result => result.products.map(p => p.title);

test("V6 cas 1 — le panier guitare et ampli reste sous 400 € après relecture", async () => {
  const request = "Je débute la guitare électrique, j'aime le rock et j'ai un budget de 400 € pour une guitare et un ampli. Que me conseillez-vous ?";
  const intent = applyExplicitConstraints(plan([
    slot("electric", { preferred: ["rock", "débutant"] }), slot("amp", { preferred: ["rock", "débutant"] })
  ], { question: "cable" }), request);
  const reply = await recommend(catalog, intent, { readLive });
  assert.deepEqual(titles(reply), [squier.title, practiceAmp.title]);
  assert.match(reply.reply, /344,00/);
  assert.doesNotMatch(reply.reply, /Blackstar|Jackson|797/);
  const changed = await recommend(catalog, intent, {
    readLive: async id => id === practiceAmp.oxId ? { ...practiceAmp, price: "202 EUR" } : readLive(id)
  });
  assert.deepEqual(changed.products, []);
  assert.doesNotMatch(changed.reply, /401/);
});

test("V6 cas 2 — marques alternatives, stock, plafond strict et fiche cliquable", async () => {
  const request = "Quelles guitares électriques de marque Ibanez ou Squier avez-vous en stock à moins de 200 € ?";
  const intent = applyExplicitConstraints(plan([slot("electric", { brands: ["Ibanez", "Squier"] })], { inStock: true }), request);
  const exact = product("110", "Ibanez guitare électrique", "200 EUR", { brand: "Ibanez" });
  const order = product("111", "Squier guitare électrique", "159 EUR", {
    brand: "Squier", availability: "sur commande, délai à confirmer"
  });
  const productLink = createProductLinkVerifier(async () => new Response(
    '<script type="application/ld+json">{"@type":"Product","sku":"037-3150-547"}</script>'
  ));
  const reply = await recommend([exact, order, ...catalog], intent, { readLive, productLink });
  assert.deepEqual(titles(reply), [squier.title]);
  assert.match(reply.products[0].url, /c2x42636242$/);
  assert.match(reply.reply, /https:\/\/www\.xlmusic\.fr/);
});

test("V6 cas 3 — une classique à 149 € reste hors de la sélection électrique", async () => {
  const intent = applyExplicitConstraints(plan([slot("electric")], { inStock: true }),
    "Quelles guitares électriques avez-vous en stock à moins de 150 €, toutes marques confondues ?");
  const reply = await recommend(catalog, intent, { readLive });
  assert.deepEqual(reply.products, []);
  assert.doesNotMatch(reply.reply, /Prodipe|catalogue/);
});

test("V6 cas 4 — une sortie casque sur un ampli traditionnel ne suffit pas", async () => {
  const request = "Je possède une guitare électrique Fender Stratocaster et je souhaite jouer au casque sans utiliser mon ampli. Quelles solutions pouvez-vous me proposer parmi vos produits en stock ?";
  const intent = applyExplicitConstraints(plan([slot("headphoneRig", { required: ["headphone"] })],
    { inStock: true, question: "headphones" }), request);
  const reply = await recommend(catalog, intent, { readLive });
  assert.deepEqual(titles(reply), [mustang.title]);
  assert.match(reply.reply, /casque filaire/);
  assert.doesNotMatch(reply.reply, /Blackstar|URL/);
});

test("V6 cas 5 — batterie, Bluetooth et micro confirmés, jauge à préciser", async () => {
  const request = "Je suis chanteur et je recherche une enceinte autonome sur batterie avec Bluetooth, pour chanter lors de petites prestations devant une cinquantaine de personnes. Mon budget est de 600 €. Que me conseillez-vous ?";
  const intent = applyExplicitConstraints(plan([slot("pa", { required: ["battery", "bluetooth", "microphone"] })],
    { question: "venue" }), request);
  const reply = await recommend(catalog, intent, { readLive });
  assert.deepEqual(titles(reply), [elokance.title]);
  assert.match(reply.reply, /sur commande/);
  assert.match(reply.reply, /intérieur ou en extérieur/);
  assert.doesNotMatch(reply.reply, /SC-1000|URL|convient.*50/);
  const withoutBattery = await recommend(catalog, intent, {
    readLive: async () => ({ ...elokance, description: "Bluetooth, entrée micro, batterie non incluse. Fonctionne sur secteur uniquement." })
  });
  assert.deepEqual(withoutBattery.products, []);
});

test("le budget ne confond pas prix, puissance et références", () => {
  const initial = plan([slot("pa")]);
  assert.equal(applyExplicitConstraints(initial, "Sonoriser 50 personnes, modèle 1000.").maxCents, null);
  assert.equal(applyExplicitConstraints(initial, "Budget de 1 299,95 euros pour 50 personnes.").maxCents, 129995);
  assert.equal(applyExplicitConstraints(initial, "Un ampli à moins de 100,50 €").exclusive, true);
});

test("une fiche inconnue, une redirection externe et une erreur réseau ne produisent aucun lien", async () => {
  const p = product("203", "Une enceinte", "200 EUR");
  const wrong = createProductLinkVerifier(async () => new Response('{"@type":"Product","sku":"2034"}'));
  assert.equal(await wrong(p), null);
  const seen = [];
  const external = createProductLinkVerifier(async url => {
    seen.push(url);
    return Response.redirect("https://example.com/product");
  });
  assert.equal(await external(p), null);
  assert.equal(seen.length, 1);
  const unavailable = createProductLinkVerifier(async () => { throw new Error("Timeout"); });
  assert.equal(await unavailable(p), null);
});

test("un candidat devenu indisponible laisse place à une autre fiche compatible", async () => {
  const keyboard = product("301", "Clavier arrangeur", "300 EUR");
  const replacement = product("302", "Clavier arrangeur", "350 EUR");
  const intent = plan([slot("other", { names: ["clavier arrangeur"] })], { inStock: true });
  const reply = await recommend([keyboard, replacement], intent, {
    readLive: async id => id === keyboard.oxId ? { ...keyboard, availability: "out of stock" } : replacement
  });
  assert.equal(reply.products[0].price, "350,00\u00a0€");
});

test("une lecture incomplète du besoin ne lève pas les contraintes explicites", async () => {
  const pa = applyExplicitConstraints(plan([slot("pa")]),
    "Je suis chanteur et je recherche une enceinte sur batterie avec Bluetooth pour chanter. Budget de 600 €.");
  assert.deepEqual(pa.slots[0].required, ["battery", "bluetooth", "microphone"]);
  const wrongFamily = applyExplicitConstraints(plan([slot("amp")]),
    "Je veux jouer au casque sans utiliser mon ampli.");
  assert.equal(wrongFamily.question, "clarify");
  assert.deepEqual((await recommend(catalog, wrongFamily)).products, []);
});
