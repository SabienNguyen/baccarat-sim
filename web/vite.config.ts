/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
  // relative asset paths so the build works at any hosting path (GH Pages subpath etc.)
  base: "./",
  plugins: [react(), wasm(), topLevelAwait()],
  server: {
    // the multiplayer table service (cargo run -p baccarat-server)
    proxy: {
      "/ws": { target: "ws://localhost:8788", ws: true },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
  },
});
