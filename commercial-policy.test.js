import assert from "node:assert/strict";
import test from "node:test";
import { advise } from "./advisor.js";
import { commercialPolicy, defaultCommercialPolicy } from "./commercial-policy.js";

const slot = { family: "other", names: ["pédale"], brands: [], required: [], evidence: [], excluded: [], preferred: [] };
const product = (id, brand, price, extras = {}) => ({
  id, oxId: id, title: `${brand} Pédale d'effets`, brand, price: `${price} EUR`,
  visible: true, canOrder: true, availability: "in stock", ...extras
});

test("le seuil TTC et la famille utilisent uniquement une provenance attestée et à jour", () => {
  const now = Date.parse("2026-11-28T00:00:00Z");
  const policy = commercialPolicy({ products: {
    SHOP: { stockSource: "store", stockValidUntil: "2026-12-01T00:00:00Z" },
    SHIP: { stockSource: "supplier", stockValidUntil: "2026-12-01T00:00:00Z" },
    OLD: { stockSource: "store", stockValidUntil: "2026-11-27T00:00:00Z" }
  } });
  const rank = (id, price, family = "other", title = "Article") =>
    policy(product(id, "Prodipe", price, { title }), { family }, now)[0];
  assert.equal(rank("SHOP", 59.99), 2);
  assert.equal(rank("SHOP", 60), 1);
  assert.equal(rank("SHIP", 100, "amp"), 0);
  assert.equal(rank("SHOP", 100, "other", "Pédale d'effets"), 2);
  assert.equal(rank("UNKNOWN", 39), 1);
  assert.equal(rank("OLD", 39), 1);
});

test("les rangs commerciaux départagent les options vérifiées sans dépasser le budget", async () => {
  const supplier = product("SUP", "Prodipe", 35);
  const local = product("LOCAL", "Ibanez", 49);
  const pushed = product("PUSH", "PRS", 90);
  const other = product("OTHER", "Autre", 45, { discountRulePresent: true });
  const promoted = product("PROMO", "Mac Mah", 48, { referencePrice: "65 EUR" });
  const products = [supplier, local, pushed, other, promoted];
  const services = { readLive: async id => products.find(item => item.id === id) };
  const policy = commercialPolicy({ products: {
    LOCAL: { stockSource: "store", stockValidUntil: "2099-01-01T00:00:00Z" },
    SUP: { stockSource: "supplier", stockValidUntil: "2099-01-01T00:00:00Z" },
    PUSH: { push: true }
  } });
  const plan = { slots: [slot], maxCents: 5000, inStock: true, allowOverBudget: false };
  const response = await advise(products, plan, { ...services, commercialPolicy: policy,
    choose: async options => { assert.equal(options.length, 1); return { option: 0 }; } });
  assert.equal(response.products[0].sku, "LOCAL");
  assert.doesNotMatch(JSON.stringify(response), /stockSource|stockValidUntil|campaign|commercial/);
  assert.equal((await advise([supplier], plan, { ...services, commercialPolicy: policy })).products[0].sku, "SUP");
  assert.equal((await advise([other, promoted], plan, services)).products[0].sku, "PROMO");
  assert.ok(defaultCommercialPolicy(supplier, slot, Date.now())[3] > defaultCommercialPolicy(local, slot, Date.now())[3]);
});

test("un conseil d’effets isole les pédales, écarte les accessoires et garde le budget", async () => {
  const pedal = product("OD", "Ibanez", 79, { title: "Ibanez Overdrive Tube Screamer" });
  const supply = product("POWER", "Prodipe", 15, { title: "Alimentation pour pédale overdrive" });
  const multi = product("MULTI", "Prodipe", 150, { title: "Processeur multi-effets avec overdrive" });
  const products = [supply, multi, pedal];
  const services = { readLive: async id => products.find(item => item.id === id) };
  const plan = { slots: [{ ...slot, names: ["overdrive"], effectKind: "pedal" }], maxCents: 10000, inStock: true };
  assert.equal((await advise(products, plan, services)).products[0].sku, "OD");
  const multiPlan = { ...plan, maxCents: 18000, slots: [{ ...slot, effectKind: "multi" }] };
  assert.equal((await advise(products, multiPlan, services)).products[0].sku, "MULTI");
});

test("le libellé Stock Internet est reconnu sans assimiler en stock à stock magasin", async () => {
  const { normalizeProduct } = await import("./oxatis.js");
  const make = Append => normalizeProduct({ Visible:"true", QuantityInStock:{ Value:"2", Append } });
  assert.equal(make("Stock Internet").stockSource, "supplier");
  assert.equal(make("Stock magasin").stockSource, "store");
  assert.equal(make("").stockSource, null);
  assert.equal(make("").availability, "in stock");
  const dropship = normalizeProduct({ Visible:"true", ShowIfOutOfStock:"true", QuantityInStock:{Value:"0"},
    SaleIfOutOfStock:"true", SaleIfOutOfStockScenario:"2" });
  assert.equal(dropship.stockSource, "supplier");
  assert.equal(dropship.canOrder, true);
  const unavailable = normalizeProduct({ Visible:"true", QuantityInStock:{Value:"0"},
    SaleIfOutOfStock:"false", SaleIfOutOfStockScenario:"2" });
  assert.equal(unavailable.stockSource, null);
});

