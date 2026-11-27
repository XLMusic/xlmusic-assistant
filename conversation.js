import { advise, availabilityOf } from "./advisor.js";
import { explicitCompatibility, guitarStrings, isHeadphone, isWirelessMic, isXlrCable, productPorts } from "./compatibility.js";
import { applyExplicitConstraints, cents, isStock, money, normalize } from "./recommendations.js";

const empty = () => ({items: [], budget: null, pending: null, asked: [], facts: {}, topic: null});
const safeAmount = value => Number.isSafeInteger(value) && value > 0 && value <= 100000000;
const short = value => typeof value === "string" && value.length <= 100 ? value : "";
const factKeys = ["venue","distance","headphones","microphone","cable","strings"];
const answerValues = new Set(["inside","outside","near","far","yes","no","nylon","steel","electric","acoustic"]);
const newTopic = /\b(?:nouvelle demande|autre question|changeons de sujet|rien a voir|autre sujet)\b/;
const addWords = /\b(?:aussi|en plus|ajout(?:er|ez)|complet(?:er|ez)|avec ca|pour ce |pour cette|separement|en complement|deuxieme)\b/;

export function questionKind(text) {
  const q = normalize(text);
  if (!q) return null;
  if (/\b(?:nylon|folk|guitare classique)\b/.test(q)) return "strings";
  if (/\b(?:distance|a quelle distance)\b/.test(q) && /\b(?:quelle|combien)\b/.test(q)) return "distance";
  if (/\binterieur\b.*\bexterieur\b/.test(q)) return "venue";
  if (/\bcasque\b/.test(q)) return "headphones";
  if (/\bmicro\b/.test(q)) return "microphone";
  if (/\bcable\b/.test(q)) return "cable";
  return null;
}

export function restoreConversation(value, history, products) {
  const state = empty();
  if (value && typeof value === "object") {
    state.items = Array.isArray(value.items) ? [...new Set(value.items.slice(0,3).map(short).filter(Boolean))] : [];
    state.budget = safeAmount(value.budget) ? value.budget : null;
    state.pending = factKeys.includes(value.pending) ? value.pending : null;
    state.asked = Array.isArray(value.asked) ? value.asked.filter(key => factKeys.includes(key)).slice(0,6) : [];
    state.facts = Object.fromEntries(factKeys.filter(key=>answerValues.has(value.facts?.[key])).map(key=>[key,value.facts[key]]));
    state.topic = value.topic === "strings" ? "strings" : null;
  }
  const turns = history.filter(turn=>typeof turn==="object");
  if (!state.items.length) {
    const prior = [...turns].reverse().find(turn=>turn.products?.length);
    state.items = (prior?.products ?? []).flatMap(title=>{
      const found = products.filter(p=>normalize(p.title)===normalize(title));
      return found.length===1 ? [found[0].id] : [];
    });
  }
  if (!state.pending) state.pending = value ? null : questionKind(turns.at(-1)?.question);
  if (state.budget === null && !value) {
    for (const turn of [...history].reverse()) {
      const p = applyExplicitConstraints({slots:[],maxCents:null,inStock:false},typeof turn==="string"?turn:turn.message);
      if (safeAmount(p.maxCents)) { state.budget=p.maxCents; break; }
    }
  }
  return state;
}

function stringKind(text) {
  if (/\b(?:nylon|classiques?|espagnole)\b/.test(text)) return "nylon";
  if (/\b(?:folk|acier|steel)\b/.test(text)) return "steel";
  if (/\belectrique\b/.test(text)) return "electric";
  if (/\b(?:seche|acoustique)\b/.test(text)) return "acoustic";
  return null;
}

const stringQuestion = kind => kind === "acoustic"
  ? "C’est une classique à cordes nylon ou une folk à cordes acier ? Si vous hésitez, donnez-moi la marque et le modèle inscrits sur la guitare."
  : "Vous jouez sur une électrique, une classique à cordes nylon ou une folk à cordes acier ?";

function result(reply,state,{products=[],followUp=null,contextMode="followup"}={}) {
  return {reply,products,followUp,contextMode,conversation:state};
}

