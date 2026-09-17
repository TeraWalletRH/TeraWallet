import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  DEVICE,
  SERVICE,
  ENGINES,
  LIMITS,
  WEIGHTS_LIMITS,
  REQUIREMENTS,
  MANIFEST_KIND,
  SYSTEM_PROMPT,
  EngineError,
  capabilities,
  route,
  downloadPlan,
  verifyWeights,
  attribution,
  buildTurn,
  screenReply,
  isDegenerate,
  FABRICATION,
} from "../../public/tera/wallet/engine.js";

// The module hashes with Web Crypto, which node exposes under a different name.
globalThis.crypto ??= webcrypto;
globalThis.btoa ??= (binary) => Buffer.from(binary, "binary").toString("base64");

const able = { Worker: () => {}, WebAssembly: {}, crypto: { subtle: {} }, caches: {} };

const digest = async (bytes) => {
  const hash = await webcrypto.subtle.digest("SHA-256", bytes);
  return `sha256-${Buffer.from(hash).toString("base64")}`;
};

const manifest = async (overrides = {}) => {
  const weights = new Uint8Array([1, 2, 3, 4]);
  const tokenizer = new Uint8Array([9, 9]);
  return {
    published: {
      manifest: MANIFEST_KIND,
      version: 1,
      model: "SmolLM2-135M-Instruct",
      revision: "12fd25f77366",
      algorithm: "sha256",
      files: [
        { path: "onnx/model_q4.onnx", hash: await digest(weights), bytes: 4 },
        { path: "tokenizer.json", hash: await digest(tokenizer), bytes: 2 },
      ],
      ...overrides,
    },
    bytes: { "onnx/model_q4.onnx": weights, "tokenizer.json": tokenizer },
  };
};

const reader = (bytes) => async (path) => {
  if (!(path in bytes)) throw new Error("missing");
  return bytes[path];
};

test("a question the owner asked to be answered here is never sent instead", () => {
  // The whole feature. Falling back to the network when the model is not ready
  // is the ordinary, helpful behaviour and it would silently undo the promise.
  const notReady = route({ mode: "chat", engine: DEVICE, ready: false });
  assert.equal(notReady.blocked, true);
  assert.equal(notReady.engine, null, "no engine may be chosen for it");
  assert.match(notReady.reason, /not sent/i);

  const unsupported = route({ mode: "chat", engine: DEVICE, ready: true, supported: false });
  assert.equal(unsupported.blocked, true);
  assert.equal(unsupported.engine, null);
  assert.match(unsupported.reason, /nothing is sent/i);
});

test("a ready on-device engine answers the question here", () => {
  const result = route({ mode: "chat", engine: DEVICE, ready: true });
  assert.equal(result.engine, DEVICE);
  assert.equal(result.blocked, false);
  assert.equal(result.forced, false);
});

test("preparing a proposal always goes to the service, and says why", () => {
  // A proposal is a typed intent the five gates evaluate. Answering one from a
  // model with no registry data would produce an unchecked intent.
  for (const engine of [DEVICE, SERVICE]) {
    const result = route({ mode: "propose", engine, ready: true });
    assert.equal(result.engine, SERVICE);
    assert.equal(result.forced, true);
    assert.equal(result.blocked, false);
    assert.match(result.reason, /registry/i);
    assert.match(result.reason, /gates/i);
  }
});

test("the service engine is the default and is never blocked", () => {
  const result = route();
  assert.equal(result.engine, SERVICE);
  assert.equal(result.blocked, false);
});

test("capabilities disqualify a browser that cannot run the engine", () => {
  assert.equal(capabilities(able).supported, true);
  assert.equal(capabilities(able).missing.length, 0);

  const noWorker = capabilities({ ...able, Worker: undefined });
  assert.equal(noWorker.supported, false);
  assert.match(noWorker.reason, /Web Workers/);

  const noCrypto = capabilities({ ...able, crypto: {} });
  assert.equal(noCrypto.supported, false, "weights cannot be checked without Web Crypto");
});

test("missing cache storage costs a repeated download, not the feature", () => {
  const result = capabilities({ ...able, caches: undefined });
  assert.equal(result.supported, true);
  assert.equal(result.missing.length, 1);
  assert.equal(result.missing[0].id, "cache");
});

test("weights that match the published digests verify", async () => {
  const { published, bytes } = await manifest();
  const result = await verifyWeights(published, reader(bytes));
  assert.equal(result.ok, true);
  assert.equal(result.failed.length, 0);
  assert.equal(result.files.length, 2);
  assert.equal(result.revision, "12fd25f77366");
});

test("a single altered byte fails the whole check", async () => {
  const { published, bytes } = await manifest();
  const result = await verifyWeights(
    published,
    reader({ ...bytes, "onnx/model_q4.onnx": new Uint8Array([1, 2, 3, 5]) }),
  );
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.failed.map((file) => file.path),
    ["onnx/model_q4.onnx"],
  );
});

test("a file that cannot be read fails rather than being skipped", async () => {
  const { published, bytes } = await manifest();
  delete bytes["tokenizer.json"];
  const result = await verifyWeights(published, reader(bytes));
  assert.equal(result.ok, false);
  assert.equal(result.failed[0].path, "tokenizer.json");
});

test("a manifest of the wrong kind or algorithm is refused outright", async () => {
  const { bytes } = await manifest();
  await assert.rejects(
    () => verifyWeights({ manifest: "something else", algorithm: "sha256" }, reader(bytes)),
    EngineError,
  );
  const wrongAlgorithm = await manifest({ algorithm: "md5" });
  await assert.rejects(() => verifyWeights(wrongAlgorithm.published, reader(bytes)), EngineError);
  const empty = await manifest({ files: [] });
  await assert.rejects(() => verifyWeights(empty.published, reader(bytes)), EngineError);
});

