import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: "20kb" }));

// Pendant les tests, on autorise les appels. Avant mise en production,
// nous limiterons CORS aux domaines XLMusic/Oxatis.
app.use(cors());

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "Assistant XLMusic",
    model: process.env.OPENAI_MODEL || "gpt-5.6-luna"
  });
});

app.get("/health", (req, res) => res.json({ ok: true }));

app.post("/api/chat", async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY non configurée sur le serveur." });
    }

    const message = String(req.body?.message || "").trim();
    if (!message) {
      return res.status(400).json({ error: "Message manquant." });
    }
    if (message.length > 2000) {
      return res.status(400).json({ error: "Message trop long." });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
      reasoning: { effort: "low" },
      instructions: `Tu es l'Assistant XLMusic, conseiller d'un magasin français d'instruments de musique, sono et éclairage.
Réponds en français, clairement et brièvement.
Cette première version sert à tester la connexion à l'IA.
N'invente jamais un prix, un stock, une référence produit ou une caractéristique XLMusic.
Si une question exige le catalogue XLMusic, explique que la connexion au catalogue sera ajoutée à l'étape suivante.`,
      input: message,
      max_output_tokens: 500
    });

    res.json({ reply: response.output_text || "Je n'ai pas pu produire de réponse." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erreur lors de l'appel à OpenAI." });
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Assistant XLMusic démarré sur le port ${port}`);
});
