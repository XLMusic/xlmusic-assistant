import { createHash, timingSafeEqual } from "node:crypto";
import { OxatisError, validateWindow } from "./oxatis.js";

const hash = value => createHash("sha256").update(value).digest();

export function protectCatalogAdmin(req, res, next) {
  res.set("Cache-Control", "no-store");
  const secret = process.env.CATALOG_ADMIN_TOKEN;
  if (!secret || secret.length < 32) return res.status(503).json({ error: "admin_disabled" });
  const header = req.get("authorization") || "";
  if (!timingSafeEqual(hash(header), hash(`Bearer ${secret}`))) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

export function configureCatalogAdmin(app, oxatis, store) {
  let probing = false;
  const route = (method, path, handle) => app[method](
    "/api/admin/oxatis/" + path, protectCatalogAdmin, async (req, res) => {
      try {
        res.json(await handle(req));
      } catch (error) {
        if (error instanceof OxatisError) {
          const status = error.code.startsWith("invalid_") ? 400 :
            error.code === "database_required" || error.code === "oxatis_configuration" ? 503 :
            error.code.startsWith("oxatis_") ? 502 : 409;
          res.status(status).json({ error: error.code, upstreamStatus: error.status });
        } else {
          console.error("Erreur PostgreSQL de gestion du catalogue.");
          res.status(503).json({ error: "catalog_database" });
        }
      }
    });

  const windowFor = req => validateWindow(req.body?.start, req.body?.end);
  route("post", "probe", async req => {
    const window = windowFor(req);
    if (probing) throw new OxatisError("probe_busy");
    probing = true;
    try {
      return { ok: true, ...await oxatis.probe(window) };
    } finally {
      probing = false;
    }
  });

  function database() {
    if (!store) throw new OxatisError("database_required");
    return store;
  }

  route("post", "import/start", req => {
    const expected = req.body?.expectedVisibleCount;
    if (!Number.isSafeInteger(expected) || expected < 1) throw new OxatisError("invalid_expected_count");
    return database().start(windowFor(req), expected);
  });
  route("get", "import/status", () => database().status());
  route("post", "import/step", () => database().step());
  route("post", "import/cancel", () => database().cancel());
}
