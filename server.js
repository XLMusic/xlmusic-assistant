import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import { shoppingFormat, shoppingInstructions, shoppingInput, shoppingPlan } from "./shopping-intent.js";
import { adviceFormat, adviceInstructions, advise, adviseExactProduct } from "./advisor.js";
import { createProductLinkVerifier } from "./product-links.js";
import { XMLParser } from "fast-xml-parser";
import { createOxatis } from "./oxatis.js";
import { createCatalogStore } from "./catalog-store.js";
import { configureCatalogAdmin, protectCatalogAdmin } from "./catalog-admin.js";

dotenv.config();
const app=express();
const port=Number(process.env.PORT ?? 3000);
const MODEL=process.env.OPENAI_MODEL||"gpt-5.6-luna";
const FEED_URL=process.env.CATALOG_FEED_URL||"https://www.xlmusic.fr/Data/GoogleShopping/fr/Oxatis-fr-xlmusic-31826.xml";

app.use(express.json({limit:"20kb"}));
app.use(cors());
app.disable("x-powered-by");

const useOxatis = process.env.CATALOG_SOURCE === "oxatis";
const oxatisConfigured = Boolean(process.env.OXATIS_APP_ID && process.env.OXATIS_TOKEN);
const oxatis = createOxatis({ appId: process.env.OXATIS_APP_ID, token: process.env.OXATIS_TOKEN });
const store = process.env.DATABASE_URL ? createCatalogStore(process.env.DATABASE_URL, oxatis) : null;
configureCatalogAdmin(app, oxatis, store);

