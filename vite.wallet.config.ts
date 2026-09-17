import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const ort = (file: string) =>
  fileURLToPath(new URL(`./node_modules/onnxruntime-web/dist/${file}`, import.meta.url));

// The dashboard is served as raw HTML rather than a React route. Bundle its
// RainbowKit island separately so it can use React without changing page routing.
export default defineConfig({
  plugins: [react()],
  publicDir: false,
  // Pinned so the build cannot pick up a PostCSS config from outside the
  // repository. This project styles through the Tailwind v4 Vite plugin and has
  // no PostCSS chain of its own; without this, Vite walks up past the project
  // root and the build depends on what happens to sit above the checkout.
  css: { postcss: { plugins: [] } },
  resolve: {
    // onnxruntime-web ships two shapes of every build: one that embeds its
    // WebAssembly as base64 inside the JavaScript, and one that fetches it. The
    // embedding build is the package default and produced a 72MB module, which
    // the on-device engine would have had to download before generating a
    // single token. These aliases pick the fetching build, whose binaries this
    // site serves from /tera/model/ort/ — self-hosted for the same reason as
    // the weights. The patterns are anchored because the replacement path
    // begins with the specifier being replaced.
    alias: [
      { find: /^onnxruntime-web\/webgpu$/, replacement: ort("ort.webgpu.min.mjs") },
      { find: /^onnxruntime-web$/, replacement: ort("ort.min.mjs") },
    ],
  },
  base: "/tera/connect/",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "public/tera/connect",
    emptyOutDir: true,
    lib: {
      entry: {
        "wallet-connect": "src/wallet/connect.tsx",
        "policy-verify": "src/wallet/policy.ts",
        "engine-runtime": "src/wallet/engine-runtime.ts",
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
      cssFileName: "wallet-connect",
    },
  },
});
