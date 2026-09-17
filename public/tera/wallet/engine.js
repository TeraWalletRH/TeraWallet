// The on-device assistant engine.
//
// Prompt minimisation removes the values from a message. Oblivious HTTP removes
// the network address the message arrives on. Both still send something. This
// removes the send.
//
// A small language model runs in a worker in this tab. The message never enters
// a request, so there is nothing for Tera, a relay, or a model provider to
// receive, log, or be compelled to hand over. That is the whole claim, and it
// is worth stating exactly because the surrounding claims are easy to inflate:
//
//   It is true only after the weights are on this device. Fetching them is a
//   request to Tera like any other. Tera already serves this page, so no new
//   party learns anything — but Tera does learn that this browser asked for the
//   model, once, and WEIGHTS_LIMITS says so rather than leaving it implied.
//
//   The weights are served from this origin, not from a model hub. That is a
//   deliberate cost: a hub would be free and would have added a party that sees
//   your network address and which model you took. Self-hosting means the
//   egress panel gains no row.
//
//   The model is small. A 135M-parameter model is not the service assistant and
//   must never be presented as it. It is wrong more often, it knows nothing
//   about your holdings, and it cannot see the asset registry. LIMITS is not
//   marketing hedging; it is the operating envelope.
//
//   It cannot prepare a proposal. A proposal is a typed intent built from
//   Tera's registry and eligibility data and evaluated by the five gates. A
//   model with none of that data cannot produce one, so `route` sends every
//   proposal to the service and says why. A local engine that quietly answered
//   with an unchecked intent would be the most dangerous thing in this file.

/** SHA-256 of a byte array, formatted the way the build manifest writes it. */
async function sri(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return `sha256-${btoa(binary)}`;
}

export const MANIFEST_KIND = "Tera on-device model";

export const DEVICE = "device";
export const SERVICE = "service";

export const ENGINES = {
  [DEVICE]: {
    id: DEVICE,
    label: "On this device",
    detail:
      "A small model runs in this tab. The message is not put into a request, so nothing about it leaves.",
    // What the owner is actually buying, in one line each.
    sends: "Nothing. No request is made when you ask a question this way.",
    quality:
      "A small model. It will be wrong more often than the service assistant, and it cannot see the asset registry or your balances.",
  },
  [SERVICE]: {
    id: SERVICE,
    label: "Tera's assistant service",
    detail:
      "The message is minimised on this device, then sent. With Oblivious HTTP on, the network address is split away from the request.",
    sends:
      "A minimised message, and — unless it is sealed to the gateway through a relay — the network address this browser connects from.",
    quality:
      "A larger model with Tera's registry and eligibility data behind it. It is the only engine that can prepare a proposal.",
  },
};

/**
 * What the on-device engine cannot do. Every line here is a limit of the thing
 * itself, not of this build, so none of them are fixed by shipping more code.
 */
export const LIMITS = [
  "The model is small. It answers general questions about how this wallet works; it is not a better assistant that happens to be private, it is a weaker one that is private.",
  "It cannot prepare a proposal. Preparing one needs Tera's asset registry, eligibility preflight and policy bundle, and none of that is on this device.",
  "Its answers pass through no gate. The five checks evaluate a prepared transaction, and nothing prepared on this device is ever submitted, so there is nothing for them to check.",
  "It cannot read the chain. Balances, receipts and contract state come from your wallet's provider or your own endpoint, not from the model.",
  "It does not know anything that happened after its weights were built, and it has no memory between reloads.",
  "It will sometimes try to answer a question about your money with an invented figure. Replies containing an amount, an address or a balance are withheld before you see them, because this model has no way to know any of them.",
];

/**
 * What the one-time weight download does cost, said plainly. Kept separate from
 * LIMITS because these are true of the fetch, not of the model.
 */
export const WEIGHTS_LIMITS = [
  "The weights are served from this origin, so no party is added to the egress panel. Tera does learn that this browser fetched the model, on the day it did.",
  "The download is large and happens once. It is stored by the browser for this origin and is removed by the wipe control along with everything else.",
  "The bytes are checked against the published digest before the model is built from them. That proves they match what Tera published; it does not prove the model is any good.",
];

/** Everything the on-device engine needs from the browser to run at all. */
export const REQUIREMENTS = [
  { id: "worker", label: "Web Workers", detail: "The model runs off the main thread." },
  { id: "wasm", label: "WebAssembly", detail: "The runtime is compiled to WebAssembly." },
  {
    id: "subtle",
    label: "Web Crypto",
    detail: "Used to check the weights before they are loaded.",
  },
  {
    id: "cache",
    label: "Cache storage",
    detail: "Keeps the weights so the download happens once.",
  },
];

