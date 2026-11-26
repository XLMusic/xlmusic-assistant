import { XMLParser, XMLValidator } from "fast-xml-parser";

const endpoint = "https://webservices.oxatis.com/webservices/httpservices/ProductServices.aspx";
const namespaces = 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"';
const methods = new Set(["ProductCount", "ProductGetList", "ProductGet"]);
const parser = new XMLParser({ parseTagValue: false, removeNSPrefix: true });
export const pageSize = 100;

export class OxatisError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const entries = value => Array.isArray(value) ? value : value == null || value === "" ? [] : [value];
const positiveId = value => typeof value === "string" && /^[1-9]\d{0,14}$/.test(value);
const bool = value => ["true", "1"].includes(value);
const number = value => typeof value === "string" && /^-?\d+(?:[.,]\d+)?$/.test(value)
  ? Number(value.replace(",", ".")) : null;
const integer = value => {
  const n = number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};

export function validateWindow(start, end) {
  const valid = value => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/.test(value) &&
    Number.isFinite(Date.parse(value + "Z")) && new Date(value + "Z").toISOString().slice(0, 19) === value;
  if (!valid(start) || !valid(end) || start < "2000-01-01T00:00:00" || start >= end) {
    throw new OxatisError("invalid_date_window");
  }
  return { start, end };
}

export function createOxatis({ appId, token, fetchImpl = fetch }) {
  async function call(method, data = "") {
    if (!methods.has(method) || !appId || !token) throw new OxatisError("oxatis_configuration");
    let xml;
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        redirect: "error",
        body: new URLSearchParams({ AppId: appId, Token: token, Method: method, Data: data }),
        signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) throw new OxatisError("oxatis_http", response.status);
      xml = await response.text();
    } catch (error) {
      if (error instanceof OxatisError) throw error;
      throw new OxatisError("oxatis_network");
    }

    if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml) || XMLValidator.validate(xml) !== true) {
      throw new OxatisError("oxatis_xml");
    }
    const result = parser.parse(xml).DataResultService;
    if (result?.StatusCode === "500" && result.StatusSubCode === "1001" && method === "ProductGet") {
      return null;
    }
    if (result?.StatusCode !== "200" || result.Data == null) {
      throw new OxatisError("oxatis_result", integer(result?.StatusCode) ?? undefined);
    }
    return result.Data;
  }

  async function list(window, page) {
    const { start, end } = validateWindow(window.start, window.end);
    if (!Number.isSafeInteger(page) || page < 1) throw new OxatisError("invalid_page");
    const data = await call("ProductGetList",
      `<ProductList ${namespaces}><PageInformation><PageNumber>${page}</PageNumber><PageSize>${pageSize}</PageSize></PageInformation><LatestModifiedDateStart>${start}</LatestModifiedDateStart><LatestModifiedDateEnd>${end}</LatestModifiedDateEnd><Visible>true</Visible><Category1><OxID>0</OxID></Category1><Category2><OxID>0</OxID></Category2><Category3><OxID>0</OxID></Category3><ProductsID /></ProductList>`);
    const list = data.ProductList;
    const info = list?.PageInformation;
    const total = integer(info?.TotalItems);
    const pages = integer(info?.TotalPages);
    const ids = entries(list?.ProductsID?.ProductID).map(row => row?.OxID);
    if (total === null || pages !== Math.ceil(total / pageSize) ||
      (info.PageNumber != null && integer(info.PageNumber) !== page) ||
      ids.length !== Math.max(0, Math.min(pageSize, total - (page - 1) * pageSize)) ||
      !ids.every(positiveId) || new Set(ids).size !== ids.length) {
      throw new OxatisError("oxatis_pagination");
    }
    return { total, pages, ids };
  }

  async function product(id) {
    if (!positiveId(id)) throw new OxatisError("invalid_product_id");
    const data = await call("ProductGet", `<Product ${namespaces}><OxID>${id}</OxID><ItemSKU /></Product>`);
    if (data === null) return null;
    if (data.Product?.OxID !== id || !["true", "1", "false", "0"].includes(data.Product.Visible)) {
      throw new OxatisError("oxatis_product");
    }
    return normalizeProduct(data.Product);
  }

  async function probe(window) {
    await call("ProductCount");
    const first = await list(window, 1);
    if (!first.ids.length) throw new OxatisError("oxatis_empty_probe");
    const sample = await product(first.ids[0]);
    if (!sample?.published) throw new OxatisError("oxatis_missing_probe");
    return {
      visibleCount: first.total, pages: first.pages, pageSize,
      sample: {
        visible: sample.visible,
        priceTtcAvailable: Boolean(sample.price),
        stockAvailable: sample.quantity !== null,
        referencePriceAvailable: Boolean(sample.referencePrice),
        discountRulePresent: sample.discountRulePresent
      }
    };
  }

  return { list, product, probe };
}

function clean(value, limit = 200) {
  return typeof value === "string" ? value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, limit) : "";
}

function priceTtc(price, rate) {
  const amount = number(price?.Value);
  const tax = number(rate);
  if (amount === null || amount < 0) return null;
  if (bool(price.VATIncluded)) return Math.round((amount + Number.EPSILON) * 100) / 100;
  if (!["false", "0"].includes(price.VATIncluded) || tax === null || tax < 0) return null;
  return Math.round(amount * (100 + tax) + Number.EPSILON) / 100;
}

export function normalizeProduct(row) {
  const price = priceTtc(row.Price, row.TaxRate);
  const reference = priceTtc(row.StrikethroughPrice, row.TaxRate);
  const stock = number(row.QuantityInStock?.Value);
  const quantity = Number.isSafeInteger(stock) ? Math.max(0, stock) : null;
  const available = quantity === null ? "" : quantity > 0 ? "in stock" :
    bool(row.SaleIfOutOfStock) ? "sur commande, délai à confirmer" : "out of stock";
  const discountRulePresent = positiveId(row.DiscountRuleId?.OxID) || Boolean(clean(row.DiscountGridCode));
  const format = amount => `${amount.toFixed(2)} EUR`;
  return {
    oxId: row.OxID,
    id: clean(row.ItemSKU) || row.OxID,
    title: clean(row.Name),
    published: bool(row.Visible),
    visible: bool(row.Visible) && (quantity > 0 || bool(row.ShowIfOutOfStock)),
    brand: clean(row.Brand?.Name),
    description: clean(row.LongDescription || row.Description, 1800),
    productType: clean(row.Category1?.Name),
    gtin: clean(row.EANCode),
    price: price === null ? "" : format(price),
    referencePrice: price !== null && reference > price ? format(reference) : "",
    discountRulePresent,
    showStockLevel: bool(row.ShowStockLevel),
    quantity,
    availability: available
  };
}
