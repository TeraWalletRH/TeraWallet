import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dashboard is served as raw HTML rather than a React route. Bundle its
// RainbowKit island separately so it can use React without changing page routing.
export default defineConfig({
  plugins: [react()],
  publicDir: false,
  base: "/tera/connect/",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "public/tera/connect",
    emptyOutDir: true,
    lib: {
      entry: "src/wallet/connect.tsx",
      formats: ["es"],
      fileName: "wallet-connect",
      cssFileName: "wallet-connect",
    },
  },
});
