import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import { XMLParser } from "fast-xml-parser";

dotenv.config();
const app=express();
const port=process.env.PORT||3000;
const MODEL=process.env.OPENAI_MODEL||"gpt-5.6-luna";
const FEED_URL=process.env.CATALOG_FEED_URL||"https://www.xlmusic.fr/Data/GoogleShopping/fr/Oxatis-fr-xlmusic-31826.xml";

app.use(express.json({limit:"20kb"}));
app.use(cors());

let catalog=[], catalogUpdatedAt=null, lastCatalogError=null;
const clean=s=>String(s??"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim();
const arr=x=>Array.isArray(x)?x:(x?[x]:[]);

async function fetchFeed(){
 const r=await fetch(FEED_URL,{headers:{"Accept":"application/xml,text/xml,*/*","User-Agent":"XLMusic-Assistant/1.0"},signal:AbortSignal.timeout(20000)});
 if(!r.ok) throw new Error(`HTTP ${r.status}`);
 return r.text();
}
async function refreshCatalog(){
 try{
  const xml=await fetchFeed();
  const parser=new XMLParser({ignoreAttributes:false,removeNSPrefix:true,processEntities:true,trimValues:false});
  const data=parser.parse(xml);
  const items=arr(data?.rss?.channel?.item);
  catalog=items.map(x=>({
   id:clean(x.id), title:clean(x.title), brand:clean(x.brand),
   price:clean(x.price), quantity:Number(x.quantity??0),
   availability:clean(x.availability), gtin:clean(x.gtin), mpn:clean(x.mpn),
   productType:clean(x.product_type), description:clean(x.description),
   url:clean(x.link), image:clean(x.image_link)
  })).filter(x=>x.id&&x.title);
  catalogUpdatedAt=new Date().toISOString(); lastCatalogError=null;
  console.log(`Catalogue XML chargé : ${catalog.length} produits`);
 }catch(e){lastCatalogError=e.message; console.error("Catalogue XML:",e.message);}
}
const norm=s=>clean(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
const stop=new Set("je tu il elle nous vous un une des de du la le les pour avec sans et ou dans sur qui que quoi cherche recherche veux voudrais conseille conseilles produit produits".split(" "));
function terms(s){return norm(s).split(/[^a-z0-9]+/).filter(w=>w.length>2&&!stop.has(w))}
function budget(s){const m=String(s).replace(/\s/g,"").match(/(\d{2,5})(?:€|eur(?:os?)?)?/i);if(!m)return null;const n=+m[1];return n>=20&&n<=50000?n:null}
function priceNum(s){const m=String(s).match(/[\d.]+/);return m?+m[0]:null}
function rank(q,limit=15){
 const ts=terms(q), b=budget(q);
 return catalog.map(p=>{
  const hay=norm([p.id,p.title,p.brand,p.productType,p.description].join(" "));
  let score=ts.reduce((n,t)=>n+(hay.includes(t)?2:0),0);
  if(p.availability==="in stock"&&p.quantity>0)score+=2;
  const pr=priceNum(p.price);
  if(b&&pr){const d=Math.abs(pr-b)/b;score+=d<=.1?5:d<=.25?3:d<=.5?1:-2;if(/moins de|maximum|max|jusqu/i.test(q)&&pr<=b)score+=3}
  return {...p,score};
 }).sort((a,b)=>b.score-a.score).slice(0,limit);
}

const html=`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Assistant XLMusic</title><style>body{font-family:Arial;background:#f4f4f4;margin:0;padding:30px;color:#171717}.w{max-width:820px;margin:auto;background:white;border-radius:16px;padding:24px}h1{margin:0 0 8px}.s{color:#666;margin-bottom:15px}.st{font-size:13px;background:#f3f3f3;padding:9px;border-radius:8px;margin-bottom:12px}#c{height:410px;overflow:auto;border:1px solid #ddd;border-radius:12px;padding:15px;background:#fafafa}.m{margin:10px 0;padding:10px 12px;border-radius:10px;white-space:pre-wrap;line-height:1.4}.me{background:#e9e9e9;margin-left:15%}.ai{background:#f2f7ff;margin-right:8%}.r{display:flex;gap:10px;margin-top:12px}input{flex:1;padding:13px;border:1px solid #bbb;border-radius:10px;font-size:16px}button{padding:13px 18px;border:0;border-radius:10px;background:#111;color:white;font-weight:bold}</style></head><body><div class="w"><h1>Assistant XLMusic</h1><div class="s">V5 — Catalogue Oxatis</div><div id="st" class="st">Chargement…</div><div id="c"><div class="m ai">Bonjour ! Je recherche maintenant dans le catalogue XLMusic exporté par Oxatis.</div></div><form id="f" class="r"><input id="q" maxlength="2000" placeholder="Ex. Une guitare métal en stock autour de 500 €"><button>Envoyer</button></form></div><script>
const f=document.getElementById("f"),q=document.getElementById("q"),c=document.getElementById("c"),st=document.getElementById("st");
function add(t,k){let d=document.createElement("div");d.className="m "+k;d.textContent=t;c.appendChild(d);c.scrollTop=c.scrollHeight}
async function status(){try{let d=await(await fetch("/api/catalog/status")).json();st.textContent="Catalogue Oxatis : "+d.count+" produits • "+(d.error?"erreur : "+d.error:"actualisé "+(d.updatedAt?new Date(d.updatedAt).toLocaleString("fr-FR"):"…"));}catch{}}
status();f.onsubmit=async e=>{e.preventDefault();let m=q.value.trim();if(!m)return;add(m,"me");q.value="";add("Recherche dans le catalogue…","ai");let w=c.lastChild;try{let r=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:m})});let d=await r.json();w.remove();add(d.reply||("Erreur : "+d.error),"ai");status()}catch{w.remove();add("Erreur de connexion.","ai")}};</script></body></html>`;

app.get("/",(_,res)=>res.type("html").send(html));
app.get("/health",(_,res)=>res.json({ok:true,model:MODEL,catalogCount:catalog.length,lastCatalogError}));
app.get("/api/catalog/status",(_,res)=>res.json({count:catalog.length,updatedAt:catalogUpdatedAt,error:lastCatalogError}));
app.post("/api/catalog/refresh",async(_,res)=>{await refreshCatalog();res.json({count:catalog.length,updatedAt:catalogUpdatedAt,error:lastCatalogError})});

app.post("/api/chat",async(req,res)=>{
 try{
  const message=clean(req.body?.message); if(!message)return res.status(400).json({error:"Message manquant."});
  if(!catalog.length)await refreshCatalog(); if(!catalog.length)return res.status(503).json({error:"Catalogue Oxatis indisponible."});
  const picks=rank(message,12);
  const ctx=picks.map((p,i)=>`PRODUIT ${i+1}
Référence: ${p.id}
Nom: ${p.title}
Marque: ${p.brand||"non renseignée"}
Prix: ${p.price||"non renseigné"}
Quantité: ${p.quantity}
Disponibilité: ${p.availability||"non renseignée"}
EAN/GTIN: ${p.gtin||"non renseigné"}
Catégorie: ${p.productType||"non renseignée"}
Description: ${p.description.slice(0,1800)}
URL: ${p.url}
Image: ${p.image}`).join("\n\n");
  const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY});
  const response=await client.responses.create({
   model:MODEL,reasoning:{effort:"low"},max_output_tokens:700,
   instructions:`Tu es l'Assistant XLMusic, conseiller du magasin XLMusic.
Réponds en français, clairement et utilement.
Le contexte contient une sélection issue du flux catalogue Oxatis de XLMusic.
Règles absolues :
- Ne présente comme produit XLMusic que ce qui figure dans le contexte.
- Ne change jamais référence, prix, quantité, disponibilité, EAN ou URL.
- Pour les caractéristiques, utilise uniquement la description fournie.
- Si le contexte ne suffit pas, dis-le clairement au lieu d'inventer.
- Privilégie les produits en stock lorsque le client veut acheter.
- Quand tu recommandes un produit, indique nom, prix, disponibilité et URL.
- N'utilise pas de syntaxe Markdown **.
CATALOGUE :
${ctx}`,
   input:message
  });
  res.json({reply:response.output_text||"Aucune réponse générée."});
 }catch(e){console.error(e);res.status(500).json({error:"Erreur lors de l'appel à OpenAI."})}
});

await refreshCatalog();
setInterval(refreshCatalog,60*60*1000);
app.listen(port,"0.0.0.0",()=>console.log(`Assistant XLMusic V5 démarré sur le port ${port}`));
