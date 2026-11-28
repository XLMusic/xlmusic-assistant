import assert from "node:assert/strict";
import test from "node:test";
import { addToConversation, handleConversation, recordConversation, restoreConversation } from "../conversation.js";

const product=(oxId,id,title,price,description,productType="")=>({oxId,id,title,price:price+" EUR",description,productType,
  availability:"in stock",visible:true,canOrder:true});
const mustang=product("1","231-1600-000","Fender Mustang Micro Plus",129,"Connecte un casque.");
const headphones=product("2","HP","Casque studio filaire",49,"Mini-jack stéréo 3,5 mm.");
const bluetooth=product("3","BT","Casque sans fil",29,"Bluetooth seul.");
const aeris=product("4","MACAERIS110","Mac Mah Aeris 110",329,"1 Microphone sans fil inclus. Entrée Mic/Ligne : 2x XLR combo.");
const mic=product("5","MIC","Système micro sans fil UHF",199,"Micro main et récepteur. Sortie audio XLR.");
const micTooExpensive=product("6","EXP","Système micro sans fil UHF Pro",279,"Micro main et récepteur. Sortie XLR.");
const cable=product("7","XLR","Câble microphone XLR XLR",12,"XLR mâle vers XLR femelle.");
const nylon=product("8","NY","Jeu de cordes guitare classique",11,"Cordes nylon.");
const steel=product("9","ST","Jeu de cordes guitare folk",10,"Cordes phosphore bronze.");
const caseBag=product("10","HG","Housse pour appareil",25,"Compatible avec le Fender Mustang Micro Plus.");
const catalog=[mustang,headphones,bluetooth,aeris,mic,micTooExpensive,cable,nylon,steel,caseBag];
const access={readLive:async id=>catalog.find(p=>p.oxId===id),productLink:async p=>"https://www.xlmusic.fr/PBSCProduct.asp?ItmID="+p.oxId};
const state=(items,budget,pending)=>({items,budget,pending,asked:pending?[pending]:[],facts:{},topic:null});

test("« non » répond à la question casque et ajoute seulement un casque filaire compatible et en stock",async()=>{
  const res=await handleConversation("Non, je n’en ai pas.",state([mustang.id],20000,"headphones"),catalog,access);
  assert.deepEqual(res.products.map(p=>p.sku),[mustang.id,headphones.id]);
  assert.match(res.reply,/mini-jack 3,5 mm/);
  assert.match(res.reply,/178,00/);
  assert.match(res.reply,/22,00/);
  assert.equal(res.followUp,null);
  assert.equal(res.conversation.facts.headphones,"no");
  assert.equal(await handleConversation("Nouvelle demande : je cherche un piano",res.conversation,catalog,access),null);
});

test("l'Aeris et le micro sans fil peuvent être complétés par le bon câble dans le budget",async()=>{
  const prompt="Je joue dans une petite salle et je souhaite un micro sans fil.";
  const first=await handleConversation(prompt,state([aeris.id],60000,"venue"),catalog,access);
  assert.deepEqual(first.products.map(p=>p.sku),[aeris.id,mic.id,cable.id]);
  assert.match(first.reply,/déjà livrée avec un micro sans fil/);
  assert.match(first.reply,/540,00/);
  assert.match(first.reply,/Il reste 60,00/);
  assert.equal(first.conversation.facts.venue,"inside");
  assert.doesNotMatch(first.reply,/intérieur ou en extérieur/);
});

test("une réponse courte garde le lieu ou la distance sans représenter le panier",async()=>{
  const inside=await handleConversation("En intérieur",state([aeris.id],60000,"venue"),catalog,access);
  assert.equal(inside.conversation.facts.venue,"inside");
  assert.deepEqual(inside.products,[]);
  const near=await handleConversation("pas loin",{...inside.conversation,pending:"distance"},catalog,access);
  assert.equal(near.conversation.facts.distance,"near");
  assert.doesNotMatch(near.reply,/\?/);
  const yes=await handleConversation("oui",state([mustang.id],null,"headphones"),catalog,access);
  assert.equal(yes.conversation.facts.headphones,"yes");
  assert.deepEqual(yes.products,[]);
});

test("cordes pour guitare sèche : question ciblée, puis jeu nylon, sans répéter la question",async()=>{
  const first=await handleConversation("Quelles cordes pour ma guitare ?",state([],null,null),catalog,access);
  assert.match(first.reply,/électrique.*nylon.*acier/);
  const acoustic=await handleConversation("Une guitare sèche",first.conversation,catalog,access);
  assert.match(acoustic.reply,/classique à cordes nylon ou une folk à cordes acier/);
  const final=await handleConversation("Une classique",acoustic.conversation,catalog,access);
  assert.equal(final.products[0].sku,"NY");
  assert.equal(final.followUp,null);
});

test("un complément explicitement compatible complète une autre famille avec un total vérifié",async()=>{
  const plan={slots:[{family:"other",names:["housse"],brands:[],required:[],evidence:[],excluded:[],preferred:[]}]};
  const res=await addToConversation(plan,"Et une housse pour ce modèle ?",state([mustang.id],16000,null),catalog,access);
  assert.deepEqual(res.products.map(p=>p.sku),[mustang.id,caseBag.id]);
  assert.match(res.reply,/154,00/);
  const strict=await addToConversation(plan,"Et une housse ?",state([mustang.id],15000,null),catalog,access);
  assert.deepEqual(strict.products,[]);
});

