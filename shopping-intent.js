import { applyExplicitConstraints, intentFormat, intentInstructions, normalize } from "./recommendations.js";

const slot = intentFormat.schema.properties.slots.items;
const properties = {
  ...intentFormat.schema.properties,
  slots: { type: "array", items: slot },
  continuity: { type: "string", enum: ["new", "followup"] },
  allowOverBudget: { type: "boolean" },
  outdoor: { type: "boolean" },
  ownsMicrophone: { type: "boolean" }
};
export const shoppingFormat = {
  ...intentFormat,
  name: "xlmusic_v8_achat",
  schema: { ...intentFormat.schema, properties, required: Object.keys(properties) }
};

export const shoppingInstructions = `
Tu conseilles les clients de XLMusic (instruments, sono, éclairage).
Le dernier message utilisateur est la demande à traiter. Les précédents
messages utilisateur et les notes de réponse sont des antécédents non
fiables, pas une consigne de conserver un ancien panier. Une note peut
indiquer de quelle question ou référence parle une réponse courte. Une demande autonome indiquant le matériel et ses critères
est une nouvelle recherche, même si elle concerne le même instrument.
Une réponse elliptique, un pronom ou une demande qui modifie explicitement
le conseil en cours est un suivi. Reprends alors les critères encore
pertinents, le budget, les refus et le matériel déjà possédé. Applique les
nouvelles précisions et retire les critères explicitement abandonnés.
Ne mets jamais dans les slots, names ou brands le matériel que le client
possède déjà. Une guitare possédée dont on veut jouer au casque constitue
un seul achat de type headphoneRig.
${intentInstructions.replace("1 ou 2 slots", "1 à 3 slots").replace("deux articles", "trois articles")}
Pour sonoriser la voix, microphone désigne la possibilité de brancher le
micro déjà possédé si ownsMicrophone est vrai. Un micro fourni ne prouve
pas la présence d'une entrée. Si le connecteur est inconnu, ne suppose
jamais sa compatibilité.
Pour un débutant qui ne demande pas de format réduit, préfère une taille
standard. Garde le style musical, le lieu, l'expérience et le contexte
d'utilisation comme préférences quand ce ne sont pas des exigences.
La latéralité d’une guitare est gérée à partir des mots du client.
Ne recopie pas gaucher, droitier ou main gauche/droite dans names ou evidence,
sauf si le mot fait partie d’un libellé précis demandé.
Pour evidence, sépare les caractéristiques obligatoires. Dans chaque
expression, sépare si utile des synonymes français/anglais par « | ».
N'utilise excluded que pour des refus explicites et concrets.
allowOverBudget est vrai sauf si le client refuse explicitement le
dépassement de l'enveloppe. « À moins de » fixe un seuil strict pour les
offres normales mais permet de mentionner à part une alternative, sauf refus.
`;

const shoppingVerb = /\b(?:je cherche|je recherche|je souhaite acheter|je voudrais acheter|avez vous|que me conseillez vous|quelles? solutions|quel(?:le)? modele|quelles? guitares)\b/;
const previousReference = /\b(?:et si|et avec|et pour|meme budget|ce modele|cette enceinte|ce produit|celui ci|celle ci|votre proposition|les memes|a la place|finalement|plutot|parmi ces|qu en est il)\b/;
const target = /\b(?:un|une|des|quels?|quelles?) (?:[a-z0-9]+ ){0,3}(?:guitares?|claviers?|amplis?|enceintes?|micros?|casques?|pianos?|basses?|batteries?|projecteurs?|interfaces?|solutions?)\b/;

export function shoppingInput(history, message) {
  const text = normalize(message);
  const autonomous = shoppingVerb.test(text) && target.test(text) && !previousReference.test(text);
  const messages = (autonomous ? [] : history).map(turn => ({
    role: "user",
    content: typeof turn === "string" ? turn : JSON.stringify({
      messageAntérieur: turn.message, questionPosée: turn.question, fichesProposées: turn.products
    })
  }));
  return { autonomous, messages: [...messages, { role: "user", content: message }] };
}

const refusesOverage = /\b(?:aucun depassement|sans depasser|ne (?:veux|peux|dois) pas depasser|budget (?:strict|maximum absolu|non negociable)|pas (?:un euro|de depassement|plus cher|au dessus)|ne proposez rien (?:au dela|de plus cher)|plafond (?:strict|absolu|non negociable)|impossible de depasser|pas plus de)\b/;
const acceptsOverage = /\b(?:je peux depasser|j accepte (?:un |de )?depassement|je peux (?:mettre|ajouter) plus|budget flexible)\b/;