let catalog=[], catalogUpdatedAt=null, lastCatalogError=null;
let oxatisCatalogReadAt = null;
const oxatisCatalogMaxAge = 5 * 60_000;
const productLink = createProductLinkVerifier(fetch, { strict: true });
const clean=s=>String(s??"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim();
const arr=x=>Array.isArray(x)?x:(x?[x]:[]);

async function fetchFeed(){
 const r=await fetch(FEED_URL,{headers:{"Accept":"application/xml,text/xml,*/*","User-Agent":"XLMusic-Assistant/1.0"},signal:AbortSignal.timeout(20000)});
 if(!r.ok) throw new Error(`HTTP ${r.status}`);
 return r.text();
}
let refreshInFlight;
function refreshCatalog() {
 if (!refreshInFlight) refreshInFlight = loadCatalog().finally(() => { refreshInFlight = null; });
 return refreshInFlight;
}

async function loadCatalog(){
 if (useOxatis) {
  if (!store) {
   lastCatalogError = "Connexion PostgreSQL non configurée.";
   return;
  }
  try {
   const current = await store.current();
   catalog = current?.products ?? [];
   catalogUpdatedAt = current?.updatedAt ?? null;
   oxatisCatalogReadAt = catalog.length ? Date.now() : null;
   lastCatalogError = catalog.length ? null : "Aucun catalogue PostgreSQL publié.";
  } catch (error) {
   const code = error?.code;
   console.error("Lecture du catalogue PostgreSQL impossible.",
    typeof code === "string" && /^[A-Z0-9_]{1,32}$/.test(code) ? code : "CODE_INDISPONIBLE");
   if (oxatisCatalogReadAt !== null && Date.now() - oxatisCatalogReadAt < oxatisCatalogMaxAge) {
    lastCatalogError = "Lecture PostgreSQL échouée. Dernier catalogue publié utilisé.";
    return;
   }
   catalog = [];
   catalogUpdatedAt = null;
   oxatisCatalogReadAt = null;
   lastCatalogError = "Catalogue Oxatis indisponible.";
  }
  return;
 }
 try{
  const xml=await fetchFeed();
  const parser=new XMLParser({ignoreAttributes:false,removeNSPrefix:true,processEntities:true,trimValues:false,parseTagValue:false});
  const data=parser.parse(xml);
  const items=arr(data?.rss?.channel?.item);
  const products=items.map(x=>({
   id:clean(x.id), oxId:clean(x.link).match(/-c2x([1-9]\d{0,14})(?:[/?#]|$)/i)?.[1], title:clean(x.title), brand:clean(x.brand),
   price:clean(x.price), quantity:Number(x.quantity??0),
   availability:clean(x.availability), gtin:clean(x.gtin), mpn:clean(x.mpn),
   productType:clean(x.product_type), description:clean(x.description),
   url:clean(x.link), image:clean(x.image_link)
  })).filter(x=>x.id&&x.title);
  if (!products.length) throw new Error("Flux vide.");
  catalog=products;
  catalogUpdatedAt=new Date().toISOString(); lastCatalogError=null;
  console.log(`Catalogue XML chargé : ${catalog.length} produits`);
 }catch(e){lastCatalogError="Flux catalogue indisponible."; console.error("Lecture du flux catalogue impossible.");}
}
const html=`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Assistant XLMusic</title><style>body{font-family:Arial;background:#f4f4f4;margin:0;padding:30px;color:#171717}.w{max-width:820px;margin:auto;background:white;border-radius:16px;padding:24px}h1{margin:0 0 8px}.s{color:#666;margin-bottom:15px}.st{font-size:13px;background:#f3f3f3;padding:9px;border-radius:8px;margin-bottom:12px}#c{height:410px;overflow:auto;border:1px solid #ddd;border-radius:12px;padding:15px;background:#fafafa}.m{margin:10px 0;padding:10px 12px;border-radius:10px;white-space:pre-wrap;line-height:1.4}.me{background:#e9e9e9;margin-left:15%}.ai{background:#f2f7ff;margin-right:8%}.r{display:flex;gap:10px;margin-top:12px}input{flex:1;padding:13px;border:1px solid #bbb;border-radius:10px;font-size:16px}button{padding:13px 18px;border:0;border-radius:10px;background:#111;color:white;font-weight:bold}</style></head><body><div class="w"><h1>Assistant XLMusic</h1><div class="s">V8 — Conseil XLMusic</div><div id="st" class="st">Chargement…</div><div id="c"><div class="m ai">Bonjour ! Quel matériel recherchez-vous ?</div></div><form id="f" class="r"><input id="q" maxlength="2000" placeholder="Ex. Une guitare métal en stock autour de 500 €"><button>Envoyer</button></form></div><script>
const f=document.getElementById("f"),q=document.getElementById("q"),c=document.getElementById("c"),st=document.getElementById("st");
const history=[];
function add(t,k,products=[]){
 const d=document.createElement("div");
 d.className="m "+k;
 const verified=new Set(products.map(product=>product.url).filter(Boolean));
 t.split("\\n").forEach((line,i)=>{
  if(i) d.append("\\n");
  const url=line.trim();
  if(!verified.has(url)){d.append(line);return}
  const a=document.createElement("a");
  a.href=url;a.textContent="Voir la fiche produit";a.target="_blank";a.rel="noopener noreferrer";
  d.append(a);
 });
 c.appendChild(d);c.scrollTop=c.scrollHeight;
}
async function status(){try{
 const d=await(await fetch("/api/catalog/status")).json();
 st.textContent=d.count?d.count+" produits":"Le catalogue est momentanément indisponible.";
}catch{}}
status();
f.onsubmit=async e=>{
 e.preventDefault();
 const m=q.value.trim(), button=f.querySelector("button");
 if(!m||button.disabled)return;
 button.disabled=true;add(m,"me");q.value="";add("Je regarde ce qui peut vous convenir…","ai");
 const pending=c.lastChild;
 try{
  const r=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:m,history})});
  const d=await r.json();
  if(r.ok){if(d.contextMode==="new")history.length=0;
   history.push({message:m,question:d.followUp,products:d.products.map(product=>product.title)});
   if(history.length>4)history.splice(1,1)}
  add(d.reply||d.error,"ai",d.products);
 }catch{add("Erreur de connexion.","ai")}
 finally{pending.remove();button.disabled=false;q.focus()}
};
</script></body></html>`;

app.get("/",(_,res)=>res.type("html").send(html));
const source = useOxatis ? "oxatis" : "feed";
async function catalogStatus() {
 if (useOxatis || (!catalog.length && !lastCatalogError)) await refreshCatalog();
 return { source, count: catalog.length, updatedAt: catalogUpdatedAt, error: lastCatalogError };
}

app.get("/health",async(_,res)=>{
 const state=await catalogStatus();
 const openAIConfigured=Boolean(process.env.OPENAI_API_KEY);
 const catalogAvailable = state.count > 0 && (useOxatis || !state.error);
 const ready = catalogAvailable && openAIConfigured && (!useOxatis || oxatisConfigured);
 res.set("Cache-Control","no-store").status(ready?200:503).json({
  ok:ready, version:"V8", model:MODEL, catalogSource:state.source, catalogCount:state.count,
  catalogUpdatedAt:state.updatedAt, lastCatalogError:state.error,
  openAIConfigured, oxatisConfigured:useOxatis ? oxatisConfigured : null
 });
});
app.get("/api/catalog/status",async(_,res)=>{
 res.set("Cache-Control","no-store").json(await catalogStatus());
});
app.post("/api/catalog/refresh",protectCatalogAdmin,async(_,res)=>{
 await refreshCatalog();
 res.json({source,count:catalog.length,updatedAt:catalogUpdatedAt,error:lastCatalogError});
});

let activeChats = 0;
let chatBudget = 20;
let resetBudgetAt = Date.now() + 60_000;

app.post("/api/chat",async(req,res)=>{
 res.set("Cache-Control", "no-store");
 const raw = req.body?.message;
 if (typeof raw !== "string" || raw.length > 2000 || !clean(raw)) {
  return res.status(400).json({error:"Message invalide."});
 }
 if (Date.now() >= resetBudgetAt) {
  resetBudgetAt = Date.now() + 60_000;
  chatBudget = 20;
 }
 if (activeChats >= 3 || chatBudget === 0) {
  return res.set("Retry-After", "60").status(429).json({error:"Trop de demandes. Réessayez dans un instant."});
 }
 chatBudget--;
 activeChats++;
 try{
  const message=clean(raw);
  if(useOxatis || !catalog.length) await refreshCatalog();
  if(!catalog.length)return res.status(503).json({error:"Je ne peux pas vérifier les produits pour le moment. Réessayez dans un instant."});
  const snapshot=catalog;
  const catalogServices = { readLive: oxatisConfigured ? oxatis.product : undefined, productLink };
  const exact = await adviseExactProduct(snapshot, message, catalogServices);
  if (exact) return res.json(exact);
  const boundedText = (value, limit) => typeof value === "string" && value.length <= limit ? clean(value) : "";
  const history = Array.isArray(req.body?.history) ? req.body.history.slice(-4).flatMap(item => {
   if (typeof item === "string") {
    const previous = boundedText(item, 2000);
    return previous ? [previous] : [];
   }
   const previous = boundedText(item?.message, 2000);
   if (!previous) return [];
   const products = Array.isArray(item.products) ? item.products.slice(0, 3).map(title => boundedText(title, 200)).filter(Boolean) : [];
   return [{ message: previous, question: boundedText(item.question, 500), products }];
  }) : [];
  const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY, timeout:15000, maxRetries:0});
  const { autonomous, messages } = shoppingInput(history, message);
  const response=await client.responses.create({
   model:MODEL, reasoning:{effort:"low"}, max_output_tokens:1700,
   instructions:shoppingInstructions,
   input:messages,
   text:{format:shoppingFormat}
  });
  if (response.status !== "completed" || !response.output_text) {
   return res.status(502).json({error:"Je n’ai pas pu analyser votre demande. Pouvez-vous la reformuler ?"});
  }
  const plan = shoppingPlan(JSON.parse(response.output_text), message, history, autonomous);
  const result = await advise(snapshot, plan, {
   ...catalogServices,
   choose: async options => {
    const advice = await client.responses.create({
     model:MODEL, reasoning:{effort:"low"}, max_output_tokens:500,
     instructions:adviceInstructions,
     input:JSON.stringify({ context: plan.continuity === "new" ? [] : history, message, options }),
     text:{format:adviceFormat}
    }, { timeout:5000 });
    return advice.status === "completed" && advice.output_text ? JSON.parse(advice.output_text) : null;
   }
  });
  res.json({ ...result, contextMode: plan.continuity });
 }catch {
  console.error("Analyse ou recherche de conseil impossible.");
  res.status(500).json({error:"Je ne peux pas traiter votre demande pour le moment."});
 }finally {
  activeChats--;
 }
});

app.use((error, _req, res, _next) => {
 if (error.status === 413) return res.status(413).json({error:"Message trop volumineux."});
 if (error.status === 400) return res.status(400).json({error:"Requête invalide."});
 res.status(500).json({error:"Erreur interne."});
});

export const server = app.listen(port,"0.0.0.0",()=>{
 console.log(`Assistant XLMusic V8 démarré sur le port ${server.address().port}`);
 void refreshCatalog();
});
if (!useOxatis) setInterval(refreshCatalog,60*60*1000).unref();