function answerFacts(message,state) {
  const text = normalize(message);
  const affirmative = /^(?:oui|oui bien sur|tout a fait|j en ai un|j en ai une|oui j en ai)\b/.test(text);
  const negative = /^(?:non|pas du tout|je n en ai pas|je n en possede pas|pas encore)\b/.test(text);
  if (/\b(?:en interieur|petite salle|dans une salle|a l interieur)\b/.test(text)) state.facts.venue="inside";
  if (/\b(?:en exterieur|dehors|plein air|a l exterieur)\b/.test(text)) state.facts.venue="outside";
  if (/\b(?:pas loin|tout pres|proche|a proximite)\b/.test(text)) state.facts.distance="near";
  if (/\b(?:loin|grande distance)\b/.test(text) && !/\bpas loin\b/.test(text)) state.facts.distance="far";
  if (/\b(?:pas|sans|aucun) (?:de |un )?(?:casque|ecouteurs?)\b/.test(text)) state.facts.headphones="no";
  if (/\b(?:j ai|je possede) (?:deja )?(?:un casque|des ecouteurs)\b/.test(text)) state.facts.headphones="yes";
  if (/\b(?:j ai|je possede) (?:deja )?un micro\b/.test(text)) state.facts.microphone="yes";
  if (["headphones","microphone","cable"].includes(state.pending) && (affirmative||negative)) {
    state.facts[state.pending]=negative?"no":"yes";
  }
  return {text,affirmative,negative};
}

function itemResult(product,url) {
  return {sku:product.id,title:product.title,price:money(cents(product.price)),availability:availabilityOf(product),url};
}

async function liveAnchors(items,catalog,services) {
  if (!services.readLive) return [];
  const output = await Promise.all(items.map(async sku=>{
    const item=catalog.find(p=>p.id===sku);
    if (!item) return null;
    try {
      const fresh=await services.readLive(item.oxId);
      if (!fresh || fresh.id!==item.id || String(fresh.oxId)!==String(item.oxId) || !fresh.visible ||
          fresh.canOrder===false || !isStock(fresh) || cents(fresh.price)===null) return null;
      const url=await services.productLink?.({...fresh,url:fresh.url||item.url}).catch(()=>null);
      return {fresh,view:itemResult(fresh,url??null)};
    } catch {return null;}
  }));
  return output.filter(Boolean);
}

function accessoryPlan(matches,maxCents) {
  return {slots:[{family:"other",matches,names:[],brands:[],required:[],evidence:[],excluded:[],preferred:[]}],
    maxCents,exclusive:false,inStock:true,allowOverBudget:false,question:"none"};
}

function requestedBudget(message,current) {
  if (/\b(?:sans limite de budget|pas de budget fixe)\b/.test(normalize(message))) return null;
  return applyExplicitConstraints({slots:[],maxCents:current,inStock:false},message).maxCents;
}

