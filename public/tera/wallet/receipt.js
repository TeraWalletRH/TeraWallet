// A receipt for an assistant turn.
//
// Three things can now answer a question in this wallet: `parse.js` from the
// wallet's own source, the on-device model, and Tera's service. They differ in
// the only way an owner really cares about — whether anything left the device —
// and after the reply is on screen there is nothing to tell them apart.
//
// A receipt records which one answered, commits to the exact text that went in
// and came out, and names the published release that was running. It is the
// artefact an owner keeps, compares later, or hands to someone else.
//
// What has to be said before anything else, because it is the part a receipt is
// usually used to obscure:
//
//   A receipt cannot prove a negative. `sent: false` is the claim that matters
//   most here and it is exactly the claim a page cannot establish about itself.
//   A page that did send something can write a receipt saying it did not. What
//   actually backs that line is the published source — anyone can read
//   `parse.js` and see there is no request in it — and the browser's own
//   network panel, which is not written by this page. CLAIMS says so, and
//   `verify` marks it unverifiable rather than passing it.
//
//   The release id is self-reported in the same way. It is worth more than a
//   hash this file computes over its own source, which would be circular: the
//   release is checkable from outside the browser against the public build
//   manifest. But the page naming it is the page being asked about.
//
//   A signature binds a receipt to an address. That is all it does. It does not
//   make the negative provable, it does not make the release claim true, and it
//   does not say Tera agreed to anything — the owner's own key is what signs.
//   An unsigned receipt says these hashes were computed in some browser.

export const FORMAT = "tera-receipt/1";

/** Who answered. The distinction the whole receipt exists to record. */
export const CODE = "code";
export const DEVICE = "device";
export const SERVICE = "service";

export const ANSWERED_BY = {
  [CODE]: {
    id: CODE,
    label: "This wallet's own source",
    detail:
      "A fixed pattern matched and the answer was read out of the module named below. No model ran and no request was made.",
  },
  [DEVICE]: {
    id: DEVICE,
    label: "The on-device model",
    detail:
      "The model running in this tab produced the answer. No request was made; the message was never put into one.",
  },
  [SERVICE]: {
    id: SERVICE,
    label: "Tera's assistant service",
    detail:
      "The message was minimised on this device and sent. The receipt commits to the text that was sent, not to what you typed.",
  },
};

/** The four things a check can be. A check is never quietly omitted. */
export const PASS = "pass";
export const FAIL = "fail";
export const UNVERIFIABLE = "unverifiable";
export const SKIPPED = "skipped";

/**
 * What a receipt does and does not establish, as one list, in the order someone
 * reading a receipt would want it.
 */
export const CLAIMS = {
  proves: [
    "The reply you were shown is the reply these hashes were computed from. Anyone with the transcript can recompute them.",
    "Which of the three answered, as this page recorded it at the time.",
    "The build manifest release this page reported running, which can be checked against the published source from outside the browser.",
    "When it is signed: that the named address attested to every field above, and that none of them has been edited since.",
  ],
  cannot: [
    "That nothing was sent. No page can prove that about itself. Read the source — there is no request in the path a local answer takes — or watch your browser's own network panel, which this page does not write.",
    "That the release named is the code that actually ran. A modified page reports whatever release it likes. The published hashes are what survive that, because they are checkable without this page.",
    "That the model named is the model that ran, for the same reason.",
    "Anything at all, when it is unsigned. An unsigned receipt carries no digest, so any field in it can be edited without trace.",
    "That Tera agreed to any of it. The signature, when there is one, is the owner's own key attesting to their own record.",
  ],
};

/**
 * The first line of anything this wallet asks an owner to sign for a receipt.
 *
 * Domain separation is the whole reason it exists. A signature is a signature:
 * the key does not know what it is signing for, so two features that both ask
 * for one must produce payloads that can never be swapped. This wallet already
 * asks an owner to sign to unlock the vault and to delete stored data, and a
 * receipt signature must be useless for either.
 *
 * The other half is that the payload is readable text, not 32 raw bytes.
 * `personal_sign` prefixes it, so it can never be a valid transaction — but a
 * digest handed to a wallet also shows the owner nothing they can check. A
 * receipt's signing message says, in their wallet's own window, what it is and
 * that it moves nothing.
 */
export const DOMAIN = "Tera receipt v1";

/** Fields the digest does not cover, because they are the signature itself or
 * are already committed to by a hash inside it. */
