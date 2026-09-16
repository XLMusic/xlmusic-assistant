import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import * as cheerio from "cheerio";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const MODEL = process.env.OPENAI_MODEL || "gpt-5.6-luna";
const CATEGORY_URL = "https://www.xlmusic.fr/guitares-electriques-c102x1249563";
const SITE = "https://www.xlmusic.fr";

app.use(express.json({ limit: "20kb" }));
app.use(cors());

let catalog = [];
let catalogUpdatedAt = null;

const clean = s => String(s || "").replace(/\s+/g, " ").trim();
const absoluteUrl = href => new URL(href, SITE).href;

function euroPrice(text) {
  const m = clean(text).match(/(\d{1,3}(?:[.\s]\d{3})*,\d{2})\s*€/);
  return m ? m[1].replace(/\s/g, "") + " €" : null;
}

async function fetchText(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; XLMusicAssistant/1.0; +https://www.xlmusic.fr/)",
      "Accept-Language": "fr-FR,fr;q=0.9"
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} pour ${url}`);
  return await r.text();
}

async function refreshCatalog() {
  const html = await fetchText(CATEGORY_URL);
  const $ = cheerio.load(html);
  const found = new Map();

  $('a[href*="c2x"]').each((_, a) => {
    const href = $(a).attr("href");
    const name = clean($(a).text());
    if (!href || !name || name.length < 5) return;

    const url = absoluteUrl(href);
    if (!/c2x\d+/i.test(url)) return;

    // On remonte autour du lien pour récupérer prix et disponibilité.
    let node = $(a);
    let context = "";
    for (let i = 0; i < 5 && node.length; i++, node = node.parent()) {
      const t = clean(node.text());
      if (t.length > context.length && t.length < 2500) context = t;
      if (/€/.test(t) && /(En Stock|Détails|Acheter)/i.test(t)) break;
    }

    const price = euroPrice(context);
    const inStock = /En Stock/i.test(context);
    const unavailable = /(rupture|indisponible|épuisé)/i.test(context);

    const existing = found.get(url);
    const item = {
      name,
      price,
      stock: unavailable ? "Indisponible" : (inStock ? "En stock" : "Non confirmé"),
      url
    };
    if (!existing || (price && !existing.price)) found.set(url, item);
  });

  catalog = [...found.values()].filter(x => x.price || x.stock === "En stock");
  catalogUpdatedAt = new Date().toISOString();
  console.log(`Catalogue XLMusic actualisé : ${catalog.length} guitares électriques`);
  return catalog;
}

function tokenize(s) {
  const stop = new Set(["je","tu","il","elle","nous","vous","ils","elles","un","une","des","de","du","la","le","les","pour","avec","sans","et","ou","dans","sur","qui","que","quoi","cherche","recherche","veux","voudrais","conseille","conseilles","guitare","electrique","électrique"]);
  return clean(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .split(/[^a-z0-9]+/).filter(w => w.length > 2 && !stop.has(w));
}

function extractBudget(message) {
  const s = message.replace(/\s/g,"");
  const m = s.match(/(?:€|eur(?:os?)?)?(\d{2,5})(?:€|eur(?:os?)?)?/i);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 50 && n <= 20000 ? n : null;
}

function numericPrice(p) {
  if (!p) return null;
  return Number(p.replace(/[^\d,]/g,"").replace(",","."));
}

function searchCatalog(message, limit=12) {
  const terms = tokenize(message);
  const budget = extractBudget(message);
  return catalog.map(p => {
    const hay = clean(p.name).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
    let score = terms.reduce((s,t)=>s+(hay.includes(t)?4:0),0);
    if (p.stock === "En stock") score += 2;
    const price = numericPrice(p.price);
    if (budget && price) {
      const ratio = Math.abs(price-budget)/budget;
      score += ratio <= .10 ? 5 : ratio <= .25 ? 3 : ratio <= .50 ? 1 : -2;
      if (/moins de|maximum|max|jusqu/i.test(message) && price <= budget) score += 3;
    }
    return {...p, score};
  }).sort((a,b)=>b.score-a.score).slice(0,limit);
}

async function enrichProduct(p) {
  try {
    const html = await fetchText(p.url);
    const $ = cheerio.load(html);
    $("script,style,nav,header,footer").remove();
    const text = clean($("body").text()).slice(0,7000);
    return {...p, details:text};
  } catch {
    return p;
  }
}

const page = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Assistant XLMusic</title>
<style>
body{font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:30px;color:#171717}.wrap{max-width:800px;margin:auto;background:#fff;border-radius:16px;padding:24px;box-shadow:0 8px 30px #0001}
h1{margin-top:0}.sub{color:#666;margin-bottom:18px}.status{font-size:13px;background:#f5f5f5;padding:8px 10px;border-radius:8px;margin-bottom:12px}
#chat{height:410px;overflow:auto;border:1px solid #ddd;border-radius:12px;padding:15px;background:#fafafa}.msg{margin:10px 0;padding:10px 12px;border-radius:10px;white-space:pre-wrap;line-height:1.4}
.me{background:#e9e9e9;margin-left:15%}.ai{background:#f2f7ff;margin-right:8%}.row{display:flex;gap:10px;margin-top:12px}input{flex:1;padding:13px;border:1px solid #bbb;border-radius:10px;font-size:16px}
button{padding:13px 18px;border:0;border-radius:10px;background:#111;color:#fff;font-weight:bold;cursor:pointer}small{display:block;color:#777;margin-top:10px}a{color:#174ea6}
</style></head><body><div class="wrap"><h1>Assistant XLMusic</h1>
<div class="sub">Test catalogue XLMusic — Guitares électriques</div>
<div id="status" class="status">Chargement du catalogue…</div>
<div id="chat"><div class="msg ai">Bonjour ! Je peux maintenant rechercher dans le catalogue de guitares électriques publié sur XLMusic.fr.</div></div>
<form id="form" class="row"><input id="q" maxlength="2000" placeholder="Ex. Une guitare métal en stock autour de 500 €..." autocomplete="off"><button>Envoyer</button></form>
<small>Les prix et disponibilités proviennent du site XLMusic au moment de l’actualisation du catalogue.</small></div>
<script>
const form=document.getElementById("form"),q=document.getElementById("q"),chat=document.getElementById("chat"),status=document.getElementById("status");
function add(text,cls){const d=document.createElement("div");d.className="msg "+cls;d.textContent=text;chat.appendChild(d);chat.scrollTop=chat.scrollHeight}
async function state(){try{const r=await fetch("/api/catalog/status");const d=await r.json();status.textContent="Catalogue : "+d.count+" guitares électriques • actualisé : "+(d.updatedAt?new Date(d.updatedAt).toLocaleString("fr-FR"):"en cours");}catch{}}
state();
form.addEventListener("submit",async e=>{e.preventDefault();const message=q.value.trim();if(!message)return;add(message,"me");q.value="";add("Recherche dans le catalogue XLMusic…","ai");const w=chat.lastChild;
try{const r=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message})});const d=await r.json();w.remove();add(d.reply||("Erreur : "+(d.error||"réponse inconnue")),"ai");state()}catch{w.remove();add("Erreur de connexion au serveur.","ai")}});
</script></body></html>`;

