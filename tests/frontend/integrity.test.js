import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  sriDigest,
  filesHash,
  deriveRelease,
  canonicalFileList,
  verifyManifest,
  badge,
  summary,
} from "../../public/tera/wallet/integrity.js";

const bytes = (text) => new TextEncoder().encode(text);

// A server that answers with whatever the test put in it.
function server(contents) {
  return async (path) => {
    const name = path.replace("/tera/wallet/", "");
    if (!(name in contents)) throw new Error("404");
    return bytes(contents[name]);
  };
}

async function manifestFor(contents, overrides = {}) {
  const files = await Promise.all(
    Object.entries(contents)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(async ([path, text]) => ({
        path,
        hash: await sriDigest(bytes(text)),
        bytes: text.length,
      })),
  );
  const hash = await filesHash(files);
  return {
    manifest: "Tera wallet build manifest",
    version: 1,
    release: deriveRelease(hash.hex),
    builtAt: "2026-09-16T20:00:00.000Z",
    algorithm: "sha256",
    base: "/tera/wallet/",
    files,
    filesHash: hash.sri,
    ...overrides,
  };
}

const source = { "app.js": "export const a = 1;\n", "vault.js": "export const b = 2;\n" };

test("a matching build verifies and names its release", async () => {
  const manifest = await manifestFor(source);
  const result = await verifyManifest(manifest, { fetchFile: server(source) });
  assert.equal(result.status, "verified");
  assert.equal(result.checked, 2);
  assert.equal(result.matched, 2);
  assert.deepEqual(result.problems, []);
  assert.equal(result.signed, false);
  assert.equal(badge(result).tone, "ok");
  assert.match(badge(result).label, /^Release r-[\da-f]{12} · hashes only$/);
});

test("one changed byte is caught and named", async () => {
  const manifest = await manifestFor(source);
  const tampered = { ...source, "vault.js": "export const b = 3;\n" };
  const result = await verifyManifest(manifest, { fetchFile: server(tampered) });
  assert.equal(result.status, "modified");
  assert.equal(result.matched, 1);
  assert.equal(result.problems.length, 1);
  assert.equal(result.problems[0].path, "vault.js");
  assert.equal(result.problems[0].kind, "mismatch");
  assert.equal(badge(result).tone, "fail");
  assert.equal(badge(result).label, "Code does not match");
  assert.equal(result.files.find((f) => f.path === "vault.js").ok, false);
  assert.equal(result.files.find((f) => f.path === "app.js").ok, true);
});

test("a file the server will not serve is a problem, not a pass", async () => {
  const manifest = await manifestFor(source);
  const result = await verifyManifest(manifest, {
    fetchFile: server({ "app.js": source["app.js"] }),
  });
  assert.equal(result.status, "modified");
  assert.equal(result.problems[0].kind, "missing");
});

test("editing the file list without editing its hash is caught", async () => {
  const manifest = await manifestFor(source);
  // Swap in a hash for content the attacker controls, keeping the old list hash.
  manifest.files[1].hash = await sriDigest(bytes("export const b = 3;\n"));
  const result = await verifyManifest(manifest, {
    fetchFile: server({ ...source, "vault.js": "export const b = 3;\n" }),
  });
  assert.equal(result.status, "modified");
  assert.ok(result.problems.some((p) => p.kind === "list-hash"));
});

test("a release id that does not describe the file list is caught", async () => {
  const manifest = await manifestFor(source, { release: "r-000000000000" });
  const result = await verifyManifest(manifest, { fetchFile: server(source) });
  assert.equal(result.status, "modified");
  assert.ok(result.problems.some((p) => p.kind === "release"));
});

test("the release id is derived from the files, so it is reproducible", async () => {
  const first = await manifestFor(source);
  const second = await manifestFor({ ...source });
  assert.equal(first.release, second.release);
  const changed = await manifestFor({ ...source, "vault.js": "export const b = 3;\n" });
  assert.notEqual(first.release, changed.release);
});

test("the canonical list is order independent", async () => {
  const manifest = await manifestFor(source);
  const reversed = [...manifest.files].reverse();
  assert.equal(canonicalFileList(manifest.files), canonicalFileList(reversed));
  assert.equal((await filesHash(reversed)).hex, (await filesHash(manifest.files)).hex);
});