test("une expression familière interprétée par l’IA conserve la distinction nylon/acier", async () => {
  const { handleConversation, restoreConversation } = await import("./conversation.js");
  const state = restoreConversation(null, [], []);
  const response = await handleConversation("Faut que je change les cordes de ma gratte sèche", state, [], {}, "acoustic");
  assert.match(response.reply, /classique à cordes nylon ou une folk à cordes acier/);
  assert.deepEqual(response.products, []);
});

test("la demande d’un multi-effets conserve les deux effets sans racheter l’ampli possédé", async () => {
  const { shoppingPlan } = await import("./shopping-intent.js");
  const message = "J’ai déjà un ampli. Je voudrais un multi-effets guitare avec overdrive et delay, maximum 200 €, en stock.";
  const plan = shoppingPlan({ slots: [{ ...slot, family:"amp" }, { ...slot, family:"other", effectKind:"multi",
    evidence:["avec overdrive et delay"], required:["effects","gain"] }],
    maxCents:20000, question:"none", inStock:true }, message, [], true);
  assert.equal(plan.slots.length, 1);
  assert.deepEqual(plan.slots[0].evidence, ["overdrive", "delay"]);
  const zoom = product("ZOOM-G1-FOUR", "Zoom", 99, { title:"Zoom, Multi-effets G1 Four" });
  const services = { readLive:async()=>zoom, productLink:async()=> "https://www.xlmusic.fr/PBSCProduct.asp?ItmID=41470891" };
  assert.equal((await advise([zoom], plan, services)).products[0].sku, zoom.id);
  assert.deepEqual((await advise([zoom], plan, { ...services, productLink: async()=>null })).products, []);
});

test("une recherche d’instrument exclut les accessoires même rangés dans la même catégorie", async () => {
  const category = "Guitares acoustiques";
  const cover = product("COVER", "Prodipe", 59, { title:"Prodipe Housse guitare acoustique", productType:category });
  const caseBag = product("CASE", "Prodipe", 69, { title:"Prodipe Gig bag", productType:category });
  const instrument = product("GUITAR", "Autre", 109, { title:"Guitare acoustique 6 cordes avec housse", productType:category });
  const catalog = [cover, caseBag, instrument];
  const services = {readLive:async id => catalog.find(item => item.id === id)};
  const guitarSlot = { ...slot, itemRole:"instrument", names:["guitare acoustique"] };
  const plan = {slots:[guitarSlot], maxCents:12000, inStock:true, allowOverBudget:false};
  assert.equal((await advise(catalog, plan, services)).products[0].sku, instrument.id);
  assert.deepEqual((await advise(catalog, {...plan,maxCents:6000}, services)).products, []);
  const coverPlan = {...plan, slots:[{ ...slot, itemRole:"accessory", names:["housse"] }]};
  assert.equal((await advise(catalog, coverPlan, services)).products[0].sku, cover.id);
});

test("le budget de référence organise trois prix et le plafond ferme écarte la montée en gamme", async () => {
  const { shoppingPlan } = await import("./shopping-intent.js");
  const candidates = [
    product("ECO", "Autre", 399, {title:"Guitare électrique Éco"}),
    product("MID", "Prodipe", 500, {title:"Guitare électrique Standard"}),
    product("UP", "Autre", 650, {title:"Guitare électrique Plus", description:"Micro double humbucker."}),
    product("UP-NO", "Ibanez", 649, {title:"Guitare électrique Sans avantage"})
  ];
  const services = {readLive:async id=>candidates.find(item=>item.id===id), productLink:async item=>`https://www.xlmusic.fr/${item.id}`};
  const intent = {slots:[{...slot, names:[], family:"electric"}], maxCents:70000,
    inStock:true, question:"none", compareProducts:true, continuity:"new"};
  const flexible = shoppingPlan(intent, "Je cherche une guitare électrique, budget 500 €.", [], true);
  const options = await advise(candidates, flexible, services);
  assert.deepEqual(options.products.map(item=>item.sku), ["ECO","MID","UP"]);
  assert.match(options.reply,/150,00\s*€ au-dessus/);
  assert.match(options.reply,/micro double/i);
  const firm = shoppingPlan(intent, "Je cherche une guitare électrique, 500 € maximum.", [], true);
  assert.equal(firm.maxCents, 50000);
  assert.deepEqual((await advise(candidates, firm, services)).products.map(item=>item.sku), ["ECO","MID"]);
});
