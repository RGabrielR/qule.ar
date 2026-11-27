// Revisión de fotos explícitas en un proceso aparte del API (ver src/explicit/ y docs/DEPLOY.md, "Fotos explícitas").
// Corre en su propio contenedor, con la misma imagen y el mismo app.env, y con CPU y memoria limitadas por Docker:
// así el modelo nunca le saca recursos al chat ni a la grilla. Si este proceso no corre, la app sigue igual y las
// fotos nuevas simplemente quedan sin revisar hasta que vuelva.
//
//   node --import tsx src/explicitWorker.ts
//
// No corre migraciones: eso lo hace el API.
import { checkDataKey } from "./crypt.js";
import { closeDb } from "./db/index.js";
import { explicitMode, startExplicitQueue } from "./explicit/index.js";

checkDataKey();
const stop = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`${signal}: cerrando…`);
    stop.abort();
  });
}
// Acá siempre corre el modelo de verdad, salvo en pruebas
await startExplicitQueue(explicitMode() === "test" ? "test" : "inline", stop.signal);
await closeDb().catch((e) => console.error("closeDb", e));
process.exit(0);