test("a signed manifest is only trusted when the signature verifies", async () => {
  const manifest = await manifestFor(source, { signer: "0xabc", signature: "0xdef" });
  const good = await verifyManifest(manifest, {
    fetchFile: server(source),
    verifySignature: async () => true,
  });
  assert.equal(good.status, "verified");
  assert.equal(good.signed, true);
  assert.equal(good.signerOk, true);
  assert.match(badge(good).label, /^Signed release r-/);

  const bad = await verifyManifest(manifest, {
    fetchFile: server(source),
    verifySignature: async () => false,
  });
  assert.equal(bad.status, "modified");
  assert.ok(bad.problems.some((p) => p.kind === "signature"));
});

test("a signature this page cannot check is reported, never assumed good", async () => {
  const manifest = await manifestFor(source, { signer: "0xabc", signature: "0xdef" });
  const result = await verifyManifest(manifest, { fetchFile: server(source) });
  assert.equal(result.signed, true);
  assert.equal(result.signerOk, null);
  assert.equal(result.status, "modified");
  assert.ok(result.problems.some((p) => p.kind === "signature-unchecked"));
});

test("a verifier that throws is a failure, not a pass", async () => {
  const manifest = await manifestFor(source, { signer: "0xabc", signature: "0xdef" });
  const result = await verifyManifest(manifest, {
    fetchFile: server(source),
    verifySignature: async () => {
      throw new Error("bad key");
    },
  });
  assert.equal(result.signerOk, false);
  assert.equal(result.status, "modified");
});

test("a malformed or missing manifest reports unavailable rather than verified", async () => {
  for (const bad of [
    null,
    {},
    { algorithm: "sha256", base: "/tera/wallet/", files: [] },
    { algorithm: "md5", base: "/tera/wallet/", files: [{ path: "a.js", hash: "sha256-x" }] },
    { algorithm: "sha256", base: "/tera/wallet/", files: [{ path: "a.js", hash: "nope" }] },
  ]) {
    const result = await verifyManifest(bad, { fetchFile: server(source) });
    assert.equal(result.status, "unavailable", JSON.stringify(bad));
    assert.equal(badge(result).tone, "muted");
  }
});

test("a manifest cannot point the check outside the wallet directory", async () => {
  for (const path of ["../../../etc/passwd", "/etc/passwd", "a/../../b.js"]) {
    const result = await verifyManifest(
      { algorithm: "sha256", base: "/tera/wallet/", files: [{ path, hash: "sha256-x" }] },
      { fetchFile: server(source) },
    );
    assert.equal(result.status, "unavailable", path);
  }
});

test("the summary never claims more than was checked", async () => {
  const unsigned = await verifyManifest(await manifestFor(source), { fetchFile: server(source) });
  assert.match(summary(unsigned, "terawallet.app"), /not signed/);
  const signed = await verifyManifest(
    await manifestFor(source, { signer: "0xa", signature: "0xb" }),
    {
      fetchFile: server(source),
      verifySignature: async () => true,
    },
  );
  assert.match(summary(signed, "terawallet.app"), /signed by the expected key/);
  assert.match(summary(null, "terawallet.app"), /Checking/);
});

// The shipped manifest has to describe the files that are actually shipped, or
// every visitor sees a red badge for no reason.
test("the manifest committed to this repo matches the files in this repo", async () => {
  const url = new URL("../../public/tera/wallet/manifest.json", import.meta.url);
  const manifest = JSON.parse(await readFile(url, "utf8"));
  const result = await verifyManifest(manifest, {
    fetchFile: async (path) => readFile(new URL(`../../public${path}`, import.meta.url)),
  });
  assert.deepEqual(result.problems, []);
  assert.equal(result.status, "verified");
  assert.ok(result.checked >= 15, `only ${result.checked} files are covered`);
  // Every module the wallet ships must be in it, not just the ones that existed
  // when the manifest was last written. Both directories are covered: the
  // shared core the Android app also imports, and the browser-only half.
  for (const name of [
    "wallet/app.js",
    "wallet/egress.js",
    "wallet/endpoint.js",
    "wallet/integrity.js",
    "core/minimise.js",
    "core/parse.js",
    "core/ingress.js",
    "core/receipt.js",
    "core/wordlist.js",
  ])
    assert.ok(
      manifest.files.some((file) => file.path === name),
      `${name} is missing from the manifest`,
    );
  // A core module served without a hash would be logic running on two surfaces
  // with nothing published to check either against.
  assert.ok(
    manifest.files.filter((file) => file.path.startsWith("core/")).length >= 5,
    "the shared core must be covered, not just the browser half",
  );
});