const UNSIGNED_FIELDS = new Set(["transcript", "digest", "signature", "signer"]);

/**
 * A deterministic rendering of a receipt.
 *
 * Sorted keys and one field per line, so two browsers produce identical bytes
 * for identical content and a verifier can recompute it without guessing at
 * JSON key order. The transcript is left out on purpose: `inputHash` and
 * `outputHash` are in here and already commit to it.
 */
export function canonical(receipt) {
  return Object.keys(receipt || {})
    .filter((key) => !UNSIGNED_FIELDS.has(key))
    .sort()
    .map((key) => `${key}=${String(receipt[key])}`)
    .join("\n");
}

/** sha256 over the domain and the canonical form, in that order. */
export async function digestOf(receipt) {
  return sri(`${DOMAIN}\n${canonical(receipt)}`);
}

/**
 * The text the owner's wallet will display. It has to stand on its own: whoever
 * reads it is looking at a signing prompt, not at this page.
 */
export function signingMessage(receipt, digest) {
  const source = ANSWERED_BY[receipt?.answeredBy];
  return (
    [
      DOMAIN,
      "Signing this records what this wallet did with one message.",
      "It moves nothing, approves nothing, and cannot authorise a transaction.",
      "",
      `Answered by: ${source ? source.label : "unknown"}`,
      receipt?.module ? `Read from: ${receipt.module}` : null,
      receipt?.model ? `Model: ${receipt.model}` : null,
      receipt?.sent ? "Sent to Tera's assistant service" : "No request was made",
      `Release: ${receipt?.release || "not recorded"}`,
      `Recorded: ${receipt?.at || "not recorded"}`,
      `Receipt: ${receipt?.shortRef || ""}`,
      `Digest: ${digest}`,
    ]
      // Only the optional fields are dropped, and they are dropped as null rather
      // than as "" — `join` turns a null into a blank line, which is how an
      // omitted model put a gap in the middle of the prompt. The empty string
      // above is a deliberate blank line: it separates "this signature does
      // nothing" from the facts, in a window where someone is deciding to sign.
      .filter((line) => line !== null)
      .join("\n")
  );
}

/**
 * Sign a receipt with the owner's wallet.
 *
 * `sign(message)` is injected rather than reaching for a provider, for the same
 * reason `verify` takes `recover`: this module has no business holding a
 * connection to anything, and a signing step that can be handed a stub is a
 * signing step that can be tested.
 */
export async function sign(receipt, { signer, sign: signMessage } = {}) {
  if (typeof signMessage !== "function") throw new Error("No way to sign was provided.");
  if (!signer) throw new Error("A receipt signature has to name the address that made it.");
  const digest = await digestOf(receipt);
  const signature = await signMessage(signingMessage(receipt, digest));
  return { ...receipt, digest, signer, signature };
}

const encoder = new TextEncoder();

async function sri(text) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(String(text ?? "")));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return `sha256-${btoa(binary)}`;
}

/**
 * A short handle for a receipt, taken from the output hash.
 *
 * Long enough to name one turn in a conversation, and deliberately not long
 * enough to be mistaken for the commitment itself.
 */
export function shortRef(outputHash) {
  return String(outputHash ?? "")
    .replace(/^sha256-/, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 8)
    .toLowerCase();
}

/**
 * Build a receipt.
 *
 * `input` is the text the answering party actually saw — for the service that
 * is the minimised skeleton, not what the owner typed, because the receipt
 * describes the boundary and minimisation's whole point is that the original
 * stayed here.
 */
export async function create({
  answeredBy,
  input,
  output,
  release = "",
  integrity = "",
  module: source = "",
  model = "",
  replaced = 0,
  at = Date.now(),
} = {}) {
  if (!ANSWERED_BY[answeredBy]) throw new Error("A receipt must say which engine answered.");
  const [inputHash, outputHash] = await Promise.all([sri(input), sri(output)]);
  return {
    format: FORMAT,
    answeredBy,
    // Recorded as the page's own claim, and checked as one. `verify` will not
    // pass this line; it only ever reports it.
    sent: answeredBy === SERVICE,
    release,
    // What the page's own integrity check said at the time: "verified",
    // "modified", "unavailable". A receipt written by a page that already knew
    // it did not match the published release should say so on its face.
    integrity,
    ...(source ? { module: source } : {}),
    ...(model ? { model } : {}),
    ...(answeredBy === SERVICE ? { minimised: replaced > 0, replaced } : {}),
    inputHash,
    outputHash,
    shortRef: shortRef(outputHash),
    at: new Date(at).toISOString(),
  };
}

