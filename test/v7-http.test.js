import assert from "node:assert/strict";
import { once } from "node:events";
import { Script } from "node:vm";
import test from "node:test";
import pg from "pg";

test("la route HTTP relit le catalogue PostgreSQL et partage le diagnostic", async t => {
  const request = "Quelles guitares électriques de marque Ibanez ou Squier avez-vous en stock à moins de 200 € ?";
  const title = "Squier Sonic Stratocaster";
  const educational = "Quelle est la différence de tension ?";
  const maintenance = "Comment dois-je changer mes cordes ?";
  const adviceReplies = new Map([
    [educational, "Une tension faible demande moins d’effort sous les doigts."],
    [maintenance, "Détendez les anciennes cordes avant de les retirer."]
  ]);
  const soundRequest = "Je recherche une enceinte sur batterie avec Bluetooth pour chanter. Mon budget est de 600 €.";
  const outdoors = "En extérieur, et j’ai déjà un micro.";
  const speaker = {
    id: "901", oxId: "901", title: "Enceinte de sonorisation", productType: "Enceintes",
    description: "Fonctionnement sur batterie. Bluetooth. Entrée combo XLR/jack.",
    price: "559 EUR", availability: "in stock", visible: true
  };
  const intent = {
    slots: [{ family: "electric", names: [], brands: ["Ibanez", "Squier"], required: [], evidence: [], excluded: [], preferred: [] }],
    // The server must use the explicit limit even if the interpreter gets it wrong.
    maxCents: 25000, exclusive: false, inStock: true, question: "none",
    mode: "catalog", advice: "", continuity: "new", allowOverBudget: true, outdoor: false, ownsMicrophone: false
  };
  Object.assign(process.env, {
    PORT: "0", CATALOG_SOURCE: "oxatis", DATABASE_URL: "postgres://local.invalid/test",
    OXATIS_APP_ID: "test", OXATIS_TOKEN: "test", OPENAI_API_KEY: "test",
    OPENAI_BASE_URL: "https://api.openai.test/v1"
  });
  let ready = false;
  let published = true;
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  let dbReads = 0;
  let openAIRequests = 0;
  let oxatisReads = 0;
  let includeSpeaker = false;
  t.mock.method(pg.Pool.prototype, "query", async (sql, params) => {
    assert.match(sql, /^\s*SELECT\b/im);
    assert.match(sql, /stage = 'published'/);
    dbReads++;
    if (!ready) throw new Error("offline");
    if (!published) return { rows: [] };
    const products = [{
      oxId: "42636242", id: "037-3150-547", title, productType: "Guitares électriques",
      brand: "Squier", price: "199 EUR", availability: "in stock", visible: true
    }];
    const generation = includeSpeaker ? "9" : "8";
    if (includeSpeaker) products.push(speaker);
    return { rows: [{ id: generation, updated_at: "2026-11-27T09:15:24.934Z",
      products: params[0] === generation ? null : products }] };
  });
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const { hostname } = new URL(url);
    if (hostname === "api.openai.test") {
      openAIRequests++;
      const body = JSON.parse(options.body);
      const isAdvice = body.text?.format.name === "xlmusic_v8_conseil";
      let output = intent;
      if (isAdvice) {
        assert.equal(body.text.format.strict, true);
        const input = JSON.parse(body.input);
        assert.equal(input.options[0].total, input.message === request ? 19900 : 55900);
        output = { option: 0, benefits: [0] };
      } else {
        assert.equal(body.tools[0].name, "search_catalogue_xlmusic");
        assert.equal(body.tools[0].strict, true);
        assert.equal(body.parallel_tool_calls, false);
        const message = JSON.parse(body.input.at(-1).content).dernierMessage;
        if (adviceReplies.has(message)) {
          assert.match(body.input[0].content, /Savarez/);
          return Response.json({ object:"response", status:"completed", output:[{ type:"message", content:[
            { type:"output_text", text:adviceReplies.get(message) }
          ] }] });
        }
        if (message === outdoors || message === soundRequest) {
          if (message === outdoors) {
            const anchor = JSON.parse(body.input[0].content);
            assert.equal(anchor.message, soundRequest);
            assert.match(anchor.question, /intérieur/);
            assert.deepEqual(anchor.products, [speaker.title]);
          }
          output = { ...intent, slots:[{family:"pa", names:[], brands:[], required:["battery","bluetooth","microphone"],
            evidence:[], excluded:[], preferred:[]}], maxCents:null, inStock:false,
            continuity:message === outdoors ? "followup" : "new", question:"venue" };
        }
        return Response.json({ object:"response", status:"completed", output:[
          { type:"function_call", name:"search_catalogue_xlmusic", call_id:"call_test", arguments:JSON.stringify(output) }
        ] });
      }
      return Response.json({ object:"response", status:"completed", output:[{ type:"message", content:[
        { type:"output_text", text:JSON.stringify(output) }
      ] }] });
    }
    if (hostname === "webservices.oxatis.com") {
      oxatisReads++;
      assert.equal(options.body.get("Method"), "ProductGet");
      if (options.body.get("Data").includes("<OxID>901</OxID>")) {
        return new Response(`<DataResultService><StatusCode>200</StatusCode><Data>
          <Product><OxID>901</OxID><ItemSKU>901</ItemSKU><Name>${speaker.title}</Name>
          <Category2><Name>Enceintes</Name></Category2><LongDescription>${speaker.description}</LongDescription>
          <Price><Value>559</Value><VATIncluded>true</VATIncluded></Price>
          <Visible>true</Visible><QuantityInStock><Value>1</Value></QuantityInStock></Product>
          </Data></DataResultService>`);
      }
      return new Response(`<DataResultService><StatusCode>200</StatusCode><Data>
        <Product><OxID>42636242</OxID><ItemSKU>037-3150-547</ItemSKU><Name>${title}</Name>
        <Brand><Name>Squier</Name></Brand><Category1><Name>Guitares électriques</Name></Category1>
        <Price><Value>199</Value><VATIncluded>true</VATIncluded></Price>
        <Visible>true</Visible><QuantityInStock><Value>1</Value></QuantityInStock></Product>
        </Data></DataResultService>`);
    }
    assert.equal(hostname, "www.xlmusic.fr");
    const sku = new URL(url).searchParams.get("ItmID") === "901" ? "901" : "037-3150-547";
    return Response.json({ "@type": "Product", sku });
  });
  const { request: httpRequest } = await import("node:http");
  const { server } = await import("../server.js");
  await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  function http(path, payload) {
    return new Promise((resolve, reject) => {
      const req = httpRequest(url + path, payload ? {
        method: "POST", headers: { "content-type": "application/json" }
      } : {}, res => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", chunk => { text += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, text }));
      });
      req.on("error", reject);
      req.end(payload ? JSON.stringify(payload) : undefined);
    });
  }
  assert.equal((await http("/health")).status, 503);
  assert.equal((await http("/api/admin/oxatis/import/start", {})).status, 404);
  assert.equal((await http("/api/chat", { message: request })).status, 503);
  ready = true;
  const health = await http("/health");
  const status = await http("/api/catalog/status");
  assert.equal(health.status, 200);
  assert.equal(JSON.parse(health.text).catalogCount, JSON.parse(status.text).count);
  assert.equal(JSON.parse(health.text).catalogSource, "oxatis");
  assert.equal(JSON.parse(health.text).version, "V9");
  const page = await http("/");
  assert.doesNotThrow(() => new Script(page.text.match(/<script>([\s\S]+)<\/script>/)[1]));
  const chat = await http("/api/chat", { message: request, history: ["Je débute, proposez-moi le meilleur ensemble guitare et ampli pour 400 €." ] });
  assert.equal(chat.status, 200);
  assert.equal(JSON.parse(chat.text).contextMode, "new");
  assert.equal(JSON.parse(chat.text).products.length, 1);
  assert.match(JSON.parse(chat.text).reply, /Voir|https:\/\/www\.xlmusic\.fr/);
  const beforeExact = openAIRequests;
  const bySku = await http("/api/chat", { message: "037-3150-547" });
  assert.equal(bySku.status, 200);
  assert.equal(JSON.parse(bySku.text).products[0].title, title);
  const byName = await http("/api/chat", { message: `Avez-vous le ${title} en stock et à quel prix ?` });
  assert.equal(byName.status, 200);
  assert.equal(JSON.parse(byName.text).products[0].sku, "037-3150-547");
  assert.equal(openAIRequests, beforeExact + 2);
  ready = false;
  const degradedHealth = await http("/health");
  const degradedStatus = JSON.parse((await http("/api/catalog/status")).text);
  assert.equal(degradedHealth.status, 200);
  assert.equal(JSON.parse(degradedHealth.text).catalogCount, 1);
  assert.equal(degradedStatus.count, 1);
  assert.equal(degradedStatus.updatedAt, "2026-11-27T09:15:24.934Z");
  assert.equal(JSON.parse(degradedHealth.text).lastCatalogError, degradedStatus.error);
  assert.ok(degradedStatus.error);
  assert.equal((await http("/api/chat", { message: request })).status, 200);
  now += 5 * 60_000;
  assert.equal((await http("/health")).status, 503);
  assert.equal(JSON.parse((await http("/api/catalog/status")).text).count, 0);
  assert.equal((await http("/api/chat", { message: request })).status, 503);
  ready = true;
  assert.equal((await http("/health")).status, 200);
  assert.equal(JSON.parse((await http("/api/catalog/status")).text).error, null);
  const stringMemory = { items:["SAV"], budget:2500, pending:null, topic:"strings", facts:{strings:"nylon"} };
  const stringHistory = [{ message:"Des cordes pour une classique", answer:"Je conseille un jeu Savarez.", products:["Savarez"] }];
  const beforeAdvice = [dbReads, oxatisReads];
  for (const [message, reply] of adviceReplies) {
    const response = await http("/api/chat", { message, history:stringHistory, conversation:stringMemory });
    assert.equal(response.status, 200);
    const data = JSON.parse(response.text);
    assert.equal(data.reply, reply);
    assert.deepEqual(data.products, []);
    assert.equal(data.conversation.budget, 2500);
    assert.equal(data.conversation.facts.strings, "nylon");
    stringHistory.push({ message, answer:data.reply, products:[] });
  }
  assert.deepEqual([dbReads, oxatisReads], beforeAdvice);
  includeSpeaker = true;
  const sound = await http("/api/chat", { message: soundRequest });
  assert.equal(sound.status, 200);
  const first = JSON.parse(sound.text);
  assert.equal(first.contextMode, "new");
  assert.equal(first.products[0].title, speaker.title);
  const continuation = await http("/api/chat", { message: outdoors, history: [{
    message: soundRequest, question: first.followUp, products: first.products.map(item => item.title)
  }] });
  assert.equal(continuation.status, 200);
  const followup = JSON.parse(continuation.text);
  assert.equal(followup.contextMode, "followup");
  assert.equal(followup.products[0].title, speaker.title);
  assert.match(followup.reply, /En extérieur/);
  assert.match(followup.reply, /connecteur/);
  published = false;
  assert.equal((await http("/health")).status, 503);
  assert.equal(JSON.parse((await http("/api/catalog/status")).text).count, 0);
  assert.equal((await http("/api/chat", { message: request })).status, 503);
  assert.ok(dbReads >= 3);
});