/**
 * Which requirements this browser actually meets. `scope` is injected so this
 * is testable without a browser, which is the only reason it is a parameter.
 */
export function capabilities(scope = globalThis) {
  const has = {
    worker: typeof scope.Worker === "function",
    wasm: typeof scope.WebAssembly === "object" && scope.WebAssembly !== null,
    subtle: Boolean(scope.crypto?.subtle),
    cache: typeof scope.caches === "object" && scope.caches !== null,
  };
  const missing = REQUIREMENTS.filter((entry) => !has[entry.id]);
  return {
    ...has,
    // Cache storage only costs a repeated download, so it is not disqualifying.
    supported: has.worker && has.wasm && has.subtle,
    missing,
    reason: missing.length
      ? `This browser is missing ${missing.map((entry) => entry.label).join(", ")}.`
      : "",
  };
}

export class EngineError extends Error {}

/**
 * Where a message is going to be answered, and why.
 *
 * The one rule this function exists to hold: an owner who chose the on-device
 * engine never has a message sent because the engine was not ready. Falling
 * back to the network would be the ordinary, helpful thing to do and it would
 * betray the entire feature, so a message that cannot be answered here is not
 * answered at all.
 */
export function route({ mode = "chat", engine = SERVICE, ready = false, supported = true } = {}) {
  if (mode === "propose")
    return {
      engine: SERVICE,
      blocked: false,
      // Said as a property of proposals, not as a shortcoming of this build.
      reason:
        "A proposal is built from Tera's asset registry and eligibility data and checked by the five gates. That cannot happen on this device, so preparing one always goes to the service.",
      forced: true,
    };
  if (engine !== DEVICE) return { engine: SERVICE, blocked: false, reason: "", forced: false };
  if (!supported)
    return {
      engine: null,
      blocked: true,
      reason:
        "This browser cannot run the on-device engine, and nothing is sent in its place. Switch to Tera's assistant service if you want an answer.",
      forced: false,
    };
  if (!ready)
    return {
      engine: null,
      blocked: true,
      reason:
        "The model is not on this device yet, and your message was not sent instead. Load it below, or switch to Tera's assistant service.",
      forced: false,
    };
  return { engine: DEVICE, blocked: false, reason: "", forced: false };
}

/** Bytes the owner is being asked to download, from the published manifest. */
export function downloadPlan(manifest) {
  const files = Array.isArray(manifest?.files) ? manifest.files : [];
  const bytes = files.reduce((total, file) => total + (Number(file.bytes) || 0), 0);
  return {
    files: files.length,
    bytes,
    // Megabytes, because that is the unit the owner is deciding in.
    megabytes: Math.round(bytes / 100000) / 10,
    model: manifest?.model || "",
    revision: manifest?.revision || "",
  };
}

/**
 * Check a published weight manifest before anything is built from it.
 *
 * This is a stronger claim than the one `integrity.js` can make about the
 * wallet's own modules. There, the code being checked is already running. Here
 * the bytes are inert until they are handed to the runtime, so the check
 * happens first and a mismatch means the model is never constructed.
 */
export async function verifyWeights(manifest, read) {
  if (!manifest || manifest.manifest !== MANIFEST_KIND)
    throw new EngineError("This is not a Tera model manifest.");
  if (manifest.algorithm !== "sha256")
    throw new EngineError("Unsupported digest algorithm in the model manifest.");
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  if (!files.length) throw new EngineError("The model manifest lists no files.");
  const checked = [];
  for (const file of files) {
    let bytes;
    try {
      bytes = await read(file.path);
    } catch {
      checked.push({ path: file.path, ok: false, detail: "Could not be read." });
      continue;
    }
    const actual = await sri(bytes);
    checked.push({
      path: file.path,
      ok: actual === file.hash,
      detail: actual === file.hash ? "Matches the published digest." : "Does not match.",
    });
  }
  const failed = checked.filter((entry) => !entry.ok);
  return {
    ok: failed.length === 0,
    files: checked,
    failed,
    model: manifest.model || "",
    revision: manifest.revision || "",
  };
}

