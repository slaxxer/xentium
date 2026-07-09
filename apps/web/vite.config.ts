import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@web/lib":        resolve(__dirname, "src/lib"),
      "@web/hooks":      resolve(__dirname, "src/hooks"),
      "@web/plugins":    resolve(__dirname, "src/plugins"),
      "@web/components": resolve(__dirname, "src/components"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: { "/api": "http://localhost:4000", "/uploads": "http://localhost:4000" },
  },
  optimizeDeps: { exclude: ["@nodevo/ui", "@nodevo/contracts", "@nodevo/sdk"] },
});
