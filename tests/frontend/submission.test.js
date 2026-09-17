import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MODELS,
  SUBMISSION_LIMITS,
  WHY_FIXED,
  describeSubmission,
} from "../../public/tera/wallet/submission.js";

const path = (overrides = {}) =>
  describeSubmission({ explorerHost: "scan.example.test", ...overrides });
const hop = (result, id) => result.hops.find((entry) => entry.id === id);

test("this chain is described as sequenced, not as having a public queue", () => {
  const result = path();
  assert.equal(result.model.id, "sequenced");
  assert.equal(result.sequenced, true);
  assert.ok(hop(result, "sequencer"), "the sequencer must be on the path");
  assert.equal(hop(result, "mempool"), undefined, "there is no public mempool on this chain");
});

test("the absence of a public queue is never presented as privacy", () => {
  // This is the whole point of the module: the comfortable reading of "no public
  // mempool" is the wrong one, and the correction has to be in the data.
  const correction = MODELS.sequenced.correction.toLowerCase();
  assert.ok(correction.includes("not privacy"), "must say plainly that it is not privacy");
  assert.ok(correction.includes("before anyone else"), "must say one party sees it first");
});

test("the sequencer is named as a single privileged observer", () => {
  const result = path();
  const sequencer = hop(result, "sequencer");
  assert.equal(sequencer.privileged, true);
  assert.equal(sequencer.movable, false);
  assert.equal(result.privileged, 1);
  assert.ok(sequencer.learns.some((item) => /exclusively/.test(item)));
  assert.ok(sequencer.learns.some((item) => /decides/.test(item)));
});

test("the wallet's own provider is named first, before the chain", () => {
  const order = path().hops.map((entry) => entry.id);
  assert.equal(order[0], "wallet-provider");
  assert.ok(order.indexOf("wallet-provider") < order.indexOf("sequencer"));
  assert.ok(order.indexOf("sequencer") < order.indexOf("ledger"));
});

test("what cannot be moved is marked as such, with the reason given once", () => {
  const result = path();
  for (const id of ["wallet-provider", "sequencer", "ledger"])
    assert.equal(hop(result, id).movable, false, `${id} must not be offered as movable`);
  assert.equal(result.movable, 0, "nothing on the required path is movable on this chain");
  assert.match(WHY_FIXED, /eth_sendTransaction/);
  assert.match(WHY_FIXED, /eth_signTransaction/);
});

test("receipt sync is shown as off until it is on, and never omitted", () => {
  const off = hop(path(), "tera-receipt");
  // Explicitly false rather than absent: "off" and "not applicable" are
  // different claims, and the panel must be able to tell them apart.
  assert.equal(off.active, false);
  assert.deepEqual(off.learns, ["Nothing. The receipt stays on this device."]);
  const on = hop(path({ receiptSync: true }), "tera-receipt");
  assert.equal(on.active, true);
  assert.ok(on.learns.some((item) => /transaction hash/.test(item)));
  // What has already been sent cannot be recalled, and the copy must say so.
  assert.match(on.note, /stays sent/);
});

test("the explorer appears only when one is configured, and only on demand", () => {
  assert.equal(hop(path(), "explorer").onDemand, true);
  assert.equal(hop(describeSubmission({}), "explorer"), undefined);
});

test("a public-mempool chain is described correctly rather than as this one", () => {
  // The wallet is written for a sequenced chain. If it is ever pointed at a chain
  // with a public queue, the panel has to change its answer, not repeat this one.
  const result = path({ model: "publicMempool" });
  assert.equal(result.sequenced, false);
  assert.ok(hop(result, "mempool"));
  assert.equal(hop(result, "sequencer"), undefined);
  assert.equal(hop(result, "mempool").movable, true);
  assert.match(MODELS.publicMempool.correction, /private submission route is worth having/);
});

test("an unknown model falls back to the chain this wallet is actually on", () => {
  assert.equal(describeSubmission({ model: "nonsense" }).model.id, "sequenced");
});

test("the limits say the three things that undercut this panel", () => {
  const text = SUBMISSION_LIMITS.join(" ").toLowerCase();
  assert.ok(text.includes("public and permanent"), "must say a confirmed transfer is not private");
  assert.ok(
    text.includes("wallet extension's own provider"),
    "must say the provider still sees every transaction",
  );
  // Naming the service that does not apply is what stops it being asked for again.
  assert.ok(text.includes("flashbots"), "must say why no MEV-protection route is offered");
});

test("the chain is named from configuration rather than hard-coded into the copy", () => {
  const result = path({ chainName: "Example Chain", chainId: 99 });
  assert.equal(result.chainId, 99);
  assert.match(hop(result, "sequencer").name, /^Example Chain/);
  assert.match(hop(result, "ledger").name, /^Example Chain/);
});