export async function handleConversation(message,state,catalog,services) {
  const text=normalize(message);
  if (newTopic.test(text)) return null;
  const previous=state.pending;
  const {affirmative,negative}=answerFacts(message,state);
  if (previous && state.facts[previous]) state.pending=null;
  const requestsStrings=/\bcordes?\b/.test(text)&&/\bguitare\b/.test(text);
  const kind=stringKind(text);
  if (requestsStrings || (state.topic==="strings" && (kind || previous==="strings" && text.split(" ").length<=6))) {
    const contextMode=state.topic==="strings"?"followup":"new";
    if (contextMode==="new") {state=empty();state.topic="strings";}
    if (kind) state.facts.strings=kind;
    const material=state.facts.strings;
    if (!material || material==="acoustic") {
      state.pending="strings";
      const question=stringQuestion(material);
      const same=previous==="strings" && !kind;
      const prompt=same?"Regardez les trois cordes les plus fines : si elles sont en nylon, c’est une classique. Si elles sont métalliques, c’est généralement une folk. Une marque et un modèle suffisent aussi.":question;
      return result(prompt,state,{followUp:same?null:question,contextMode});
    }
    const selected=await advise(catalog,accessoryPlan(p=>guitarStrings(p,material),requestedBudget(message,state.budget)),services);
    state.pending=null;
    state.items=selected.products.map(p=>p.sku);
    if (!selected.products.length) return result("Je n’ai pas trouvé de jeu adapté en stock. Si vous me donnez la marque et le modèle de votre guitare, je pourrai affiner.",state,{contextMode});
    const p=selected.products[0];
    const type={nylon:"nylon pour guitare classique",steel:"acier pour guitare folk",electric:"pour guitare électrique"}[material];
    return result([ `Je vous propose ce jeu ${type}.`, `${p.title} · ${p.price} TTC, ${p.availability}.`,p.url].filter(Boolean).join("\n"),state,{products:[p],contextMode});
  }

  const microphone=/\b(?:micros?|microphones?)\b/.test(text)&&/\b(?:sans fil|uhf|wireless)\b/.test(text)&&
    !/\b(?:pas de micro sans fil|ne veux pas de micro|sans micro)\b/.test(text);
  const headphones=previous==="headphones"&&state.facts.headphones==="no" ||
    /\b(?:casques?|ecouteurs?)\b/.test(text)&&
      (/\b(?:pas (?:de |un )?casque|casque compatible|quel casque|un casque (?:en plus|pour aller avec))\b/.test(text)||addWords.test(text));
  if (state.items.length && (microphone||headphones)) {
    const anchors=await liveAnchors(state.items,catalog,services);
    state.budget=requestedBudget(message,state.budget);
    if (anchors.length!==state.items.length) {
      return result("Je ne peux plus confirmer le panier précédent en stock. Souhaitez-vous que je recherche un nouvel ensemble complet ?",state);
    }
    const family=headphones?"headphones":"wireless";
    const anchor=anchors.find(item=>family==="headphones"?productPorts(item.fresh).headphoneOut:productPorts(item.fresh).paXlrIn);
    if (!anchor) return result(family==="headphones"
      ? "Pour trouver le bon casque, il me faut le format de la sortie casque de votre appareil."
      : "Pour vérifier le branchement du récepteur, il me faut le type d’entrée micro ou ligne de votre enceinte.",state);
    const priorCost=anchors.reduce((sum,p)=>sum+cents(p.fresh.price),0);
    const remaining=state.budget===null?null:state.budget-priorCost;
    const included=family==="wireless"&&productPorts(anchor.fresh).wirelessIncluded;
    const second=/\b(?:deuxieme|second|supplementaire|en plus|autre|separe)\b/.test(text);
    const match=family==="headphones"?isHeadphone:isWirelessMic;
    if (anchors.some(item=>match(item.fresh))&&!second) {
      return result(family==="headphones"?"Le casque compatible figure déjà dans votre panier.":"Le système sans fil compatible figure déjà dans votre panier.",state);
    }
    let choice=null;
    if (remaining===null||remaining>0) {
      const offered=await advise(catalog.filter(p=>!state.items.includes(p.id)),
        accessoryPlan(match,remaining),services);
      choice=offered.products[0]??null;
    }
    const anchorViews=anchors.map(a=>a.view);
    const budgetNote=remaining===null?null:`Budget restant après les éléments déjà retenus : ${money(remaining)}.`;
    state.pending=null;
    if (!choice) {
      const answer=included
        ? `Le ${anchor.view.title} est livré avec un micro sans fil et son récepteur intégré. Pour un seul micro, votre panier est complet à ${money(priorCost)} TTC.`
        : "Je n’ai pas confirmé d’accessoire compatible en stock dans le budget restant.";
      return result([answer,budgetNote].filter(Boolean).join("\n\n"),state,{products:anchorViews});
    }
    const additions=[choice];
    let cableNeeded=false;
    if (family==="wireless" && state.facts.cable!=="yes") {
      const receiver=catalog.find(p=>p.id===choice.sku);
      let verifiedReceiver;
      try { if (receiver) verifiedReceiver=await services.readLive(receiver.oxId); } catch {}
      const bundledCable=/\bcable xlr (?:fourni|inclus|livre)\b/.test(normalize(verifiedReceiver?.description));
      cableNeeded=!bundledCable;
      const forCable=remaining===null?null:remaining-cents(choice.price);
      if(cableNeeded && (forCable===null||forCable>0)) {
        const possible=await advise(catalog.filter(p=>!state.items.includes(p.id)&&p.id!==choice.sku),
          accessoryPlan(isXlrCable,forCable),services);
        if(possible.products[0]){additions.push(possible.products[0]);cableNeeded=false;}
      }
    }
    const total=priorCost+additions.reduce((sum,p)=>sum+cents(p.price),0);
    const explanation=family==="headphones"
      ? "Son mini-jack 3,5 mm se branche sur la sortie casque. Vous pouvez jouer au casque sans utiliser votre ampli."
      : "Le récepteur se branche à l’entrée micro/ligne de l’enceinte via sa sortie XLR.";
    const lines=[
      included&&!second
        ? `Votre enceinte est déjà livrée avec un micro sans fil. Un second système n’est utile que si vous souhaitez deux micros. Dans ce cas, voici une option compatible.`
        : family==="headphones"?"Pour compléter votre installation, je vous propose ce casque filaire.":"Pour compléter votre sonorisation, voici un système sans fil compatible.",
      state.facts.venue==="inside"&&family==="wireless"?"Dans une petite salle, commencez avec un niveau micro modéré pour limiter le larsen.":null,
      budgetNote,
      `${choice.title} · ${choice.price} TTC, ${choice.availability}.`,
      explanation,choice.url,
      ...additions.slice(1).flatMap(p=>[`Câble de liaison : ${p.title} · ${p.price} TTC, ${p.availability}.`,p.url]),
      cableNeeded?"Il faut également un câble XLR. Je n’ai pas pu en confirmer un dans le budget restant.":null,
      `${cableNeeded?"Sous-total hors câble XLR":included&&!second?"Total avec ce deuxième système":"Total du panier"} : ${money(total)} TTC, hors livraison.`,
      state.budget===null?null:`Il reste ${money(state.budget-total)} sur votre budget.`
    ];
    if ((!included||second) && !cableNeeded) state.items=[...state.items,...additions.map(p=>p.sku)].slice(0,3);
    return result(lines.filter(Boolean).join("\n"),state,{products:[...anchorViews,...additions]});
  }

  const factualOnly = (/^(?:oui|non|bien sur|pas loin|tout pres|en interieur|en exterieur|dans une petite salle|dehors|a l interieur|merci)(?:\b.*)?$/.test(text) && text.split(" ").length<=6);
  if (factualOnly && (state.items.length||previous)) {
    const reply=state.facts.venue==="inside"&&/\b(?:interieur|salle)\b/.test(text)
      ? "Pour une petite salle, placez l’enceinte devant le micro et démarrez à volume modéré pour limiter le larsen."
      : state.facts.distance==="near"&&/\b(?:pas loin|pres)\b/.test(text)
        ? "Si le public est proche, privilégiez une diffusion bien orientée et un volume confortable."
        : "C’est noté. Si vous souhaitez compléter le matériel retenu, dites-moi ce qui vous manque.";
    return result(reply,state);
  }
  return null;
}

