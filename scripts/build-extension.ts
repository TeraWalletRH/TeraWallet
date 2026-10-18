// Builds the Chrome extension into dist-extension/, ready for "Load unpacked"
// or zipping for the Chrome Web Store. Run with: bun run build:extension
//
// Each script is bundled on its own: content scripts can't load modules, so
// inpage.js and content.js are self-contained IIFEs, and nothing is fetched
// from anywhere at runtime (an extension's code must be what was reviewed).

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { BunPlugin } from "bun";

const root = fileURLToPath(new URL("..", import.meta.url));
const src = join(root, "extension");
const out = join(root, "dist-extension");

// crypto.ts imports "./kdf", which is the phone's PBKDF2. A browser gets the
// WebCrypto one, as the web app does through Metro's .web.ts resolution.
const webKdf: BunPlugin = {
  name: "web-kdf",
  setup(build) {
    build.onResolve({ filter: /^\.\/kdf$/ }, (args) =>
      args.importer.includes(join("android", "src"))
        ? { path: join(root, "android/src/kdf.web.ts") }
        : undefined,
    );
  },
};

const icon = `data:image/png;base64,${(await readFile(join(src, "icons/icon-48.png"))).toString("base64")}`;

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const entries: [string, "iife" | "esm"][] = [
  ["inpage", "iife"],
  ["content", "iife"],
  ["background", "esm"],
  ["popup", "esm"],
  ["approve", "esm"],
];

for (const [name, format] of entries) {
  const result = await Bun.build({
    entrypoints: [join(src, "src", `${name}.ts`)],
    outdir: out,
    naming: `${name}.js`,
    format,
    target: "browser",
    minify: true,
    plugins: [webKdf],
    define: {
      __TERA_ICON__: JSON.stringify(icon),
      // config.ts reads EXPO_PUBLIC_* overrides; the extension ships the
      // defaults. TERA_EXTENSION_RPC points a test build at one node (a local
      // chain), for both reads and sending; never set it for a release.
      "process.env": JSON.stringify(
        process.env.TERA_EXTENSION_RPC
          ? {
              EXPO_PUBLIC_RPC_URL: process.env.TERA_EXTENSION_RPC,
              EXPO_PUBLIC_RPC_POOL: process.env.TERA_EXTENSION_RPC,
            }
          : {},
      ),
    },
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
}

for (const file of ["manifest.json", "popup.html", "approve.html", "popup.css", "icons"])
  await cp(join(src, file), join(out, file), { recursive: true });

const manifest = JSON.parse(await readFile(join(src, "manifest.json"), "utf8"));
await writeFile(join(out, "VERSION"), `${manifest.version}\n`);
console.log(
  `dist-extension/ built (Tera Wallet ${manifest.version})${process.env.TERA_EXTENSION_RPC ? ` TEST BUILD against ${process.env.TERA_EXTENSION_RPC}` : ""}`,
);
