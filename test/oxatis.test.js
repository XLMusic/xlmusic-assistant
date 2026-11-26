import assert from "node:assert/strict";
import test from "node:test";
import { createOxatis, normalizeProduct, validateWindow } from "../oxatis.js";

const window = { start: "2000-01-02T00:00:00", end: "2026-11-27T00:00:00" };
const envelope = data => `<DataResultService><StatusCode>200</StatusCode><Data>${data}</Data></DataResultService>`;
const sample = "<Product><OxID>7524948</OxID><ItemSKU>TR-2</ItemSKU><Name>Trémolo</Name>" +
  "<Price><Value>98.33</Value><VATIncluded>false</VATIncluded></Price><TaxRate>20</TaxRate>" +
  "<Visible>true</Visible><QuantityInStock><Value>1</Value></QuantityInStock></Product>";

test("probe posts three read-only methods and returns only diagnostic fields", async () => {
  const calls = [];
  const api = createOxatis({ appId: "fake-app", token: "fake-token", fetchImpl: async (url, options) => {
    assert.equal(new URL(url).search, "");
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error");
    assert.equal(options.body.get("AppId"), "fake-app");
    assert.equal(options.body.get("Token"), "fake-token");
    const method = options.body.get("Method");
    calls.push(method);
    if (method === "ProductCount") return new Response(envelope("<Count>6973</Count>"));
    if (method === "ProductGetList") {
      assert.match(options.body.get("Data"), /<PageSize>100<\/PageSize>/);
      assert.match(options.body.get("Data"), /<LatestModifiedDateEnd>2026-11-27T00:00:00/);
      return new Response(envelope("<ProductList><PageInformation><PageNumber>1</PageNumber><TotalItems>1</TotalItems><TotalPages>1</TotalPages></PageInformation><ProductsID><ProductID><OxID>7524948</OxID></ProductID></ProductsID></ProductList>"));
    }
    return new Response(envelope(sample));
  } });
  assert.deepEqual(await api.probe(window), {
    visibleCount: 1, pages: 1, pageSize: 100,
    sample: { visible: true, priceTtcAvailable: true, stockAvailable: true, referencePriceAvailable: false, discountRulePresent: false }
  });
  assert.deepEqual(calls, ["ProductCount", "ProductGetList", "ProductGet"]);
});

test("page 67 has 42 of 6642 visible products and rejects an inconsistent page", async () => {
  const list = count => envelope(`<ProductList><PageInformation><PageNumber>67</PageNumber><TotalItems>6642</TotalItems><TotalPages>67</TotalPages></PageInformation><ProductsID>${Array.from({length: count}, (_, i) => `<ProductID><OxID>${6601 + i}</OxID></ProductID>`).join("")}</ProductsID></ProductList>`);
  let response = list(42);
  const api = createOxatis({ appId: "x", token: "y", fetchImpl: async () => new Response(response) });
  assert.equal((await api.list(window, 67)).ids.at(-1), "6642");
  response = list(41);
  await assert.rejects(api.list(window, 67), { code: "oxatis_pagination" });
});

test("rejects impossible dates, and sanitizes Oxatis errors", async () => {
  assert.throws(() => validateWindow("2026-02-30T00:00:00", window.end), { code: "invalid_date_window" });
  const api = createOxatis({ appId: "x", token: "y", fetchImpl: async () =>
    new Response("<DataResultService><StatusCode>504</StatusCode><ErrorDetails>SECRET</ErrorDetails></DataResultService>") });
  await assert.rejects(api.probe(window), { message: "oxatis_result", status: 504 });
});

test("separates TTC, reference price, conditional discounts, and stock visibility", () => {
  const row = {
    Visible: "true", QuantityInStock: { Value: "1" }, TaxRate: "20",
    Price: { Value: "98.33", VATIncluded: "false" },
    StrikethroughPrice: { Value: "149", VATIncluded: "true" },
    DiscountRuleId: { OxID: "12" }
  };
  assert.equal(normalizeProduct(row).price, "118.00 EUR");
  assert.equal(normalizeProduct(row).referencePrice, "149.00 EUR");
  assert.equal(normalizeProduct(row).discountRulePresent, true);
  assert.equal(normalizeProduct({ ...row, Visible: "false" }).visible, false);
  const unavailable = normalizeProduct({ ...row, QuantityInStock: { Value: "0" }, SaleIfOutOfStock: "true" });
  assert.equal(unavailable.visible, false);
  assert.equal(unavailable.availability, "sur commande, délai à confirmer");
  assert.equal(normalizeProduct({ ...row, QuantityInStock: {} }).quantity, null);
  assert.equal(normalizeProduct({ ...row, TaxRate: "" }).price, "");
});