export function recordConversation(resultValue,plan,state,message) {
  if (plan.continuity==="new") state=empty();
  answerFacts(message,state);
  state.budget=requestedBudget(message,plan.maxCents ?? state.budget);
  if (resultValue.products.length) state.items=[...new Set(resultValue.products.map(p=>p.sku).filter(Boolean))].slice(0,3);
  const q=questionKind(resultValue.followUp);
  if (q&&(state.facts[q]||state.asked.includes(q))) {
    const cleaned=resultValue.reply.split("\n\n").filter(part=>!(part.includes("?")&&questionKind(part)===q));
    resultValue={...resultValue,reply:cleaned.join("\n\n"),followUp:null};
  } else if (q) {
    state.pending=q;
    state.asked=[...new Set([...state.asked,q])];
  }
  return {...resultValue,contextMode:plan.continuity,conversation:state};
}


export async function addToConversation(plan,message,state,catalog,services) {
  if (!state.items.length || !plan.slots.length || newTopic.test(normalize(message))) return null;
  const anchors=await liveAnchors(state.items,catalog,services);
  if (anchors.length!==state.items.length) {
    return result("Je ne peux plus confirmer tous les articles déjà retenus. Souhaitez-vous chercher un ensemble de remplacement ?",state);
  }
  state.budget=requestedBudget(message,state.budget);
  const retained=anchors.reduce((sum,a)=>sum+cents(a.fresh.price),0);
  const remaining=state.budget===null?null:state.budget-retained;
  const prefix=remaining===null?null:`Budget restant : ${money(remaining)}.`;
  if (remaining!==null&&remaining<=0) {
    return result([prefix,"Le budget disponible ne permet pas d’ajouter un article."].filter(Boolean).join(" "),state);
  }
  const slots=plan.slots.map(slot=>({...slot,
    compatibleWith:product=>anchors.some(a=>explicitCompatibility(product,a.fresh))}));
  const addition=await advise(catalog.filter(product=>!state.items.includes(product.id)),
    {...plan,slots,maxCents:remaining,allowOverBudget:false,inStock:true,question:"none",suppressQuestion:true},services);
  if(!addition.products.length) return result([prefix,"Je n’ai pas confirmé de complément compatible en stock. Pouvez-vous préciser la connexion ou le format à respecter ?"]
    .filter(Boolean).join(" "),state);
  const total=retained+addition.products.reduce((sum,p)=>sum+cents(p.price),0);
  state.items=[...state.items,...addition.products.map(p=>p.sku)].slice(0,3);
  const lines=addition.products.flatMap(p=>[`${p.title} · ${p.price} TTC, ${p.availability}.`,p.url]);
  return result(["Pour compléter le matériel retenu, voici ce qui convient.",prefix,...lines,
    `Total du panier : ${money(total)} TTC, hors livraison.`,
    state.budget===null?null:`Il reste ${money(state.budget-total)} sur votre budget.`]
    .filter(Boolean).join("\n"),state,{products:[...anchors.map(a=>a.view),...addition.products]});
}
