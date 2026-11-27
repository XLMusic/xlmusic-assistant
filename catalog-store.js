import pg from "pg";
import { OxatisError } from "./oxatis.js";

const schema = `
CREATE TABLE IF NOT EXISTS xl_catalog_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stage text NOT NULL DEFAULT 'listing',
  date_start text NOT NULL,
  date_end text NOT NULL,
  next_page integer NOT NULL DEFAULT 1,
  expected integer NOT NULL,
  pages integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS xl_catalog_products (
  run_id bigint NOT NULL REFERENCES xl_catalog_runs(id) ON DELETE CASCADE,
  ox_id bigint NOT NULL,
  checked boolean NOT NULL DEFAULT false,
  product jsonb,
  PRIMARY KEY (run_id, ox_id)
);
CREATE INDEX IF NOT EXISTS xl_catalog_pending
  ON xl_catalog_products(run_id, ox_id) WHERE NOT checked;
`;

export function createCatalogStore(connectionString, oxatis, pool = new pg.Pool({
  connectionString,
  max: 4,
  connectionTimeoutMillis: 4000,
  statement_timeout: 8000
})) {
  let cache;
  pool.on("error", () => console.error("Connexion PostgreSQL interrompue."));

  async function transaction(work) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const lock = await client.query("SELECT pg_try_advisory_xact_lock(514823, 6) AS acquired");
      if (!lock.rows[0].acquired) throw new OxatisError("import_busy");
      await client.query(schema);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function pending(client) {
    const { rows } = await client.query(
      "SELECT * FROM xl_catalog_runs WHERE stage IN ('listing','details') ORDER BY id DESC LIMIT 1");
    return rows[0];
  }

  async function summarize(client, id) {
    const { rows } = await client.query(`
      SELECT r.*, count(p.ox_id)::int AS listed,
        (count(*) FILTER (WHERE p.checked))::int AS checked,
        count(p.product)::int AS usable
      FROM xl_catalog_runs r LEFT JOIN xl_catalog_products p ON p.run_id = r.id
      WHERE r.id = $1 GROUP BY r.id`, [id]);
    return rows[0];
  }

  const start = (window, expectedVisibleCount) => transaction(async client => {
    if (await pending(client)) throw new OxatisError("import_in_progress");
    const probe = await oxatis.probe(window);
    if (probe.visibleCount !== expectedVisibleCount) throw new OxatisError("catalog_changed");
    const { rows } = await client.query(
      "INSERT INTO xl_catalog_runs(date_start,date_end,expected,pages) VALUES($1,$2,$3,$4) RETURNING id",
      [window.start, window.end, probe.visibleCount, probe.pages]);
    return summarize(client, rows[0].id);
  });

  const status = () => transaction(async client => {
    const { rows } = await client.query("SELECT id FROM xl_catalog_runs ORDER BY id DESC LIMIT 1");
    return rows[0] ? summarize(client, rows[0].id) : null;
  });

  const cancel = () => transaction(async client => {
    const run = await pending(client);
    if (!run) throw new OxatisError("no_pending_import");
    await client.query("DELETE FROM xl_catalog_runs WHERE id = $1", [run.id]);
    return { cancelled: true };
  });

  const step = () => transaction(async client => {
    const run = await pending(client);
    if (!run) throw new OxatisError("no_pending_import");
    if (run.stage === "listing") {
      const page = await oxatis.list({ start: run.date_start, end: run.date_end }, run.next_page);
      if (page.total !== run.expected || page.pages !== run.pages) throw new OxatisError("catalog_changed");
      const inserted = await client.query(`
        INSERT INTO xl_catalog_products(run_id,ox_id)
        SELECT $1, unnest($2::bigint[]) ON CONFLICT DO NOTHING`, [run.id, page.ids]);
      if (inserted.rowCount !== page.ids.length) throw new OxatisError("catalog_changed");
      await client.query(`
        UPDATE xl_catalog_runs SET next_page = next_page + 1, updated_at = now(),
          stage = CASE WHEN next_page = pages THEN 'details' ELSE stage END WHERE id = $1`, [run.id]);
    } else {
      const { rows } = await client.query(`
        SELECT ox_id::text AS ox_id FROM xl_catalog_products WHERE run_id = $1 AND NOT checked ORDER BY ox_id LIMIT 4`,
        [run.id]);
      for (const { ox_id } of rows) {
        const product = await oxatis.product(ox_id);
        await client.query(`
          UPDATE xl_catalog_products SET checked = true, product = $3 WHERE run_id = $1 AND ox_id = $2`,
          [run.id, ox_id, product?.visible && product.title ? product : null]);
      }
      await client.query("UPDATE xl_catalog_runs SET updated_at = now() WHERE id = $1", [run.id]);
      const counts = await summarize(client, run.id);
      if (counts.checked === counts.expected) {
        if (counts.usable === 0) throw new OxatisError("empty_catalog");
        await client.query("UPDATE xl_catalog_runs SET stage = 'published' WHERE id = $1", [run.id]);
        await client.query("DELETE FROM xl_catalog_runs WHERE stage = 'published' AND id <> $1", [run.id]);
      }
    }
    return summarize(client, run.id);
  });

  async function current() {
    // One statement keeps the selected generation and its products consistent during publication.
    const { rows } = await pool.query(`
      SELECT r.id, r.updated_at,
        CASE WHEN r.id IS DISTINCT FROM $1::bigint THEN (
          SELECT COALESCE(jsonb_agg(p.product), '[]'::jsonb) FROM xl_catalog_products p
          WHERE p.run_id = r.id AND p.product IS NOT NULL
        ) END AS products
      FROM xl_catalog_runs r WHERE r.stage = 'published' ORDER BY r.id DESC LIMIT 1`, [cache?.id ?? null]);
    const row = rows[0];
    if (!row) {
      cache = undefined;
      return null;
    }
    if (row.products) cache = { id: row.id, updatedAt: row.updated_at, products: row.products };
    return cache;
  }

  return { start, status, cancel, step, current };
}
