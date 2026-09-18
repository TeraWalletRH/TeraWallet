import { defineConfig } from "vite";

// The offline verifier's logic, built as one self-contained module.
//
// Separate from vite.wallet.config.ts for one reason: code splitting cannot be
// turned off per entry, and the offline page is worth nothing if the bundle it
// inlines can emit a second chunk to fetch. Anything that splits here becomes a
// network request on a page whose whole claim is that it makes none.
export default defineConfig({
  publicDir: false,
  css: { postcss: { plugins: [] } },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "build/verify",
    emptyOutDir: true,
    lib: { entry: "src/verify/verifier.js", formats: ["es"], fileName: () => "verifier.js" },
    rollupOptions: { output: { codeSplitting: false } },
  },
});
