import { defineConfig } from "@playwright/test";

const port = process.env.PLAYWRIGHT_PORT ?? "49926";
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  // Con movimiento reducido: las pruebas no miran animaciones, y así las pantallas y los menús no se desplazan
  // mientras se mide o se hace clic (los fundidos y la salida de las hojas se siguen ejercitando)
  // En celular (375 px), como se diseña la app: desde 1024 px se arma la vista de compu (lista y detalle lado a lado),
  // que tiene sus propias pruebas en e2e/desktop.spec.ts
  use: { baseURL, browserName: "chromium", trace: "retain-on-failure", reducedMotion: "reduce", viewport: { width: 375, height: 812 } },
  webServer: {
    command: "node e2e/server.mjs",
    url: `${baseURL}/api/config`,
    env: { PORT: String(port), APP_URL: baseURL },
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    reuseExistingServer: false,
  },
});
