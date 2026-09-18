// The approved-build registry.
//
// A receipt names the release that produced it. Until now the check on that
// name was always "unproven", with the advice to compare it against the
// published build manifest — advice with nothing behind it, since there was no
// published list of which releases were ever approved. A receipt could name
// r-0000000000 and read exactly as well as one naming a real build.
//
// This is that list: every release Tera has shipped, with its file hash and the
// date it was published, signed by the same key that signs a build manifest.
//
// Where it is worth something, and where it is not:
//
//   Inside the wallet it is worth very little, and says so. A page that would
//   lie about its release will also lie about the registry it fetched, because
//   it made both requests. `releaseCheck` returns `unverifiable` there however
//   well the lookup went, and the wording explains why rather than implying the
//   owner got a second opinion.
//
//   Outside the wallet it is the whole point. The command-line verifier and the
//   offline page run somewhere Tera does not control, against a registry the
//   reader fetched themselves. There a match is a real `pass`, and a miss is a
//   real `fail`: a receipt naming a build that was never published is evidence,
//   not a curiosity.
//
// What it still cannot do, which is the same limit the build manifest has: it
// establishes that a release was published, never that the page in front of you
// is running it. Only hashes checked from outside the browser do that.
//
// On-chain anchoring is deliberately not here. Publishing these entries to a
// contract would stop them being rewritten quietly, which is a real gain over a
// file Tera serves — but it is a different build with a deployment behind it,
// and shipping the file first is what makes the on-chain version checkable
// against something rather than being the only copy.

import { PASS, FAIL, UNVERIFIABLE, SKIPPED } from "./verdict.js";

export const KIND = "Tera approved builds";

/** Where this registry was obtained, which decides what a match is worth. */
export const FROM_PAGE = "page";
export const INDEPENDENT = "independent";

export class RegistryError extends Error {}

const isRelease = (value) => typeof value === "string" && /^r-[\da-f]{12}$/.test(value);

/**
 * Read a registry document, without checking who signed it.
 *
 * Shape only. `verifyRegistry` is what establishes authorship, and the two are
 * separate so a caller cannot accidentally treat a well-formed document as an
 * authentic one.
 */
export function parseRegistry(input) {
  const doc = typeof input === "string" ? safeParse(input) : input;
  if (!doc || typeof doc !== "object") throw new RegistryError("This is not a readable registry.");
  if (doc.registry !== KIND) throw new RegistryError("This is not a Tera build registry.");
  if (doc.algorithm !== "sha256")
    throw new RegistryError("Unsupported digest algorithm in the registry.");
  if (!Number.isFinite(Date.parse(doc.publishedAt || "")))
    throw new RegistryError("The registry has no publication date, so its age cannot be judged.");
  const builds = Array.isArray(doc.builds) ? doc.builds : [];
  if (!builds.length) throw new RegistryError("The registry lists no builds.");
  for (const build of builds) {
    if (!isRelease(build?.release))
      throw new RegistryError(`Not a release id: ${String(build?.release)}`);
    if (typeof build.filesHash !== "string" || !build.filesHash.startsWith("sha256-"))
      throw new RegistryError(`Build ${build.release} has no file hash.`);
  }
  return { ...doc, builds };
}

/** The message the registry signer signs. Domain-separated like every other. */
export const DOMAIN = "Tera build registry v1";

export function signingMessage(doc) {
  const builds = [...(doc.builds || [])]
    .map((build) => `${build.release} ${build.filesHash}`)
    .sort()
    .join("\n");
  return `${DOMAIN}\n${doc.publishedAt || ""}\n${builds}`;
}

/**
 * Establish who published a registry.
 *
 * `expectedSigner` is required. A registry carrying a self-consistent signature
 * proves only that somebody signed it, which is the same mistake the build
 * manifest's verifier was written to avoid.
 */
export async function verifyRegistry(doc, { recover, expectedSigner } = {}) {
  const parsed = parseRegistry(doc);
  if (!parsed.signature || !parsed.signer)
    return { ok: false, signed: false, reason: "The registry is unsigned." };
  if (typeof recover !== "function")
    return { ok: false, signed: true, reason: "Nothing here can recover a signature." };
  if (!expectedSigner)
    return {
      ok: false,
      signed: true,
      reason: "No expected signer was given, so a signature proves only that somebody signed it.",
    };
  let recovered = "";
  try {
    recovered = String((await recover(signingMessage(parsed), parsed.signature)) || "");
  } catch {
    recovered = "";
  }
  const matches =
    recovered &&
    recovered.toLowerCase() === String(parsed.signer).toLowerCase() &&
    recovered.toLowerCase() === String(expectedSigner).toLowerCase();
  return {
    ok: Boolean(matches),
    signed: true,
    signer: parsed.signer,
    reason: matches
      ? ""
      : `Signed by ${recovered || "nobody recoverable"}, not by the expected key.`,
  };
}

