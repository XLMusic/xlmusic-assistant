import assert from "node:assert/strict";
import { once } from "node:events";
import { Script } from "node:vm";
import test from "node:test";
import pg from "pg";

test("la route HTTP relit le catalogue PostgreSQL et partage le diagnostic", async t => {
  const request = "Quelles guitares électriques de marque Ibanez ou Squier avez-vous en stock à moins de 200 € ?";
  const title = "Squier Sonic Stratocaster";
  const intent = {
    slots: [{ family: "electric", names: [], brands: ["Ibanez", "Squier"], required: [], evidence: [], excluded: [], preferred: [] }],
    // The server must use the explicit limit even if the interpreter gets it wrong.
    maxCents: 25000, exclusive: false, inStock: true, question: "none"
  };
  Object.assign(process.env, {
    PORT: "0", CATALOG_SOURCE: "oxatis", DATABASE_URL: "postgres://local.invalid/test",
    OXATIS_APP_ID: "test", OXATIS_TOKEN: "test", OPENAI_API_KEY: "test",
    OPENAI_BASE_URL: "https://api.openai.test/v1"
  });
  let ready = true;
  let dbReads = 0;
  t.mock.method(pg.Pool.prototype, "query", async (sql, params) => {
    assert.match(sql, /^\s*SELECT\b/im);
    assert.match(sql, /stage = 'published'/);
    dbReads++;
    if (!ready) throw new Error("offline");
    const products = [{
      oxId: "42636242", id: "037-3150-547", title, productType: "Guitares électriques",
      brand: "Squier", price: "199 EUR", availability: "in stock", visible: true
    }];
    return { rows: [{ id: "8", updated_at: "2026-11-27T09:15:24.934Z", products: params[0] ? null : products }] };
  });
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const { hostname } = new URL(url);
    if (hostname === "api.openai.test") {
      const body = JSON.parse(options.body);
      assert.equal(body.input.at(-1).content, request);
      assert.equal(body.text.format.strict, true);
      return Response.json({ object: "response", status: "completed", output: [{ type: "message", content: [
        { type: "output_text", text: JSON.stringify(intent) }
      ] }] });
    }
    if (hostname === "webservices.oxatis.com") {
      assert.equal(options.body.get("Method"), "ProductGet");
      return new Response(`<DataResultService><StatusCode>200</StatusCode><Data>
        <Product><OxID>42636242</OxID><ItemSKU>037-3150-547</ItemSKU><Name>${title}</Name>
        <Brand><Name>Squier</Name></Brand><Category1><Name>Guitares électriques</Name></Category1>
        <Price><Value>199</Value><VATIncluded>true</VATIncluded></Price>
        <Visible>true</Visible><QuantityInStock><Value>1</Value></QuantityInStock></Product>
        </Data></DataResultService>`);
    }
    assert.equal(hostname, "www.xlmusic.fr");
    return new Response('{"@type":"Product","sku":"037-3150-547"}');
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
  const health = await http("/health");
  const status = await http("/api/catalog/status");
  assert.equal(health.status, 200);
  assert.equal(JSON.parse(health.text).catalogCount, JSON.parse(status.text).count);
  assert.equal(JSON.parse(health.text).catalogSource, "oxatis");
  const page = await http("/");
  assert.doesNotThrow(() => new Script(page.text.match(/<script>([\s\S]+)<\/script>/)[1]));
  const chat = await http("/api/chat", { message: request, history: ["Je cherche une guitare."] });
  assert.equal(chat.status, 200);
  assert.match(JSON.parse(chat.text).reply, /Voir|https:\/\/www\.xlmusic\.fr/);
  ready = false;
  assert.equal((await http("/health")).status, 503);
  assert.equal(JSON.parse((await http("/api/catalog/status")).text).count, 0);
  assert.ok(dbReads >= 3);
});
