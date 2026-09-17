// Code transparency: the wallet checks its own modules against a published
// build manifest and says, on the page, which release it is running.
//
// What this proves, and what it does not, matters more than the feature:
//
//   It proves the files this page loads from the server right now match a
//   published list of hashes, and — when the manifest is signed — that the list
//   was produced by the holder of the signing key.
//
//   It does not prove the code already executing in this tab is that code, and
//   it cannot save you from an origin that has been taken over: whoever can
//   replace app.js can replace this checker too. The published hashes are the
//   part that survives that, because anyone can verify them from outside the
//   browser, against the public source.

const B64 = (bytes) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const HEX = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

async function sha256(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(digest);
}

/** Subresource-integrity spelling, so the same strings can be used as SRI. */
export async function sriDigest(data) {
  return `sha256-${B64(await sha256(data))}`;
}

/**
 * One line per file, sorted by path. The release id is derived from this, so
 * reordering or renaming entries changes the release and is caught.
 */
export function canonicalFileList(files) {
  return [...files]
    .map((file) => `${file.path} ${file.hash}`)
    .sort()
    .join("\n");
}

export async function filesHash(files) {
  const bytes = await sha256(new TextEncoder().encode(canonicalFileList(files)));
  return { sri: `sha256-${B64(bytes)}`, hex: HEX(bytes) };
}

/** A content-addressed release id: recomputable by anyone holding the files. */
export function deriveRelease(hex) {
  return `r-${hex.slice(0, 12)}`;
}

export const SHAPE_ERROR = "The build manifest is not in a shape this wallet understands.";

function malformed(manifest) {
  return (
    !manifest ||
    typeof manifest !== "object" ||
    !Array.isArray(manifest.files) ||
    manifest.files.length === 0 ||
    manifest.algorithm !== "sha256" ||
    typeof manifest.base !== "string" ||
    manifest.files.some(
      (file) =>
        typeof file?.path !== "string" ||
        typeof file?.hash !== "string" ||
        !file.hash.startsWith("sha256-") ||
        // A path that climbs out of the base directory would let a manifest
        // point the check at a file this page does not serve.
        file.path.includes("..") ||
        file.path.startsWith("/"),
    )
  );
}

/**
 * Verify the manifest against the files the server is serving.
 *
 * `fetchFile(path)` returns the bytes for one entry. `verifySignature` is
 * injected so this module stays free of any signing library and can be tested
 * without one; when it is absent the manifest is reported as unsigned rather
 * than as verified.
 */
export async function verifyManifest(manifest, options = {}) {
  if (malformed(manifest))
    return {
      status: "unavailable",
      reason: SHAPE_ERROR,
      signed: false,
      signerOk: null,
      release: "",
      builtAt: "",
      checked: 0,
      matched: 0,
      problems: [],
      files: [],
    };

  const declared = {
    release: String(manifest.release || ""),
    builtAt: String(manifest.builtAt || ""),
  };
  const problems = [];

  // The manifest is checked against itself first. An edited list that still
  // carries its original release id is a modified manifest, not a valid one.
  const recomputed = await filesHash(manifest.files);
  if (manifest.filesHash && manifest.filesHash !== recomputed.sri)
    problems.push({
      path: "manifest.json",
      kind: "list-hash",
      detail: "The file list does not match its own hash.",
    });
  if (declared.release && declared.release !== deriveRelease(recomputed.hex))
    problems.push({
      path: "manifest.json",
      kind: "release",
      detail: "The release id does not match the file list.",
    });

  let signed = false;
  let signerOk = null;
  if (manifest.signature && manifest.signer) {
    signed = true;
    if (typeof options.verifySignature !== "function") {
      signerOk = null;
      problems.push({
        path: "manifest.json",
        kind: "signature-unchecked",
        detail: "This page could not check the signature.",
      });
    } else {
      try {
        signerOk = Boolean(await options.verifySignature(manifest, options.expectedSigner));
      } catch {
        signerOk = false;
      }
      if (!signerOk)
        problems.push({
          path: "manifest.json",
          kind: "signature",
          detail: "The manifest signature did not verify against the expected signer.",
        });
    }
  }

  const files = [];
  let matched = 0;
  for (const entry of manifest.files) {
    let actual = "";
    try {
      const bytes = await options.fetchFile(`${manifest.base}${entry.path}`);
      actual = await sriDigest(bytes);
    } catch {
      problems.push({ path: entry.path, kind: "missing", detail: "This file could not be read." });
      files.push({ path: entry.path, expected: entry.hash, actual: "", ok: false });
      continue;
    }
    const ok = actual === entry.hash;
    if (ok) matched += 1;
    else
      problems.push({
        path: entry.path,
        kind: "mismatch",
        detail: "This file does not match the published hash.",
      });
    files.push({ path: entry.path, expected: entry.hash, actual, ok });
  }

  return {
    status: problems.length ? "modified" : "verified",
    reason: "",
    signed,
    signerOk,
    release: declared.release,
    builtAt: declared.builtAt,
    checked: manifest.files.length,
    matched,
    problems,
    files,
  };
}

/** The one-line badge. It never says more than the check established. */
export function badge(result) {
  if (!result) return { label: "Code check pending", tone: "muted" };
  if (result.status === "unavailable") return { label: "Code not verified", tone: "muted" };
  if (result.status === "modified") return { label: "Code does not match", tone: "fail" };
  if (result.signed && result.signerOk)
    return { label: `Signed release ${result.release}`, tone: "ok" };
  return { label: `Release ${result.release} · hashes only`, tone: "ok" };
}

/** Plain sentence for the panel, matched to what was actually checked. */
export function summary(result, host) {
  if (!result) return "Checking this wallet's modules against the published build manifest…";
  if (result.status === "unavailable")
    return `No build manifest is published at ${host}, so the modules in this page were not checked against anything.`;
  if (result.status === "modified")
    return `${result.matched} of ${result.checked} modules match the published manifest. The rest are listed below. Do not approve anything from this page until you know why.`;
  if (result.signed && result.signerOk)
    return `All ${result.checked} modules match release ${result.release}, and the manifest was signed by the expected key.`;
  if (result.signed)
    return `All ${result.checked} modules match release ${result.release}, but the manifest signature could not be checked on this page.`;
  return `All ${result.checked} modules match the published manifest for release ${result.release}. The manifest is not signed, so it proves the files are the published ones, not who published them.`;
}
