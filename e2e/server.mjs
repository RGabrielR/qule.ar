import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "qule-e2e-"));
const server = spawn(process.execPath, ["--import", "tsx", "apps/api/src/index.ts"], {
  stdio: "inherit",
  env: {
    PATH: process.env.PATH,
    PORT: process.env.PORT,
    APP_URL: process.env.APP_URL,
    DATA_DIR: dataDir,
  },
});

process.on("SIGTERM", () => server.kill("SIGTERM"));
server.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
server.on("close", (code) => {
  rmSync(dataDir, { recursive: true, force: true });
  process.exitCode = code ?? 1;
});
