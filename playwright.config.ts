import { defineConfig } from "@playwright/test";

const port = process.env.PLAYWRIGHT_PORT ?? "49926";
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  // Con movimiento reducido: las pruebas no miran animaciones, y así las pantallas y los menús no se desplazan
  // mientras se mide o se hace clic (los fundidos y la salida de las hojas se siguen ejercitando)
  use: { baseURL, browserName: "chromium", trace: "retain-on-failure", reducedMotion: "reduce" },
  webServer: {
    command: "node e2e/server.mjs",
    url: `${baseURL}/api/config`,
    env: { PORT: String(port), APP_URL: baseURL },
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    reuseExistingServer: false,
  },
});
