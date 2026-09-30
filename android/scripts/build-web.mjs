#!/usr/bin/env node
// Build the web app: this Expo app, compiled for the browser, at /app/.
//
// The web app is not a second wallet. It is App.tsx, rendered by
// react-native-web, so every screen, rule and word is the phone's own. Only
// storage (src/keystore.web.ts), the key derivation (src/kdf.web.ts) and the
// updater (src/update.web.ts) differ, and each says why in its own file.
//
// Output goes into the site, where the deploy serves it as it is:
//   public/app/            the bundle, assets, icons, manifest and service worker
//   src/site/app/index.html  the page, served at /app by src/lib/site-pages.ts
//
// The site's own build cannot run this (it does not install this app's
// dependencies), so the output is committed. Run it from android/:
//   bun run build:web

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const app = fileURLToPath(new URL("..", import.meta.url));
const repo = join(app, "..");
const dist = join(app, "dist-web");
const out = join(repo, "public", "app");
const page = join(repo, "src", "site", "app", "index.html");
const web = join(app, "web");

// A build number for Settings > Version, from the repository's history so the
// same commit always builds the same number.
const build = execSync("git rev-list --count HEAD", { cwd: repo }).toString().trim();

rmSync(dist, { recursive: true, force: true });
execSync(`npx expo export --platform web --output-dir dist-web`, {
  cwd: app,
  stdio: "inherit",
  env: {
    ...process.env,
    TERA_WEB_BASE: "/app",
    EXPO_PUBLIC_WEB_BUILD: build,
  },
});

// Expo writes its own index.html; only its script tags are kept, and they go
// into this app's page (web/index.html), which carries the PWA wiring.
const exported = readFileSync(join(dist, "index.html"), "utf8");
const scripts = exported.match(/<script [^>]*src="[^"]+"[^>]*><\/script>/g) ?? [];
if (!scripts.length) throw new Error("The export has no script tag; nothing to serve.");
if (scripts.some((tag) => !tag.includes('src="/app/')))
  throw new Error("The export was not built for /app/; check TERA_WEB_BASE in app.config.js.");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const entry of readdirSync(dist)) {
  if (entry === "index.html" || entry === "metadata.json") continue;
  cpSync(join(dist, entry), join(out, entry), { recursive: true });
}
for (const file of ["manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"])
  cpSync(join(web, file), join(out, file));

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
const files = walk(out)
  .map((path) => `/app/${relative(out, path).split("\\").join("/")}`)
  .sort();

// The cache name is the content, so a rebuild that changes nothing keeps the
// installed app's cache, and any change replaces it.
const digest = createHash("sha256");
for (const path of walk(out).sort()) digest.update(readFileSync(path));
const version = digest.digest("hex").slice(0, 16);

writeFileSync(
  join(out, "sw.js"),
  readFileSync(join(web, "sw.js"), "utf8")
    .replace("__BUILD__", version)
    .replace("__FILES__", JSON.stringify(files, null, 2)),
);

mkdirSync(join(repo, "src", "site", "app"), { recursive: true });
writeFileSync(
  page,
  readFileSync(join(web, "index.html"), "utf8").replace(
    "<!-- tera:scripts -->",
    scripts.join("\n    "),
  ),
);

rmSync(dist, { recursive: true, force: true });
console.log(`web app ${version} (build ${build}): ${files.length} files in public/app, page at src/site/app`);
