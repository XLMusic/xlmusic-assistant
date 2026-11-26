import { setTimeout as sleep } from "node:timers/promises";

const [address, rawSteps, rawDelay] = process.argv.slice(2);
const token = process.env.CATALOG_ADMIN_TOKEN;
const steps = Number(rawSteps);
const delay = Number(rawDelay);
let base;
try {
  base = new URL(address);
  if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/"
    || base.search || base.hash || !Number.isSafeInteger(steps) || steps < 1
    || !Number.isSafeInteger(delay) || delay < 250 || !token || token.length < 32) throw new Error();
} catch {
  console.error("Usage : node scripts/import-oxatis.js https://service.onrender.com NOMBRE_ETAPES PAUSE_MS");
  console.error("Définissez CATALOG_ADMIN_TOKEN dans l’environnement et une pause d’au moins 250 ms.");
  process.exit(1);
}

async function call(path, method) {
  const response = await fetch(new URL("/api/admin/oxatis/import/" + path, base), {
    method,
    redirect: "error",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(90000)
  });
  const state = await response.json();
  if (!response.ok) {
    console.error("Appel interrompu", response.status, state?.error, state?.upstreamStatus ?? "");
    throw new Error();
  }
  return state;
}

try {
  let state = await call("status", "GET");
  if (!state) {
    console.log("Aucun import démarré.");
    process.exitCode = 1;
  } else {
    for (let index = 0; index < steps && state.stage !== "published"; index++) {
      state = await call("step", "POST");
      console.log(`Import ${state.id} • ${state.stage} • ${state.listed}/${state.expected} identifiants • ${state.checked}/${state.expected} fiches • ${state.usable} utilisables`);
      if (index + 1 < steps && state.stage !== "published") await sleep(delay);
    }
    if (state.stage === "published") console.log("Catalogue publié dans PostgreSQL.");
  }
} catch {
  console.error("Import interrompu. Consultez son état avant de reprendre.");
  process.exitCode = 1;
}
