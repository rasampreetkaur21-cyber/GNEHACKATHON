import { fileURLToPath } from "node:url";
import { defineConfig, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": "http://127.0.0.1:3001" },
    fs: {
      deny: [
        ".env",
        ".env.*",
        "*.{crt,pem}",
        "**/.git/**",
        "**/backend/tests/**",
        "**/data/synthetic/**",
        "**/datasets/**",
        "**/backend/local_ai/**",
      ],
      allow: [
        searchForWorkspaceRoot(fileURLToPath(new URL(".", import.meta.url))),
        fileURLToPath(new URL("../backend/src/catalog.js", import.meta.url)),
      ],
    },
  },
});
