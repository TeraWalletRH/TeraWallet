#!/usr/bin/env node
// Fetch the on-device assistant model and publish it from this origin.
//
// The wallet could have pointed transformers.js at a model hub and downloaded
// nothing. That would have been free, and it would have put a party on the
// egress panel that sees the owner's network address and which model they took
// — in a feature whose entire purpose is to remove parties from that panel. So
// the weights are served from terawallet.app instead, and this script is what
// puts them there.
//
//   bun run build:model
//
// It writes public/tera/model/, which is gitignored: 100MB of weights do not
// belong in a source repository, and anyone can reproduce the directory from
// the pinned revision below and check the digests against the published
// manifest. That reproducibility is the reason REVISION is a commit sha and not
// a branch name.
//
// The ONNX Runtime WebAssembly binaries are copied out of node_modules for the
// same reason. Left to itself, onnxruntime-web fetches them from a CDN.

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = join(root, "public", "tera", "model");
const base = "/tera/model/";

/** The model, pinned to an exact revision so this script is reproducible. */
const REPO = "HuggingFaceTB/SmolLM2-135M-Instruct";
const REVISION = "12fd25f77366fa6b3b4b768ec3050bf629380bac";
const MODEL_ID = "smollm2-135m-instruct";

/** What transformers.js needs to build a text-generation pipeline.
 *
 * The int8 weights, not the q4 ones. q4f16 is smaller still, but half-precision
 * on this repository's graph is aimed at WebGPU, and this engine is pinned to
 * the WebAssembly backend so it works in every browser rather than the ones
 * with a GPU adapter. int8 is the variant that actually runs there. */
const MODEL_FILES = [
  "config.json",
  "generation_config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "special_tokens_map.json",
  "onnx/model_quantized.onnx",
];

/** The runtime binaries, taken from the installed package rather than a CDN.
 *
 * Only the build that is actually loaded. onnxruntime-web ships four, and
 * copying all of them added 58MB to a download the owner has to agree to for a
 * privacy feature — which is exactly the kind of cost that makes someone
 * decline it. transformers.js loads the jsep build; the rest are dead weight. */
const ORT_PACKAGE = join(root, "node_modules", "onnxruntime-web", "dist");
const ORT_FILES = /^ort-wasm-simd-threaded\.jsep\.(wasm|mjs)$/;

const sri = (bytes) => `sha256-${createHash("sha256").update(bytes).digest("base64")}`;

async function write(path, bytes) {
  const target = join(output, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
  return { path, hash: sri(bytes), bytes: bytes.length };
}

/** Attempts before a file is given up on. The weights are ~100MB over one TLS
 * connection and hub CDNs drop those, so a resume is the normal path here and
 * not an exceptional one. */
const ATTEMPTS = 6;

async function download(name) {
  const url = `https://huggingface.co/${REPO}/resolve/${REVISION}/${name}`;
  process.stdout.write(`  ${name} … `);
  const chunks = [];
  let have = 0;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, have ? { headers: { Range: `bytes=${have}-` } } : {});
      // A server that ignores the range restarts the file, so the partial bytes
      // have to go with it or the two halves would be concatenated into rubbish.
      if (have && response.status !== 206) {
        chunks.length = 0;
        have = 0;
      }
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      for await (const chunk of response.body) {
        chunks.push(Buffer.from(chunk));
        have += chunk.byteLength;
      }
      const bytes = Buffer.concat(chunks);
      process.stdout.write(`${(bytes.length / 1e6).toFixed(1)} MB\n`);
      return write(`${MODEL_ID}/${name}`, bytes);
    } catch (error) {
      if (attempt === ATTEMPTS) throw new Error(`${name}: ${error.message}`);
      process.stdout.write(`\n    interrupted at ${(have / 1e6).toFixed(1)} MB, resuming … `);
    }
  }
  throw new Error(`${name}: exhausted ${ATTEMPTS} attempts.`);
}

async function copyRuntime() {
  let names;
  try {
    names = (await readdir(ORT_PACKAGE)).filter((name) => ORT_FILES.test(name));
  } catch {
    throw new Error(
      "onnxruntime-web is not installed. Run `bun install` before `bun run build:model`.",
    );
  }
  if (!names.length) throw new Error(`No runtime binaries matched in ${ORT_PACKAGE}.`);
  names.sort();
  const files = [];
  for (const name of names) {
    const bytes = await readFile(join(ORT_PACKAGE, name));
    process.stdout.write(`  ort/${name} … ${(bytes.length / 1e6).toFixed(1)} MB\n`);
    files.push(await write(`ort/${name}`, bytes));
  }
  return files;
}

function listHash(files) {
  const canonical = [...files]
    .map((file) => `${file.path} ${file.hash}`)
    .sort()
    .join("\n");
  return `sha256-${createHash("sha256").update(canonical, "utf8").digest("base64")}`;
}

console.log(`${REPO}@${REVISION.slice(0, 12)}`);
const files = [];
for (const name of MODEL_FILES) files.push(await download(name));
files.push(...(await copyRuntime()));
files.sort((a, b) => a.path.localeCompare(b.path));

const total = files.reduce((sum, file) => sum + file.bytes, 0);
const manifest = {
  manifest: "Tera on-device model",
  version: 1,
  model: "SmolLM2-135M-Instruct",
  modelId: MODEL_ID,
  repository: REPO,
  revision: REVISION,
  licence: "Apache-2.0",
  algorithm: "sha256",
  base,
  note: "Digests of the model files this site serves. The wallet checks every one of them before the model is built, and they are reproducible from the pinned revision above.",
  files,
  filesHash: listHash(files),
};

await writeFile(join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(
  `${files.length} files · ${(total / 1e6).toFixed(1)} MB → ${relative(root, join(output, "manifest.json"))}`,
);