/**
 * What the on-device model must never be allowed to say.
 *
 * This is not a style filter. A small model asked "what is my USDG balance?"
 * answers "Your USDG balance is $100." — confidently, in the wallet's own
 * voice, with a number it invented. It is instructed not to, and at this size
 * it cannot reliably obey; the system prompt is a request, and this is the
 * enforcement.
 *
 * The rule it enforces is one the engine can be certain about: this model has
 * no access to balances, addresses, transactions or prices, so any figure or
 * identifier in its output is fabricated by definition. Nothing is redacted in
 * place, because a reply that invented one number has not earned trust in the
 * rest of its sentences — the whole answer is withheld and the question is
 * pointed at the engine that can actually see the data.
 */
export const FABRICATION = [
  {
    id: "address",
    // An address or transaction hash. It cannot read the chain, so it has none.
    pattern: /0x[\da-f]{6,}/i,
    label: "an address or transaction reference",
  },
  {
    id: "currency",
    pattern: /(?:[$£€]\s?\d)|(?:\b\d[\d,]*(?:\.\d+)?\s*(?:USD|USDG|ETH|TERA|SPCX)\b)/i,
    label: "an amount of money",
  },
  {
    id: "balance",
    pattern: /\b(?:your|the)\s+(?:\w+\s+){0,2}balance\s+is\b/i,
    label: "a balance",
  },
];

/** A reply that has collapsed into repeating itself, which this model also does. */
export function isDegenerate(text) {
  const lines = String(text)
    .split("\n")
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line.length > 12);
  if (lines.length < 3) return false;
  const counts = new Map();
  for (const line of lines) counts.set(line, (counts.get(line) || 0) + 1);
  return [...counts.values()].some((count) => count >= 3);
}

export const WITHHELD_FABRICATION =
  "The on-device model produced %s. It cannot see your balances, the chain, or the asset registry, so any figure or address in its answer would have been invented — the answer was withheld here rather than shown to you. Ask Tera's assistant service if you need this.";

export const WITHHELD_DEGENERATE =
  "The on-device model lost the thread and began repeating itself, so its answer was withheld. Try a shorter question, or ask Tera's assistant service.";

/**
 * Screen a reply before the owner reads it. Returns the text to show and
 * whether it was withheld, so the page can label it rather than pass it off as
 * an answer.
 */
export function screenReply(text) {
  const reply = String(text ?? "").trim();
  if (!reply)
    return { text: "The on-device model returned nothing.", withheld: true, reason: "empty" };
  const found = FABRICATION.find((rule) => rule.pattern.test(reply));
  if (found)
    return {
      text: WITHHELD_FABRICATION.replace("%s", found.label),
      withheld: true,
      reason: found.id,
    };
  if (isDegenerate(reply))
    return { text: WITHHELD_DEGENERATE, withheld: true, reason: "degenerate" };
  return { text: reply, withheld: false, reason: "" };
}

/** A short, honest label for the engine that produced a given reply. */
export function attribution(engineId) {
  return engineId === DEVICE
    ? "Answered on this device. Nothing was sent."
    : "Answered by Tera's assistant service.";
}

/**
 * The turn the worker is asked to run. Kept as a pure function so what the
 * model is given can be asserted in a test rather than read out of a worker.
 *
 * Only the current message is included. Carrying the whole conversation would
 * make every later turn depend on every earlier one, which is a sensible thing
 * for a chat and a poor thing for something an owner is told is disposable.
 */
export function buildTurn(message, { system = SYSTEM_PROMPT, maxNewTokens = 256 } = {}) {
  const text = String(message ?? "").trim();
  if (!text) throw new EngineError("Type a message first.");
  return {
    messages: [
      { role: "system", content: system },
      { role: "user", content: text },
    ],
    maxNewTokens,
  };
}

/**
 * What the on-device model is told about itself. It is instructed to decline
 * rather than guess on anything it cannot know, because a small model inventing
 * a balance or an address is the failure mode that matters here.
 */
export const SYSTEM_PROMPT = [
  "You are the offline assistant inside Tera Wallet. You run on the owner's own device and nothing they type is sent anywhere.",
  "You can explain how the wallet works: the five checks, the owner approval boundary, prompt minimisation, the encrypted vault, recovery shares, and what each privacy control does and does not do.",
  "You cannot see the owner's balances, their transaction history, the asset registry, or the network. If a question needs any of those, say plainly that you cannot see it and that Tera's assistant service can.",
  "You cannot prepare, check, or approve a transaction. Say so if asked.",
  "Never invent an address, an amount, a balance, or a transaction hash. If you do not know something, say you do not know.",
  "Be brief and concrete.",
].join(" ");