test("the download is described in the unit the owner decides in", async () => {
  const plan = downloadPlan({
    model: "SmolLM2-135M-Instruct",
    files: [{ bytes: 100_000_000 }, { bytes: 5_000_000 }],
  });
  assert.equal(plan.files, 2);
  assert.equal(plan.bytes, 105_000_000);
  assert.equal(plan.megabytes, 105);
  assert.equal(downloadPlan(null).bytes, 0);
});

test("the limits say what the model cannot do, not what is still to be built", () => {
  const text = LIMITS.join(" ").toLowerCase();
  assert.ok(text.includes("cannot prepare a proposal"), "the proposal limit must be stated");
  assert.ok(text.includes("no gate"), "it must say the answers pass through no gate");
  assert.ok(text.includes("cannot read the chain"), "it must say it cannot read the chain");
  // A privacy feature that is also sold as better is the failure mode here.
  assert.ok(
    text.includes("weaker one that is private"),
    "it must not imply the on-device model is better",
  );
  for (const line of LIMITS) assert.ok(!/coming soon|for now|yet\b/i.test(line), line);
});

test("the cost of the one-time download is stated, not implied", () => {
  const text = WEIGHTS_LIMITS.join(" ").toLowerCase();
  assert.ok(text.includes("no party is added"), "self-hosting's benefit must be concrete");
  assert.ok(text.includes("tera does learn"), "what Tera still learns must be admitted");
  assert.ok(
    text.includes("does not prove the model is any good"),
    "the digest check must not be inflated into a quality claim",
  );
});

test("each engine states what it sends", () => {
  assert.equal(ENGINES[DEVICE].sends.startsWith("Nothing"), true);
  assert.match(ENGINES[SERVICE].sends, /network address/i);
  assert.match(ENGINES[SERVICE].quality, /only engine that can prepare a proposal/i);
  assert.equal(REQUIREMENTS.length, 4);
});

test("a reply is attributed to the engine that produced it", () => {
  assert.match(attribution(DEVICE), /Nothing was sent/);
  assert.match(attribution(SERVICE), /Tera's assistant service/);
});

test("a turn carries the current message and no history", () => {
  const turn = buildTurn("  what does the policy check do?  ");
  assert.equal(turn.messages.length, 2);
  assert.equal(turn.messages[0].role, "system");
  assert.equal(turn.messages[0].content, SYSTEM_PROMPT);
  assert.equal(turn.messages[1].role, "user");
  assert.equal(turn.messages[1].content, "what does the policy check do?");
  assert.equal(turn.maxNewTokens, 256);
  assert.throws(() => buildTurn("   "), EngineError);
});

test("the model is told to decline rather than invent", () => {
  const prompt = SYSTEM_PROMPT.toLowerCase();
  assert.ok(prompt.includes("never invent an address"), "inventing values is the failure mode");
  assert.ok(prompt.includes("cannot prepare"), "it must know it cannot prepare a transaction");
  assert.ok(prompt.includes("nothing they type is sent anywhere"));
});

// These two are verbatim from a smoke run of the published weights. They are
// the reason the screen exists, so they are the test.
const INVENTED_BALANCE = "Your USDG balance is $100.";
const REPEATED = [
  "Prompt minimisation is a feature in Tera Wallet that allows you to see the owner's balances.",
  "- Promptming the owner to show the balance of the account they own.",
  "- Promptming the owner to show the balance of the account they own.",
  "- Promptming the owner to show the balance of the account they own.",
].join("\n");

test("an invented balance never reaches the owner", () => {
  const result = screenReply(INVENTED_BALANCE);
  assert.equal(result.withheld, true);
  assert.ok(!result.text.includes("$100"), "the invented figure must not be shown at all");
  assert.match(result.text, /would have been invented/);
});

test("every kind of fabricated specific is withheld", () => {
  for (const [reply, reason] of [
    ["Send it to 0x8ba1f109551bd432803012645ac136ddd64dba72 and you are done.", "address"],
    ["The transfer cost 0.0042 ETH in fees.", "currency"],
    ["You have 1,250 USDG available.", "currency"],
    ["That will cost about $42.50.", "currency"],
    ["Your available balance is quite healthy.", "balance"],
  ]) {
    const result = screenReply(reply);
    assert.equal(result.withheld, true, reply);
    assert.equal(result.reason, reason, reply);
  }
});

test("a reply that collapses into repetition is withheld", () => {
  assert.equal(isDegenerate(REPEATED), true);
  assert.equal(screenReply(REPEATED).withheld, true);
  assert.equal(screenReply(REPEATED).reason, "degenerate");
});

test("an ordinary explanation passes through untouched", () => {
  // The screen must not eat the answers the engine exists to give.
  const good =
    "Prompt minimisation replaces addresses, references and figures with placeholders on your device before a message is sent, and the reply is re-hydrated here so you read your own values back.";
  const result = screenReply(good);
  assert.equal(result.withheld, false);
  assert.equal(result.text, good);
  assert.equal(result.reason, "");

  const gates =
    "There are five checks: asset registry, eligibility preflight, policy, risk, and owner approval. Each one can only narrow what is allowed.";
  assert.equal(screenReply(gates).withheld, false, gates);
});

test("an empty reply is reported rather than shown as an answer", () => {
  assert.equal(screenReply("").withheld, true);
  assert.equal(screenReply("   ").reason, "empty");
});

test("short repetition is not mistaken for collapse", () => {
  assert.equal(isDegenerate("Yes.\nYes.\nYes."), false, "short lines are not evidence");
  assert.equal(isDegenerate("A single sensible sentence about the policy check."), false);
  assert.equal(FABRICATION.length, 3);
});
