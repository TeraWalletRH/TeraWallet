// The worker the on-device model runs in.
//
// It is deliberately small and readable, because it is the half of the engine
// that decides what happens to a message. The vendor runtime it imports is
// large and is not readable; keeping the two apart is what makes the sentence
// "the message is never put into a request" checkable rather than asserted.
//
// The only network access in this file is `fetch` against this origin, for the
// manifest and the weight files, and every one of those is checked against a
// published digest before the runtime is allowed to touch it. There is no code
// path here that sends a message anywhere. Read the message handlers below:
// `ask` takes a turn and posts a reply back to the page, and that is all.

import { load, generate, unload, MODEL_BASE, MODEL_ID } from "/tera/connect/engine-runtime.js";

const MANIFEST_URL = `${MODEL_BASE}manifest.json`;

let manifest = null;
let verified = false;

const send = (message) => self.postMessage(message);

async function sri(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return `sha256-${btoa(binary)}`;
}

async function readManifest() {
  if (manifest) return manifest;
  const response = await fetch(MANIFEST_URL, { cache: "no-store" });
  if (!response.ok)
    throw new Error(
      "The on-device model is not published on this site. Nothing was downloaded and nothing was sent.",
    );
  manifest = await response.json();
  return manifest;
}

/**
 * Fetch every weight file and check it against the manifest before the runtime
 * is constructed.
 *
 * Doing it in this order is the point. Once the bytes are inside the runtime,
 * checking them proves nothing useful; a mismatch has to stop the model being
 * built at all, so nothing here returns early on a failure and nothing caches a
 * file that did not match.
 */
async function verifyWeights(published) {
  const files = Array.isArray(published.files) ? published.files : [];
  if (!files.length) throw new Error("The published model manifest lists no files.");
  const total = files.reduce((sum, file) => sum + (Number(file.bytes) || 0), 0);
  let done = 0;
  const failed = [];
  for (const file of files) {
    send({ type: "progress", phase: "verify", file: file.path, loaded: done, total });
    const response = await fetch(`${MODEL_BASE}${file.path}`, { cache: "force-cache" });
    if (!response.ok) {
      failed.push(file.path);
      continue;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if ((await sri(bytes)) !== file.hash) failed.push(file.path);
    done += bytes.byteLength;
    send({ type: "progress", phase: "verify", file: file.path, loaded: done, total });
  }
  if (failed.length)
    throw new Error(
      `The model files served by this site do not match the published digests (${failed.join(", ")}). The model was not loaded.`,
    );
  verified = true;
}

/**
 * `known` is the manifest list-hash this browser has already checked in full.
 *
 * Re-hashing 168MB on every page load would make the feature unusable, so a
 * match means the files are taken from the browser's own cache for this origin
 * without being read again. That is a real, if small, reduction in what is
 * proven, and it is stated in the panel rather than left for someone to find:
 * the first load is checked byte for byte, and any change to what Tera
 * publishes changes the list-hash and forces the whole check again.
 */
async function prepare(known) {
  const published = await readManifest();
  if (!verified && known && known === published.filesHash) {
    verified = true;
    send({ type: "progress", phase: "verify", file: "", loaded: 1, total: 1, remembered: true });
  }
  if (!verified) {
    await verifyWeights(published);
    send({ type: "verified", filesHash: published.filesHash });
  }
  await load((progress) => {
    send({
      type: "progress",
      phase: "load",
      file: progress?.file || "",
      loaded: Number(progress?.loaded) || 0,
      total: Number(progress?.total) || 0,
      status: progress?.status || "",
    });
  });
  send({
    type: "ready",
    model: published.model || MODEL_ID,
    revision: published.revision || "",
    files: published.files?.length || 0,
  });
}

self.onmessage = async (event) => {
  const { id, type, turn, known } = event.data || {};
  try {
    if (type === "prepare") {
      await prepare(known);
      send({ id, type: "prepared" });
      return;
    }
    if (type === "ask") {
      if (!verified) throw new Error("The model was not verified, so no answer was produced.");
      const text = await generate(turn);
      send({ id, type: "reply", text });
      return;
    }
    if (type === "unload") {
      await unload();
      verified = false;
      manifest = null;
      send({ id, type: "unloaded" });
      return;
    }
    throw new Error(`Unknown engine instruction: ${type}`);
  } catch (error) {
    send({ id, type: "failed", message: error?.message || String(error) });
  }
};