/**
 * The receipt plus the text it commits to.
 *
 * Kept separate from the receipt itself because they have different
 * consequences. A receipt is small and reveals a hash; a bundle contains the
 * conversation. For a turn answered on this device, exporting the bundle is the
 * first time that text leaves — which is the owner's decision to make, and
 * `EXPORT_WARNING` is what they should be reading when they make it.
 */
export function bundle(receipt, { input, output }) {
  return { ...receipt, transcript: { input: String(input ?? ""), output: String(output ?? "") } };
}

export const EXPORT_WARNING =
  "A receipt file contains the message and the reply in full. For a turn answered on this device, that text has not left this browser until now — exporting it is you sending it, and whoever you give the file to can read it.";

/**
 * What an owner needs in front of them to decide on one particular export.
 *
 * `EXPORT_WARNING` states the general case in a sentence, which is what belongs
 * in a panel read before any receipt is chosen. Once a receipt is chosen the
 * wallet knows something more exact: whether this text has ever left the device.
 * A turn answered here and a turn answered by the service produce the same file
 * and carry very different consequences, and showing an owner the wrong one of
 * those is worse than showing them nothing.
 */
export function exportNotice(receipt = {}) {
  const firstSend = !receipt.sent;
  return {
    firstSend,
    headline: firstSend
      ? "This text has never left your browser."
      : "This text was already sent when you asked.",
    detail: firstSend
      ? "The turn was answered on this device. Saving the file is the first time the message and the reply leave it."
      : "Tera's assistant service already received this message. Saving the file sends it nowhere new, but it does make a copy you can pass on.",
    consequence:
      "Anyone you give the file to can read both in full. There is no way to take it back once it is out.",
    contents: [
      { label: "Your message", detail: "The full text you typed, exactly as written." },
      { label: "The reply", detail: "The full text of the answer you were given." },
      {
        label: "Receipt details",
        detail: "Which engine answered, the build release, and the time.",
      },
      ...(receipt.signature
        ? [
            {
              label: "Your signature",
              detail: "The signature you added, and the address that made it.",
            },
          ]
        : []),
    ],
  };
}

const check = (id, label, status, detail) => ({ id, label, status, detail });

/**
 * Recheck a bundle.
 *
 * Every check reports one of four states and none are omitted. A check that
 * cannot be settled is reported as unverifiable rather than left out, because a
 * list of passes with the hard parts missing reads as a clean bill of health.
 */