/** The entry for one release, or null. */
export function lookup(doc, release) {
  const builds = Array.isArray(doc?.builds) ? doc.builds : [];
  return builds.find((build) => build.release === release) || null;
}

/**
 * The receipt's release check, given whatever the caller could obtain.
 *
 * `origin` is the honest half of this function. The same lookup, against the
 * same registry, means something different depending on who fetched it, and
 * collapsing that distinction would turn the weakest case into the reassuring
 * one.
 */
export function releaseCheck(receipt, registry, { origin = FROM_PAGE, authentic = false } = {}) {
  const release = receipt?.release || "";
  if (!release)
    return {
      id: "release",
      label: "Build release",
      status: UNVERIFIABLE,
      detail: "No release was recorded in this receipt.",
    };

  if (!registry)
    return {
      id: "release",
      label: "Build release",
      status: UNVERIFIABLE,
      detail: `Reported as ${release}. No approved-build registry was available to check it against.`,
    };

  const entry = lookup(registry, release);

  if (!entry) {
    // A release can be absent for two reasons that deserve opposite answers.
    //
    // It was never published, which is evidence of a forged receipt — or your
    // copy of the list simply predates it, which is evidence of nothing except
    // that the copy is old. The first shipped without the second, so a reader
    // holding last week's registry got the strongest accusation this system
    // makes, about a receipt that was fine.
    //
    // The registry records when it was published and the receipt records when
    // it was written. When the receipt is the newer of the two, absence is
    // uninformative and saying so is the whole point of having a fourth state.
    const written = Date.parse(receipt?.at || "");
    const listed = Date.parse(registry.publishedAt || "");
    if (!Number.isFinite(written) || !Number.isFinite(listed))
      return {
        id: "release",
        label: "Build release",
        status: UNVERIFIABLE,
        stale: true,
        detail: `${release} is not in this registry, and the two dates needed to tell a stale list from a forged release could not be read. Absence alone does not establish either.`,
      };
    if (written > listed)
      return {
        id: "release",
        label: "Build release",
        status: UNVERIFIABLE,
        stale: true,
        detail: `${release} is not in this registry, but the registry was published ${registry.publishedAt} and this receipt was written afterwards, on ${receipt.at}. A list older than the receipt cannot say whether the build was published. Fetch a current registry and check again.`,
      };
    return {
      id: "release",
      label: "Build release",
      status: FAIL,
      stale: false,
      detail: `This receipt names ${release}, which is not in the approved-build registry — and the registry was published ${registry.publishedAt}, after this receipt was written. The build it names was never published.`,
    };
  }

  if (!authentic)
    return {
      id: "release",
      label: "Build release",
      status: UNVERIFIABLE,
      detail: `${release} appears in a registry, but the registry's signature could not be established. An unsigned list is a list anybody could have written.`,
    };

  if (origin !== INDEPENDENT)
    return {
      id: "release",
      label: "Build release",
      status: UNVERIFIABLE,
      detail: `${release} is in the signed registry, and this page fetched that registry itself. A page that would misreport its release would also misreport the list it checked against, so this is not a second opinion. Run the offline verifier against a registry you fetched yourself.`,
    };

  return {
    id: "release",
    label: "Build release",
    status: PASS,
    detail: `${release} is in the signed approved-build registry, published ${entry.publishedAt || "at an unrecorded date"}. That establishes the release exists — not that the page which wrote this receipt was running it.`,
  };
}

/** What the registry does not establish, for the panel that offers it. */
export const LIMITS = [
  "It lists the releases Tera published. It does not establish that the page which wrote a receipt was running one of them — only hashes checked from outside the browser do that.",
  "Checked from inside the wallet it is not a second opinion: the same page fetched both the receipt and the list. The offline verifier, run against a registry you fetched yourself, is where a match means something.",
  "A release missing from a registry older than the receipt means the copy is stale, not that the build was forged. Fetch a current one before reading absence as evidence.",
  "It is a file Tera serves, so Tera can rewrite it. What stops that quietly is that the entries are signed and dated and people keep copies — not the file itself.",
];

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export { PASS, FAIL, UNVERIFIABLE, SKIPPED };