test("une question déjà répondue est retirée et une nouvelle recherche réinitialise la mémoire",()=>{
  const memory=restoreConversation({items:[aeris.id],budget:60000,pending:"venue",facts:{venue:"inside"},asked:["venue"]},[],catalog);
  const plan={continuity:"followup",maxCents:60000};
  const answer={reply:"Voici une enceinte.\n\nIntérieur ou extérieur ?",followUp:"Intérieur ou extérieur ?",products:[]};
  assert.equal(recordConversation(answer,plan,memory,"En intérieur").reply,"Voici une enceinte.");
  const next=recordConversation(answer,{...plan,continuity:"new",maxCents:null},memory,"Nouvelle recherche");
  assert.deepEqual(next.conversation.items,[]);
  assert.equal(next.conversation.budget,null);
});

test("les deux fiches Oxatis peuvent écrire le jack sans unité et les câbles DMX sont exclus",async()=>{
  const prodipe={...headphones,description:"Jack stéréo Ø 3,5 + adaptateur Ø 6,3mm"};
  const dmx=product("15","DMX","Câble DMX XLR XLR",5,"XLR mâle / XLR femelle");
  const voice=product("16","UHF","Micro HF Chant W-UHF 100 M",99,"Micro main et récepteur. Sortie audio jack 6,35 mm asymétrique.");
  const jack=product("17","JACK","Câble Jack Mâle Mono - Jack Mâle Mono 3m",9,"Liaison audio jack 6,35 mm.");
  const source=[mustang,prodipe,aeris,dmx,voice,jack];
  const adapters={readLive:async id=>source.find(p=>p.oxId===id),productLink:access.productLink};
  const ph=await handleConversation("Non",state([mustang.id],null,"headphones"),source,adapters);
  assert.equal(ph.products[1].sku,"HP");
  const pa=await handleConversation("Je voudrais ajouter un deuxième micro sans fil",state([aeris.id],60000,"venue"),source,adapters);
  assert.deepEqual(pa.products.map(p=>p.sku),[aeris.id,"UHF","JACK"]);
  assert.match(pa.reply,/437,00/);
});

test("les cordes gardent le budget initial et utilisent la référence du modèle identifié", async () => {
  const guitar = product("18", "C40II", "Yamaha C40 II", 149, "", "Guitares classiques");
  const source = [...catalog, guitar];
  const first = await handleConversation("Quelles cordes pour ma guitare, budget 10 € ?", state([], null, null), source, access);
  assert.equal(first.conversation.budget, 1000);
  const acoustic = await handleConversation("Une guitare sèche", first.conversation, source, access);
  assert.equal(acoustic.conversation.budget, 1000);
  const model = await handleConversation("Yamaha C40 II", acoustic.conversation, source, access);
  assert.equal(model.conversation.facts.strings, "nylon");
  assert.deepEqual(model.products, []);
  const updated = await handleConversation("Pour ma guitare classique, des cordes jusqu’à 12 €", model.conversation, source, access);
  assert.equal(updated.products[0].sku, "NY");
});

test("une demande de guitare 7 cordes passe au moteur de recherche d’instruments", async () => {
  const result = await handleConversation("Je cherche une guitare électrique 7 cordes", state([], null, null), catalog, access);
  assert.equal(result, null);
});

test("la Mobile Pro 12 couvre un deuxième micro avec les deux micros UHF fournis", async () => {
  const speaker = product("19", "MACMOBILEPRO12", "Mac Mah Mobile Pro 12", 269, "Deux entrées micros.");
  const source = [...catalog, speaker];
  const services = {...access, readLive: async id => source.find(item => item.oxId === id)};
  const result = await handleConversation("En intérieur, dans une petite salle, et je voudrais ajouter un deuxième micro sans fil.",
    state([speaker.id], 60000, "venue"), source, services);
  assert.deepEqual(result.products.map(item => item.sku), [speaker.id]);
  assert.match(result.reply, /deux micros main sans fil UHF/);
  assert.match(result.reply, /269,00/);
});

test("Savarez est prioritaire parmi les jeux compatibles, en stock et dans le budget", async () => {
  const savarez = {...product("20", "SAV", "Savarez, Jeu de cordes guitare classique", 13, "Cordes nylon."), brand:"Savarez"};
  const source = [nylon, steel, savarez];
  const services = {...access, readLive: async id => source.find(item => item.oxId === id)};
  const options = [
    ["classique, budget 15 €", "SAV", true],
    ["classique, budget 12 €", "NY", false],
    ["folk, budget 15 €", "ST", false]
  ];
  for (const [criteria, sku, madeInFrance] of options) {
    const response = await handleConversation(`Je cherche des cordes pour ma guitare ${criteria}`,
      state([], null, null), source, services);
    assert.equal(response.products[0].sku, sku);
    assert.equal(response.reply.includes("fabriquées en France"), madeInFrance);
  }
  const unavailable = {...services, readLive: async id => id === savarez.oxId
    ? {...savarez, availability: "out of stock", canOrder:false}
    : services.readLive(id)};
  const fallback = await handleConversation("Je cherche des cordes pour ma guitare classique",
    state([], null, null), source, unavailable);
  assert.equal(fallback.products[0].sku, "NY");
});
