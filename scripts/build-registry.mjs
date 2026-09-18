#!/usr/bin/env node
// Append the current build to the approved-build registry.
//
//   bun run build:registry
//
// A receipt names the release that produced it, and until there was a published
// list of releases, "r-0000000000" read exactly as well as a real one. This
// writes that list: every release Tera has shipped, with its file hash and the
// date, signed by the same key that signs a build manifest.
//
// It appends. A registry that dropped older entries would make every receipt
// written before the last deploy unverifiable, which is the opposite of the
// point — receipts are kept precisely so they can be checked later.
//
// Signing is optional and off by default, exactly as the manifest's is. Without
// a key the registry still publishes the list and reports itself unsigned,
// which `registry.js` refuses to treat as authoritative rather than pretending
// otherwise.

import { readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const manifestPath = join(root, "public", "tera", "wallet", "manifest.json");
const output = join(root, "public", "tera", "registry.json");

const KIND = "Tera approved builds";
const DOMAIN = "Tera build registry v1";

function signingMessage(doc) {
  const builds = [...doc.builds]
    .map((build) => `${build.release} ${build.filesHash}`)
    .sort()
    .join("\n");
  return `${DOMAIN}\n${doc.publishedAt}\n${builds}`;
}

async function readExisting() {
  try {
    const parsed = JSON.parse(await readFile(output, "utf8"));
    return Array.isArray(parsed.builds) ? parsed.builds : [];
  } catch {
    return [];
  }
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (!manifest.release || !manifest.filesHash)
  throw new Error("The build manifest has no release to publish. Run `bun run build:manifest`.");

const builds = await readExisting();
const already = builds.find((build) => build.release === manifest.release);

if (already && already.filesHash !== manifest.filesHash)
  throw new Error(
    `${manifest.release} is already in the registry with a different file hash. A release id is derived from the file list, so two different lists cannot share one — rebuild the manifest.`,
  );

if (!already)
  builds.push({
    release: manifest.release,
    filesHash: manifest.filesHash,
    publishedAt: new Date().toISOString(),
    files: manifest.files.length,
  });

builds.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));

const doc = {
  registry: KIND,
  version: 1,
  algorithm: "sha256",
  publishedAt: new Date().toISOString(),
  note: "Every release this site has published, newest first. A receipt naming a release absent from this list was not produced by a build Tera shipped. Presence here does not establish that any particular page was running that build — check the file hashes yourself against the published source.",
  builds,
};

const key = process.env.TERA_MANIFEST_SIGNER_PRIVATE_KEY;
if (key) {
  const { privateKeyToAccount } = await import("viem/accounts");
  const account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`);
  const expected = process.env.TERA_MANIFEST_SIGNER_ADDRESS;
  if (expected && account.address.toLowerCase() !== expected.toLowerCase())
    throw new Error("TERA_MANIFEST_SIGNER_ADDRESS does not match the signing key.");
  doc.signer = account.address;
  doc.signature = await account.signMessage({ message: signingMessage(doc) });
}

await writeFile(output, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
console.log(
  `${builds.length} ${builds.length === 1 ? "build" : "builds"} · ${already ? "already listed" : `added ${manifest.release}`} · ${doc.signature ? `signed by ${doc.signer}` : "unsigned"} → ${relative(root, output)}`,
);
