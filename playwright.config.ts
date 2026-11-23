import { defineConfig } from "@playwright/test";

const port = process.env.PLAYWRIGHT_PORT ?? "49926";
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL, browserName: "chromium", trace: "retain-on-failure" },
  webServer: {
    command: "node e2e/server.mjs",
    url: `${baseURL}/api/config`,
    env: { PORT: String(port), APP_URL: baseURL },
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    reuseExistingServer: false,
  },
});
