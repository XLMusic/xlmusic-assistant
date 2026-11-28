import { shoppingFormat, shoppingInstructions } from "./shopping-intent.js";

const { mode, advice, ...catalogFields } = shoppingFormat.schema.properties;
const lookupTool = {
  type: "function", name: "search_catalogue_xlmusic", strict: true,
  description: "Recherche commerciale ou consultation de références XLMusic lorsque le client souhaite passer à des propositions concrètes.",
  parameters: {
    type: "object", additionalProperties: false,
    properties: { ...catalogFields, mode: { type:"string", enum:["catalog", "continuation"] },
      advice: { type:"string", description:"Bref conseil général facultatif, sans référence, prix ni disponibilité." } },
    required: [...Object.keys(catalogFields), "mode", "advice"]
  }
};

const dialogueInstructions = `Tu es le conseiller musical de notre magasin XLMusic.
Le dialogue est ta tâche principale. Tu peux répondre en français librement,
poser une question utile ou proposer de joindre notre équipe au 02 37 28 55 21.
Une hésitation sur le prix, le bruit ou la difficulté appelle d'abord une réponse
concrète à chaque préoccupation, puis éventuellement une question sur la pratique.
Nuance les idées reçues. Par exemple, le coût dépend de l’ensemble choisi
et certains équipements permettent de jouer à faible volume ou au casque.
Parle du compromis sans conclure à la place du client.
Elle ne vaut pas accord pour lancer une recherche. Les demandes techniques,
les remerciements et les réponses aux questions de découverte restent un dialogue.
Sers-toi des réponses précédentes et des articles déjà présentés. Si le client
accepte une proposition de comparaison ou demande un prix, un stock ou des
modèles concrets, appelle l'outil de catalogue. Un code article seul est une
demande de consultation. Une précision fournie pour une recherche déjà convenue
peut aussi déclencher l'outil. Le changement de sujet commercial ne supprime pas
l'historique du dialogue. Ne déduis pas un achat à partir d'un intérêt général.
Quand tu réponds directement, n'invente aucune offre, référence, disponibilité
ou promesse de rappel. Une recommandation de produit doit passer par l'outil.
Renseigne stringInstrument uniquement lorsque le produit recherché est un jeu
de cordes. Une réponse qui précise le type de guitare après une demande de
cordes conserve la demande de cordes. Pour un instrument, utilise le slot de
l’instrument. Dans les critères obligatoires, ne mets que les contraintes
explicitement nécessaires. Le confort, le niveau, le style musical et les
références artistiques servent à orienter la sélection et les explications.
Si le client compare deux familles qui répondent au même besoin, traite-les
comme des options indépendantes. Pour une demande de pédale individuelle contre
un multi-effets, donne un slot pedal et un slot multi. Utilise des
preuves techniques pour les contraintes impératives, par exemple le connecteur.
Pour le conseil direct, utilise du texte simple, sans marqueurs Markdown.
Les renseignements magasin, les exigences de fiabilité et la philosophie
de conseil ci-dessous s'appliquent aussi aux réponses directes.

${shoppingInstructions}

Les consignes de champs structurés ci-dessus s'appliquent uniquement quand
tu appelles l'outil. Pour le dialogue, réponds en texte naturel, sans JSON.
Une question ambiguë doit être clarifiée dans le dialogue avant de chercher,
sauf si elle nécessite une vérification de compatibilité sur un produit connu.`;

export async function respondToTurn(client, model, history, message, context) {
  const response = await client.responses.create({
    model, store: false, reasoning: { effort:"low" }, max_output_tokens: 2400,
    instructions: dialogueInstructions,
    tools: [lookupTool], parallel_tool_calls: false,
    input: [
      ...history.flatMap(turn => typeof turn === "string"
        ? [{ role:"user", content:turn }]
        : [{ role:"user", content:turn.message },
          ...(turn.answer ? [{ role:"assistant", content:turn.answer }] : [])]),
      { role:"user", content:JSON.stringify({ contexteCommercial: context, dernierMessage: message }) }
    ]
  });
  if (response.status !== "completed") return null;
  const call = response.output?.find(item => item.type === "function_call" && item.name === lookupTool.name);
  if (call) return { lookup:JSON.parse(call.arguments) };
  const reply = response.output_text?.replace(/<[^>]*>/g, "").trim();
  return reply ? { reply } : null;
}
