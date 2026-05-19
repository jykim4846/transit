// @ts-check
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./test/e2e",
  timeout: 30_000,
  expect: {
    timeout: 5_000
  },
  use: {
    baseURL: "http://127.0.0.1:3020",
    trace: "on-first-retry"
  },
  webServer: {
    command: "PORT=3020 node dev-server.js",
    url: "http://127.0.0.1:3020",
    reuseExistingServer: true,
    timeout: 15_000
  }
});