export async function verify(input, { recover } = {}) {
  const data = typeof input === "string" ? safeParse(input) : input;
  if (!data || typeof data !== "object")
    return {
      ok: false,
      checks: [check("format", "Receipt format", FAIL, "Not a readable receipt.")],
    };

  const checks = [];
  checks.push(
    data.format === FORMAT
      ? check("format", "Receipt format", PASS, `Recognised as ${FORMAT}.`)
      : check("format", "Receipt format", FAIL, `Unknown format: ${String(data.format)}.`),
  );

  const transcript = data.transcript;
  if (!transcript || typeof transcript !== "object") {
    checks.push(
      check(
        "input_hash",
        "Message commitment",
        SKIPPED,
        "No transcript in this file, so there is nothing to recompute the hashes from.",
      ),
      check("output_hash", "Reply commitment", SKIPPED, "No transcript in this file."),
    );
  } else {
    const [inputHash, outputHash] = await Promise.all([
      sri(transcript.input),
      sri(transcript.output),
    ]);
    checks.push(
      inputHash === data.inputHash
        ? check(
            "input_hash",
            "Message commitment",
            PASS,
            "The message hashes to the recorded value.",
          )
        : check("input_hash", "Message commitment", FAIL, "The message does not match its hash."),
      outputHash === data.outputHash
        ? check("output_hash", "Reply commitment", PASS, "The reply hashes to the recorded value.")
        : check("output_hash", "Reply commitment", FAIL, "The reply does not match its hash."),
    );
  }

  checks.push(
    data.shortRef === shortRef(data.outputHash)
      ? check("short_ref", "Short reference", PASS, "Derived from the reply hash.")
      : check("short_ref", "Short reference", FAIL, "Does not match the reply hash."),
  );

  // The three that cannot be settled from the file, ever, by anyone.
  checks.push(
    check(
      "sent",
      "Whether anything was sent",
      UNVERIFIABLE,
      data.sent
        ? "The receipt records that this turn was sent to Tera's service. Nothing in the file establishes it either way."
        : "The receipt records that nothing was sent. No page can prove that about itself: read the published source, or your browser's network panel.",
    ),
    check(
      "release",
      "Build release",
      UNVERIFIABLE,
      data.release
        ? `Reported as ${data.release}. Check it against the published build manifest; a modified page reports whatever it likes.`
        : "No release was recorded.",
    ),
  );
  if (data.answeredBy === DEVICE)
    checks.push(
      check(
        "model",
        "Model",
        UNVERIFIABLE,
        `Reported as ${data.model || "unnamed"}. The page naming it is the page being asked about.`,
      ),
    );
  else
    checks.push(check("model", "Model", SKIPPED, "No on-device model was involved in this turn."));

  // The digest is what a signature is over, so it is checked whether or not one
  // is present: a receipt carrying a digest that does not match its own fields
  // has been edited since it was written, signed or not.
  if (data.digest) {
    const recomputed = await digestOf(data);
    checks.push(
      recomputed === data.digest
        ? check("digest", "Field commitment", PASS, "Every recorded field hashes to the digest.")
        : check(
            "digest",
            "Field commitment",
            FAIL,
            "A field has been changed since this receipt was written.",
          ),
    );
  } else {
    checks.push(
      check(
        "digest",
        "Field commitment",
        SKIPPED,
        "This receipt is unsigned, so it carries no digest over its fields. Anything in it could have been edited without trace.",
      ),
    );
  }

  if (!data.signature || !data.signer)
    checks.push(
      check(
        "signature",
        "Signature",
        SKIPPED,
        "Unsigned. It says these hashes were computed in some browser, not whose.",
      ),
    );
  else if (typeof recover !== "function")
    checks.push(
      check(
        "signature",
        "Signature",
        UNVERIFIABLE,
        `Signed by ${data.signer}, but nothing here can recover an address to check it against.`,
      ),
    );
  else {
    let recovered = "";
    try {
      recovered = String((await recover(signingMessage(data, data.digest), data.signature)) || "");
    } catch {
      recovered = "";
    }
    checks.push(
      recovered && recovered.toLowerCase() === String(data.signer).toLowerCase()
        ? check(
            "signature",
            "Signature",
            PASS,
            `Recovers to ${data.signer}. That address attests to this receipt, and to nothing beyond it.`,
          )
        : check(
            "signature",
            "Signature",
            FAIL,
            recovered
              ? `Recovers to ${recovered}, which is not the address named in the receipt.`
              : "The signature could not be recovered.",
          ),
    );
  }

  // The two directions are not worth the same, and are not reported the same.
  //
  // A page admitting it did not match its published release is credible: it is
  // an admission against interest, and nobody forges one. A page claiming it
  // did match is the ordinary self-report, and a modified page would make the
  // same claim. So "modified" fails the receipt outright and "verified" is only
  // ever reported, never passed.
  if (data.integrity === "modified")
    checks.push(
      check(
        "integrity",
        "Page integrity at the time",
        FAIL,
        "This receipt was written by a page that did not match its published release.",
      ),
    );
  else if (data.integrity === "verified")
    checks.push(
      check(
        "integrity",
        "Page integrity at the time",
        UNVERIFIABLE,
        "The page reported matching its published release when this was written. That is the page's own report about itself, and a modified page would report the same. Check the release against the published manifest from outside the browser.",
      ),
    );
  else
    checks.push(
      check(
        "integrity",
        "Page integrity at the time",
        SKIPPED,
        "The page could not check itself against a published release when this was written.",
      ),
    );

  return { ok: !checks.some((entry) => entry.status === FAIL), checks };
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Counts for a one-line summary, so a caller never has to tally them by hand. */
export function tally(checks = []) {
  return {
    pass: checks.filter((entry) => entry.status === PASS).length,
    failed: checks.filter((entry) => entry.status === FAIL).length,
    unverifiable: checks.filter((entry) => entry.status === UNVERIFIABLE).length,
    skipped: checks.filter((entry) => entry.status === SKIPPED).length,
  };
}
