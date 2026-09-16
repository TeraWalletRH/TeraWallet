#!/usr/bin/env node
// Generate the published build manifest for the wallet's own modules.
//
// The manifest lists every file under public/tera/wallet/ with its SHA-256, so
// the page can check what it is serving and — more importantly — so anyone can
// check it from outside the browser:
//
//   openssl dgst -binary -sha256 public/tera/wallet/app.js | openssl base64 -A
//
// The release id is derived from the file list itself, so it is reproducible
// from a checkout of the source and does not depend on git state or a build
// machine. Run it with:  bun run build:manifest
//
// Signing is optional and off by default. Set TERA_MANIFEST_SIGNER_PRIVATE_KEY
// to sign the manifest; without it the manifest still publishes the hashes and
// the wallet reports it as unsigned rather than pretending otherwise.

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const directory = join(root, "public", "tera", "wallet");
const output = join(directory, "manifest.json");
const base = "/tera/wallet/";
// The manifest cannot contain its own hash.
const EXCLUDED = new Set(["manifest.json"]);
const INCLUDED = /\.(?:js|css)$/;

const sri = (bytes) => `sha256-${createHash("sha256").update(bytes).digest("base64")}`;

async function collect() {
  const names = (await readdir(directory)).filter(
    (name) => INCLUDED.test(name) && !EXCLUDED.has(name),
  );
  names.sort();
  if (!names.length) throw new Error(`No wallet modules found in ${relative(root, directory)}`);
  return Promise.all(
    names.map(async (name) => {
      const bytes = await readFile(join(directory, name));
      return { path: name, hash: sri(bytes), bytes: bytes.length };
    }),
  );
}

function listHash(files) {
  const canonical = [...files]
    .map((file) => `${file.path} ${file.hash}`)
    .sort()
    .join("\n");
  const digest = createHash("sha256").update(canonical, "utf8").digest();
  return { sri: `sha256-${digest.toString("base64")}`, hex: digest.toString("hex") };
}

async function sign(manifest) {
  const key = process.env.TERA_MANIFEST_SIGNER_PRIVATE_KEY;
  if (!key) return manifest;
  // viem is already a dependency of this project; it is imported only when a
  // signing key is present so an unsigned build needs nothing extra.
  const { privateKeyToAccount } = await import("viem/accounts");
  const account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`);
  const expected = process.env.TERA_MANIFEST_SIGNER_ADDRESS;
  if (expected && account.address.toLowerCase() !== expected.toLowerCase())
    throw new Error("TERA_MANIFEST_SIGNER_ADDRESS does not match the signing key.");
  const message = `Tera build manifest v1:${manifest.release}:${manifest.builtAt}:${manifest.filesHash}`;
  return {
    ...manifest,
    signer: account.address,
    signature: await account.signMessage({ message }),
  };
}

const files = await collect();
const hash = listHash(files);
const manifest = await sign({
  manifest: "Tera wallet build manifest",
  version: 1,
  release: `r-${hash.hex.slice(0, 12)}`,
  builtAt: new Date().toISOString(),
  algorithm: "sha256",
  base,
  note: "Hashes of the wallet modules this site serves. Verify them yourself against the public source; the page's own check cannot be trusted if the page itself was replaced.",
  files,
  filesHash: hash.sri,
});

await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(
  `${manifest.release} · ${files.length} files · ${manifest.signature ? `signed by ${manifest.signer}` : "unsigned"} → ${relative(root, output)}`,
);
