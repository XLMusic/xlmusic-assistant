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
