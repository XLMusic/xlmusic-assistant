import { advise, availabilityOf } from "./advisor.js";
import { explicitCompatibility, guitarStrings, headphoneCandidate, isHeadphone, isJackCable, isXlrCable, productPorts, wirelessCandidate, wirelessOutput } from "./compatibility.js";
import { applyExplicitConstraints, cents, isStock, money, normalize } from "./recommendations.js";

const empty = () => ({items: [], budget: null, exclusive: false, pending: null, asked: [], facts: {}, topic: null});
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
    state.exclusive = value.exclusive === true;
    state.pending = factKeys.includes(value.pending) ? value.pending : null;
    state.asked = Array.isArray(value.asked) ? value.asked.filter(key => factKeys.includes(key)).slice(0,6) : [];
    state.facts = Object.fromEntries(factKeys.filter(key=>answerValues.has(value.facts?.[key])).map(key=>[key,value.facts[key]]));
    state.topic = value.topic === "strings" ? "strings" : null;
  }
  const turns = history.filter(turn=>typeof turn==="object");
  if (!state.items.length) {
    const prior = [...turns].reverse().find(turn=>turn.products?.length && !turn.alternatives);
    state.items = (prior?.products ?? []).flatMap(title=>{
      const found = products.filter(p=>normalize(p.title)===normalize(title));
      return found.length===1 ? [found[0].id] : [];
    });
  }
  if (!state.pending) state.pending = value ? null : questionKind(turns.at(-1)?.question);
  if (state.budget === null && !value) {
    for (const turn of [...history].reverse()) {
      const p = applyExplicitConstraints({slots:[],maxCents:null,inStock:false},typeof turn==="string"?turn:turn.message);
      if (safeAmount(p.maxCents)) { state.budget=p.maxCents;state.exclusive=p.exclusive===true; break; }
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

function stringsForCatalogGuitar(text, catalog) {
  const instruments = catalog.filter(product => {
    const category = normalize([product.productType, ...(product.categories ?? [])].join(" "));
    const title = normalize(product.title);
    if (!/\bguitares?\b/.test(category) ||
        /\b(?:cordes?|amplis?|accessoires?|housses?|etuis?|supports?)\b/.test(category)) return false;
    if (/\b(?:cordes? (?:pour|de)|jeux? de cordes|guitar strings?|housses?|etuis?)\b/.test(title)) return false;
    return [normalize(product.id), title].some(identity =>
      identity.length >= 5 && ` ${text} `.includes(` ${identity} `));
  });
  const kinds = new Set(instruments.map(product =>
    stringKind(normalize([product.productType, ...(product.categories ?? []), product.title].join(" ")))));
  if (kinds.size !== 1) return null;
  const [kind] = kinds;
  return kind === "acoustic" ? null : kind;
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

function accessoryPlan(matches,maxCents,candidate) {
  return {slots:[{family:"other",matches,candidate,names:[],brands:[],required:[],evidence:[],excluded:[],preferred:[]}],
    maxCents,exclusive:false,inStock:true,allowOverBudget:false,question:"none"};
}

function requestedBudget(message,state) {
  if (/\b(?:sans limite de budget|pas de budget fixe)\b/.test(normalize(message))) {
    state.exclusive=false;
    return null;
  }
  const plan=applyExplicitConstraints({slots:[],maxCents:state.budget,exclusive:state.exclusive,inStock:false},message);
  state.exclusive=plan.exclusive===true;
  return plan.maxCents;
}

const availableBudget = (remaining,state) => remaining===null?null:remaining-Number(state.exclusive);

const wirelessMicrophoneRequest = text => /\b(?:micros?|microphones?)\b/.test(text)&&/\b(?:sans fil|uhf|wireless)\b/.test(text)&&
    !/\b(?:pas de micro sans fil|ne veux pas de micro|sans micro)\b/.test(text);

export function hasCompatibilityContext(message, state, history) {
  const hasProduct = state.items.length > 0 || history.some(turn => turn?.products?.length);
  return hasProduct && (state.pending === "headphones" || wirelessMicrophoneRequest(normalize(message)));
}

export async function handleConversation(message,state,catalog,services,stringHint, allowStrings = true) {
  const text=normalize(message);
  if (newTopic.test(text)) {
    if (!stringHint) return null;
    state = empty();
  }
  const previous=state.pending;
  answerFacts(message,state);
  if (previous && state.facts[previous]) state.pending=null;
  const requestsStrings=/\bcordes?\b/.test(text.replace(/\b\d+ cordes?\b/g, "")) && /\bguitare\b/.test(text);
  const namedGuitar = requestsStrings || state.topic === "strings"
    ? stringsForCatalogGuitar(text, catalog) : null;
  const explicitKind = stringKind(text) ?? (stringHint === "unknown" ? null : stringHint);
  const kind = namedGuitar && (!explicitKind || explicitKind === "acoustic") ? namedGuitar : explicitKind;
  if (allowStrings && (requestsStrings || stringHint || (state.topic==="strings" && (kind || previous==="strings" && text.split(" ").length<=6)))) {
    const contextMode=state.topic==="strings"?"followup":"new";
    if (contextMode==="new") {state=empty();state.topic="strings";}
    state.budget=requestedBudget(message,state);
    if (kind) state.facts.strings=kind;
    const material=state.facts.strings;
    if (!material || material==="acoustic") {
      state.pending="strings";
      const question=stringQuestion(material);
      const same=previous==="strings" && !kind;
      const prompt=same?"Regardez les trois cordes les plus fines : si elles sont en nylon, c’est une classique. Si elles sont métalliques, c’est généralement une folk. Une marque et un modèle suffisent aussi.":question;
      return result(prompt,state,{followUp:same?null:question,contextMode});
    }
    const fits = product => guitarStrings(product, material);
    const isSavarez = product => normalize(product.brand) === "savarez" ||
      /^savarez\b/.test(normalize(product.title));
    const plan = accessoryPlan(fits, availableBudget(state.budget, state));
    plan.slots[0].preferredBrand = "Savarez";
    if (/\b(?:souple|tirant faible|tension faible|light)\b/.test(text)) {
      plan.slots[0].preferred = ["souple", "light", "faible"];
    }
    const selected = await advise(catalog, plan, services);
    const savarez = selected.verifiedProducts?.some(isSavarez);
    state.pending=null;
    state.items=selected.products.map(p=>p.sku);
    if (!selected.products.length) return result("Je n’ai pas trouvé de jeu adapté en stock. Si vous me donnez la marque et le modèle de votre guitare, je pourrai affiner.",state,{contextMode});
    const p=selected.products[0];
    const type={nylon:"nylon pour guitare classique",steel:"acier pour guitare folk",electric:"pour guitare électrique"}[material];
    return result([ `Je vous propose ce jeu ${type}.`, savarez ? "Les cordes Savarez sont fabriquées en France." : null, `${p.title} · ${p.price} TTC, ${p.availability}.`,p.url].filter(Boolean).join("\n"),state,{products:[p],contextMode});
  }

  const microphone=wirelessMicrophoneRequest(text);
  const headphones=previous==="headphones"&&state.facts.headphones==="no" ||
    /\b(?:casques?|ecouteurs?)\b/.test(text)&&
      (/\b(?:pas (?:de |un )?casque|casque compatible|quel casque|un casque (?:en plus|pour aller avec))\b/.test(text)||addWords.test(text));
  if (state.items.length && (microphone||headphones)) {
    const anchors=await liveAnchors(state.items,catalog,services);
    state.budget=requestedBudget(message,state);
    if (anchors.length!==state.items.length) {
      return result("Je ne peux plus confirmer le panier précédent en stock. Souhaitez-vous que je recherche un nouvel ensemble complet ?",state);
    }
    const family=headphones?"headphones":"wireless";
    const includedPair = family === "wireless" && anchors.find(item => productPorts(item.fresh).wirelessIncluded >= 2);
    if (includedPair && /\b(?:deuxieme|second|deux)\b/.test(text) &&
        !/\b(?:troisieme|trois|separe|independant|en plus des deux)\b/.test(text)) {
      const total = anchors.reduce((sum, item) => sum + cents(item.fresh.price), 0);
      state.pending = null;
      return result(`Le ${includedPair.view.title} est livré avec deux micros main sans fil UHF. Pour utiliser deux micros, le matériel retenu suffit. Total : ${money(total)} TTC, hors livraison.`,
        state, {products: anchors.map(item => item.view)});
    }
    const anchor=anchors.find(item=>family==="headphones"?productPorts(item.fresh).headphoneOut:(productPorts(item.fresh).paXlrIn||productPorts(item.fresh).paJackIn));
    if (!anchor) return result(family==="headphones"
      ? "Pour trouver le bon casque, il me faut le format de la sortie casque de votre appareil."
      : "Pour vérifier le branchement du récepteur, il me faut le type d’entrée micro ou ligne de votre enceinte.",state);
    const priorCost=anchors.reduce((sum,p)=>sum+cents(p.fresh.price),0);
    const remaining=state.budget===null?null:state.budget-priorCost;
    const included=family==="wireless"&&productPorts(anchor.fresh).wirelessIncluded;
    const second=/\b(?:deuxieme|second|supplementaire|en plus|autre|separe)\b/.test(text);
    const ports=productPorts(anchor.fresh);
    const match=family==="headphones"?isHeadphone:product=>Boolean(wirelessOutput(product,ports));
    const candidateType=family==="headphones"?headphoneCandidate:wirelessCandidate;
    if (anchors.some(item=>match(item.fresh))&&!second) {
      return result(family==="headphones"?"Le casque compatible figure déjà dans votre panier.":"Le système sans fil compatible figure déjà dans votre panier.",state);
    }
    let choice=null;
    if (remaining===null||availableBudget(remaining,state)>0) {
      const offered=await advise(catalog.filter(p=>!state.items.includes(p.id)),
        accessoryPlan(match,availableBudget(remaining,state),candidateType),services);
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
    let connector="xlr";
    if (family==="wireless") {
      const receiver=catalog.find(p=>p.id===choice.sku);
      let verifiedReceiver;
      try { if (receiver) verifiedReceiver=await services.readLive(receiver.oxId); } catch {}
      connector=verifiedReceiver ? wirelessOutput(verifiedReceiver,ports) : null;
      if (!connector) return result(included
        ? "Je n’ai pas pu reconfirmer la sortie du second récepteur. Le micro sans fil fourni avec l’enceinte reste utilisable."
        : "Je n’ai pas pu reconfirmer la sortie du récepteur pour cette enceinte.",state,{products:anchorViews});
      const includedCable=connector==="jack"?/\bcable (?:audio )?jack(?: 6 35)? (?:fourni|inclus|livre)\b/:/\bcable xlr (?:fourni|inclus|livre)\b/;
      cableNeeded=!includedCable.test(normalize(verifiedReceiver?.description));
      const forCable=remaining===null?null:availableBudget(remaining-cents(choice.price),state);
      if(cableNeeded && (forCable===null||forCable>0)) {
        const possible=await advise(catalog.filter(p=>!state.items.includes(p.id)&&p.id!==choice.sku),
          accessoryPlan(connector==="jack"?isJackCable:isXlrCable,forCable),services);
        if(possible.products[0]){additions.push(possible.products[0]);cableNeeded=false;}
      }
    }
    const total=priorCost+additions.reduce((sum,p)=>sum+cents(p.price),0);
    const explanation=family==="headphones"
      ? "Son mini-jack 3,5 mm se branche sur la sortie casque. Vous pouvez jouer au casque sans utiliser votre ampli."
      : `Le récepteur se branche à l’entrée micro/ligne de l’enceinte via sa sortie ${connector==="jack"?"jack 6,35 mm":"XLR"}.`;
    const lines=[
      included&&!second
        ? `Votre enceinte est déjà livrée avec un micro sans fil. Un second système n’est utile que si vous souhaitez deux micros. Dans ce cas, voici une option compatible.`
        : family==="headphones"?"Pour compléter votre installation, je vous propose ce casque filaire.":"Pour compléter votre sonorisation, voici un système sans fil compatible.",
      state.facts.venue==="inside"&&family==="wireless"?"Dans une petite salle, commencez avec un niveau micro modéré pour limiter le larsen.":null,
      budgetNote,
      `${choice.title} · ${choice.price} TTC, ${choice.availability}.`,
      explanation,choice.url,
      ...additions.slice(1).flatMap(p=>[`Câble de liaison : ${p.title} · ${p.price} TTC, ${p.availability}.`,p.url]),
      cableNeeded?`Il faut également un câble ${connector==="jack"?"jack 6,35 mm":"XLR"}. Je n’ai pas pu en confirmer un dans le budget restant.`:null,
      `${cableNeeded?"Sous-total hors câble":included&&!second?"Total avec ce deuxième système":"Total du panier"} : ${money(total)} TTC, hors livraison.`,
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
  if (plan.maxCents!==null && plan.maxCents!==undefined) {
    state.budget=plan.maxCents;
    state.exclusive=plan.exclusive===true;
  }
  state.budget=requestedBudget(message,state);
  if (resultValue.alternatives) state.items=[];
  else if (resultValue.products.length) state.items=[...new Set(resultValue.products.map(p=>p.sku).filter(Boolean))].slice(0,3);
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
  state.budget=requestedBudget(message,state);
  const retained=anchors.reduce((sum,a)=>sum+cents(a.fresh.price),0);
  const remaining=state.budget===null?null:state.budget-retained;
  const prefix=remaining===null?null:`Budget restant : ${money(remaining)}.`;
  if (remaining!==null&&availableBudget(remaining,state)<=0) {
    return result([prefix,"Le budget disponible ne permet pas d’ajouter un article."].filter(Boolean).join(" "),state);
  }
  const slots=plan.slots.map(slot=>({...slot,
    compatibleWith:product=>anchors.some(a=>explicitCompatibility(product,a.fresh))}));
  const addition=await advise(catalog.filter(product=>!state.items.includes(product.id)),
    {...plan,slots,maxCents:availableBudget(remaining,state),exclusive:false,allowOverBudget:false,inStock:true,question:"none",suppressQuestion:true},services);
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