app.get("/", (_,res)=>res.type("html").send(page));
app.get("/health", (_,res)=>res.json({ok:true,service:"Assistant XLMusic",model:MODEL,catalogCount:catalog.length}));
app.get("/api/catalog/status", (_,res)=>res.json({count:catalog.length,updatedAt:catalogUpdatedAt,source:CATEGORY_URL}));
app.post("/api/catalog/refresh", async (_,res)=>{
  try { await refreshCatalog(); res.json({ok:true,count:catalog.length,updatedAt:catalogUpdatedAt}); }
  catch(e){ res.status(500).json({error:e.message}); }
});

app.post("/api/chat", async (req,res)=>{
  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({error:"OPENAI_API_KEY non configurée."});
    const message=clean(req.body?.message);
    if(!message) return res.status(400).json({error:"Message manquant."});
    if(message.length>2000) return res.status(400).json({error:"Message trop long."});

    if(!catalog.length) await refreshCatalog();
    const candidates=searchCatalog(message,10);
    const top=await Promise.all(candidates.slice(0,5).map(enrichProduct));

    const catalogContext=top.map((p,i)=>`PRODUIT ${i+1}
Nom: ${p.name}
Prix affiché: ${p.price || "non extrait"}
Disponibilité affichée: ${p.stock}
URL: ${p.url}
Contenu fiche: ${p.details || "non chargé"}`).join("\n\n");

    const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY});
    const response=await client.responses.create({
      model:MODEL,
      reasoning:{effort:"low"},
      instructions:`Tu es l'Assistant XLMusic, conseiller du magasin français XLMusic.
Réponds en français, de façon claire, commerciale mais factuelle.
Tu disposes ci-dessous d'une sélection issue du catalogue public XLMusic.fr.
RÈGLES ABSOLUES :
- Ne recommande comme produit XLMusic que les produits présents dans le contexte fourni.
- Ne modifie jamais un prix, un état de stock, une référence ou une URL.
- Pour un prix et une disponibilité, utilise exclusivement les valeurs du contexte.
- Si les produits fournis ne permettent pas de répondre correctement, dis-le au lieu d'inventer.
- Quand tu proposes un produit, donne son nom, son prix affiché, sa disponibilité affichée et son URL.
- Les caractéristiques techniques doivent provenir de la fiche fournie ; sinon indique que l'information n'est pas confirmée.
- Cette V4 ne couvre pour l'instant que les guitares électriques.
- N'utilise pas de Markdown avec ** car l'interface de test l'affiche en texte brut.

CATALOGUE XLMUSIC FOURNI :
${catalogContext}`,
      input:message,
      max_output_tokens:700
    });
    res.json({reply:response.output_text||"Je n'ai pas pu produire de réponse.",catalogUpdatedAt});
  }catch(error){
    console.error(error);
    res.status(500).json({error:"Erreur lors de la recherche catalogue ou de l'appel à OpenAI."});
  }
});

refreshCatalog().catch(e=>console.error("Actualisation initiale catalogue:",e.message));
setInterval(()=>refreshCatalog().catch(e=>console.error("Actualisation catalogue:",e.message)), 6*60*60*1000);

app.listen(port,"0.0.0.0",()=>console.log(`Assistant XLMusic V4 démarré sur le port ${port}`));
