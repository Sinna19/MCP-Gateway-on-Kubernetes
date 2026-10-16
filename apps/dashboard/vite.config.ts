/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dev only: the browser talks to localhost:5173 and Vite forwards /api to the gateway in k3d.
// changeOrigin rewrites the Host header, because Traefik routes by Host (app.localtest.me).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": { target: "http://app.localtest.me", changeOrigin: true } },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["test/setup.ts"],
  },
});