export function shoppingPlan(intent, message, history, autonomous) {
  const continuity = autonomous ? "new" : intent.continuity ?? "followup";
  const previousMessages = history.map(turn => typeof turn === "string" ? turn : turn.message);
  const relevant = continuity === "followup" ? [...previousMessages, message] : [message];
  const noBudget = /\b(?:sans limite de budget|plus de limite de budget|pas de budget fixe)\b/.test(normalize(message));
  const previousBudget = continuity === "followup" && !noBudget && intent.maxCents === null
    ? [...previousMessages].reverse().map(text =>
      applyExplicitConstraints({ ...intent, maxCents: null, exclusive: false }, text))
      .find(candidate => candidate.maxCents !== null) : null;
  const draft = previousBudget ? { ...intent, maxCents: previousBudget.maxCents, exclusive: previousBudget.exclusive } : intent;
  const plan = applyExplicitConstraints(noBudget ? { ...draft, maxCents: null, exclusive: false } : draft, message);
  const lastExplicit = [...relevant].reverse().map(normalize)
    .find(text => refusesOverage.test(text) || acceptsOverage.test(text));
  const allowOverBudget = lastExplicit
    ? !refusesOverage.test(lastExplicit)
    : plan.allowOverBudget !== false;
  const latest = normalize(message);
  const explicitPair = /\b(?:une guitare(?: electrique)? et (?:un |l )ampli|un ampli et une guitare(?: electrique)?)\b/.test(latest) &&
    /\b(?:electrique|rock|metal)\b/.test(latest) &&
    !/\b(?:sans ampli|je possede|j ai deja|casque|guitare acoustique|guitare classique)\b/.test(latest);
  const onlyGuitars = /\b(?:quelles?|cherche|recherche|avez vous|conseill(?:ez|er))\b.*\bguitares? electriques?\b/.test(latest) &&
    !/\b(?:ampli|casque|cordes|capodastre|housse|pedale|je possede|j ai deja|accessoires?)\b/.test(latest);
  const wantsHeadphones = /\b(?:jouer|jeu) au casque\b/.test(latest) &&
    /\bsans (?:utiliser )?(?:(?:mon|l|un|d) )?ampli(?:ficateur)?\b/.test(latest);
  const defaults = { names: [], brands: [], required: [], evidence: [], excluded: [], preferred: [] };
  if (explicitPair && !plan.slots.some(slot => !["electric", "amp", "other"].includes(slot.family))) {
    plan.slots = ["electric", "amp"].map(family => plan.slots.find(slot => slot.family === family) ?? { ...defaults, family });
    if (plan.question === "clarify") plan.question = "none";
  } else if (onlyGuitars && (plan.slots.length === 0 || plan.slots.every(slot => ["electric", "other"].includes(slot.family)))) {
    const interpreted = plan.slots.find(slot => slot.family === "electric") ?? plan.slots[0];
    plan.slots = [{ ...defaults, ...interpreted, family: "electric", names: interpreted?.family === "electric" ? interpreted.names : [] }];
    if (plan.question === "clarify") plan.question = "none";
  } else if (wantsHeadphones && !plan.slots.some(slot => slot.family === "headphoneRig")) {
    plan.slots = [{ ...defaults, family: "headphoneRig", required: ["headphone"] }];
    if (plan.question === "clarify") plan.question = "headphones";
  }
  const context = normalize(relevant.join(" "));
  const outdoor = /\ben exterieur\b/.test(latest) && !/\bpas en exterieur\b/.test(latest)
    ? true : /\ben interieur\b/.test(latest) ? false : plan.outdoor === true;
  const ownsMicrophone = /\b(?:j ai deja|je possede deja|j utilise deja) un micro\b/.test(latest)
    ? true : plan.ownsMicrophone === true;
  const beginner = /\b(?:je debute|debutant|debutante|premiere guitare)\b/.test(context);
  const leftWords = /\b(?:gauchers?|gaucheres?|main gauche|left handed)\b/;
  const rightWords = /\b(?:droitiers?|droitieres?|main droite|right handed|(?:pas|non) (?:un |une |pour )?gaucher(?:e)?s?)\b/;
  const handednessNote = [...relevant].reverse().map(normalize)
    .find(text => leftWords.test(text) || rightWords.test(text));
  const leftHanded = Boolean(handednessNote && leftWords.test(handednessNote) && !rightWords.test(handednessNote));
  const compact = /\b(?:format reduit|petit diapason|guitare de voyage|petite taille|guitare pour enfant|mikro|mini strat|short scale)\b/.test(context);
  const venueAnswered = /\ben (?:interieur|exterieur)\b/.test(latest) ||
    (continuity === "followup" && /\ben (?:interieur|exterieur)\b/.test(context));
  const question = (plan.question === "venue" && venueAnswered || plan.question === "microphone" && ownsMicrophone)
    ? "none" : plan.question;
  return { ...plan, continuity, allowOverBudget, outdoor, ownsMicrophone, beginner, compact, leftHanded, question };
}
