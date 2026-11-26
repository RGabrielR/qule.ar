import { closeDb, runMigrations } from "./db/index.js";

try {
  await runMigrations();
  console.log("Migraciones aplicadas.");
} finally {
  await closeDb();
}
