import { normalize } from "./recommendations.js";

// Supplement catalog descriptions only when the exact published SKU matches.
// Fender manufacturer specifications and the XLMusic Aeris product sheet.
const documented = {
  "231-1600-000": { headphoneOut: true },
  MACAERIS110: { paXlrIn: true, wirelessIncluded: true }
};

const audio = product => normalize([product.title,product.productType,...(product.categories??[])].join(" "));
const textOf = product => normalize(product.description);
const headphone = /\b(?:casques?|headphones?)\b/;
const wireless = /\b(?:sans fil|wireless|uhf|vhf|hf)\b/;
const mic = /\b(?:micros?|microphones?|microphoniques?)\b/;
const accessory = /\b(?:coussinets?|etuis?|housses?|supports?|pieces detachees?|care kit|repair kit)\b/;

export function productPorts(product) {
  const text = textOf(product);
  const known = Object.hasOwn(documented, product.id) ? documented[product.id] : {};
  return {
    headphoneOut: known.headphoneOut || /\b(?:sortie|prise) (?:jack |mini jack )?(?:casque|headphones?)\b.{0,45}\b(?:3 5|3 50|1 8)\b|\b(?:3 5|1 8)\b.{0,32}\b(?:sortie|prise) (?:casque|headphones?)\b/.test(text),
    paXlrIn: known.paXlrIn || /\b(?:entrees?|prises?) (?:micro |mic |ligne |micro ligne |mic ligne |combo ){0,4}xlr\b/.test(text),
    wirelessIncluded: known.wirelessIncluded ||
      /\b(?:micro(?:phone)?(?: uhf)? sans fil|micro(?:phone)? uhf) (?:inclus|fourni|livre)\b/.test(text)
  };
}

export function isHeadphone(product) {
  const identity = audio(product);
  return headphone.test(identity) && !accessory.test(normalize(product.title)) &&
    !/\b(?:ampli(?:ficateur)?|repartiteur|cables?|adaptateurs?|preamplis?|sans fil|gaming)\b/.test(normalize(product.title)) &&
    /\b(?:mini jack|minijack|3 5 mm|3 50 mm|1 8)\b/.test(textOf(product));
}

export function isWirelessMic(product) {
  const identity = audio(product);
  const title = normalize(product.title);
  const text = textOf(product);
  const receiver = /\b(?:recepteur|receiver)\b/;
  const complete = /\b(?:emetteur|transmitter|micro(?:phone)? (?:a main|main|cravate|serre tete)|ensemble|systeme|kit)\b/;
  return mic.test(identity) && wireless.test(identity + " " + text) && !accessory.test(title) &&
    receiver.test(text) && complete.test(title + " " + text) &&
    /\b(?:sorties?|outputs?)\b.{0,48}\bxlr\b|\bxlr\b.{0,35}\b(?:sortie|output)\b/.test(text);
}

export function guitarStrings(product, material) {
  const identity = audio(product);
  const title = normalize(product.title);
  const text = identity + " " + textOf(product);
  const set = /\b(?:jeux? (?:de )?cordes?|sets? (?:de )?cordes?|cordes? (?:de |pour )?(?:guitares?|classiques?|acoustiques?)|guitar strings?|strings? set)\b/;
  if (!set.test(identity) || accessory.test(title) ||
      /\b(?:basses?|ukuleles?|violons?|mandolines?|banjos?|a l unite|corde seule|corde de remplacement)\b/.test(title)) return false;
  if (material === "electric") return /\b(?:guitares? electriques?|electric guitar)\b/.test(text);
  if (material === "nylon") return /\b(?:nylon|classiques?|classical)\b/.test(text) &&
    !/\b(?:steel strings?|guitares? folk|cordes? acier)\b/.test(title);
  return /\b(?:folk|acoustiques?|acoustic|phosphor(?:e)? bronze|bronze 80 20|steel strings?)\b/.test(text) &&
    !/\b(?:nylon|classiques?|classical|guitares? electriques?|electric guitar)\b/.test(title);
}

export function isXlrCable(product) {
  const text = audio(product) + " " + textOf(product);
  return /\b(?:cables?|cordons?)\b/.test(audio(product)) &&
    !/\b(?:adaptateurs?|multipaires?|jack|trs|rca|usb)\b/.test(normalize(product.title)) &&
    (/\bxlr\b.{0,35}\bxlr\b/.test(text) ||
      /\bxlr\b/.test(text) && /\bmale\b/.test(text) && /\bfemelle\b/.test(text));
}

export function explicitCompatibility(product, anchor) {
  const productText = [product.title, ...(product.description??"").split(/[\n;.!?]/)].map(normalize);
  const names = [normalize(anchor.id),normalize(anchor.title)].filter(term=>term.length>=5);
  return productText.some(part=>/\b(?:compatible|concu|destine|dedie|pour|fits|designed for)\b/.test(part) &&
    names.some(n=>` ${part} `.includes(` ${n} `)));
}
