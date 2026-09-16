import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: "20kb" }));
app.use(cors());

const page = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Assistant XLMusic — Test</title>
<style>
body{font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:30px;color:#171717}
.wrap{max-width:760px;margin:auto;background:#fff;border-radius:16px;padding:24px;box-shadow:0 8px 30px #0001}
h1{margin-top:0}.sub{color:#666;margin-bottom:20px}
#chat{height:360px;overflow:auto;border:1px solid #ddd;border-radius:12px;padding:15px;background:#fafafa}
.msg{margin:10px 0;padding:10px 12px;border-radius:10px;white-space:pre-wrap}
.me{background:#e9e9e9;margin-left:15%}.ai{background:#f2f7ff;margin-right:15%}
.row{display:flex;gap:10px;margin-top:12px}
input{flex:1;padding:13px;border:1px solid #bbb;border-radius:10px;font-size:16px}
button{padding:13px 18px;border:0;border-radius:10px;background:#111;color:#fff;font-weight:bold;cursor:pointer}
small{display:block;color:#777;margin-top:12px}
</style>
</head>
<body>
<div class="wrap">
<h1>Assistant XLMusic</h1>
<div class="sub">Interface de test — GPT-5.6 Luna</div>
<div id="chat"><div class="msg ai">Bonjour ! Je suis l’Assistant XLMusic. Posez-moi une question pour tester la connexion.</div></div>
<form id="form" class="row">
<input id="q" maxlength="2000" placeholder="Ex. Je cherche une guitare pour jouer du métal..." autocomplete="off">
<button>Envoyer</button>
</form>
<small>Version de test : le catalogue XLMusic n’est pas encore connecté.</small>
</div>
<script>
const form=document.getElementById("form"), q=document.getElementById("q"), chat=document.getElementById("chat");
function add(text,cls){const d=document.createElement("div");d.className="msg "+cls;d.textContent=text;chat.appendChild(d);chat.scrollTop=chat.scrollHeight}
form.addEventListener("submit",async(e)=>{
 e.preventDefault(); const message=q.value.trim(); if(!message)return;
 add(message,"me"); q.value=""; add("Réflexion en cours…","ai"); const wait=chat.lastChild;
 try{
  const r=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message})});
  const data=await r.json(); wait.remove();
  add(data.reply || ("Erreur : "+(data.error||"réponse inconnue")),"ai");
 }catch(err){wait.remove();add("Erreur de connexion au serveur.","ai")}
});
</script>
</body></html>`;

app.get("/", (req, res) => res.type("html").send(page));
app.get("/health", (req, res) => res.json({ ok: true, service: "Assistant XLMusic", model: process.env.OPENAI_MODEL || "gpt-5.6-luna" }));

app.post("/api/chat", async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "OPENAI_API_KEY non configurée." });
    const message = String(req.body?.message || "").trim();
    if (!message) return res.status(400).json({ error: "Message manquant." });
    if (message.length > 2000) return res.status(400).json({ error: "Message trop long." });

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
      reasoning: { effort: "low" },
      instructions: `Tu es l'Assistant XLMusic, conseiller d'un magasin français d'instruments de musique, sono et éclairage.
Réponds en français, clairement et brièvement.
Cette version sert à tester la connexion à l'IA.
N'invente jamais un prix, un stock, une référence produit ou une caractéristique XLMusic.
Si la question exige le catalogue XLMusic, indique que la connexion au catalogue sera ajoutée à l'étape suivante.`,
      input: message,
      max_output_tokens: 500
    });
    res.json({ reply: response.output_text || "Je n'ai pas pu produire de réponse." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erreur lors de l'appel à OpenAI." });
  }
});

app.listen(port, "0.0.0.0", () => console.log(`Assistant XLMusic démarré sur le port ${port}`));
