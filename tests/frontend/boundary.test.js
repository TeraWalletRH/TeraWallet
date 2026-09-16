import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STAGES,
  SIDE_NOTES,
  PREPARED,
  OWNER,
  stagesFor,
  initialProgress,
  applyStage,
  progressSummary,
  boundaryIndex,
} from "../../public/tera/wallet/boundary.js";
import { sendPrepared, GATES, ZERO_ADDRESS } from "../../public/tera/wallet/core.js";
import { createDemoProvider, demoProposal, DEMO_OWNER } from "../../public/tera/wallet/demo.js";

const chainId = 4663;
const owner = `0x${"1".repeat(40)}`;
const recipient = `0x${"2".repeat(40)}`;
const token = `0x${"3".repeat(40)}`;
const hash = `0x${"4".repeat(64)}`;
const amount = "1234567";

function proposal() {
  const intent = {
    ownerAddress: owner,
    accountAddress: owner,
    assetAddress: token,
    recipient,
    actionType: "TRANSFER",
    amount,
  };
  return {
    intent,
    gates: GATES.map((gate) => ({ gate, passed: true })),
    preparedTransaction: {
      to: token,
      data: `0xa9059cbb${recipient.slice(2).padStart(64, "0")}${BigInt(amount).toString(16).padStart(64, "0")}`,
      value: "0x0",
      chainId,
      actionHash: hash,
      intent,
    },
  };
}

function provider(overrides = {}) {
  return {
    async request({ method }) {
      if (overrides[method]) return overrides[method]();
      if (method === "eth_chainId") return `0x${chainId.toString(16)}`;
      if (method === "eth_accounts") return [owner];
      if (method === "eth_getCode") return "0x60806040";
      if (method === "eth_call") return `0x${"0".repeat(63)}1`;
      if (method === "eth_estimateGas") return "0xc350";
      if (method === "eth_sendTransaction") return hash;
      throw new Error(`unexpected ${method}`);
    },
  };
}

test("the sides split exactly once, and signing is the first owner-side stage", () => {
  const cross = boundaryIndex();
  assert.ok(cross > 0);
  assert.equal(STAGES[cross].id, "sign");
  // Everything before the line is preparation; everything after belongs to the owner.
  assert.ok(STAGES.slice(0, cross).every((stage) => stage.side === PREPARED));
  assert.ok(STAGES.slice(cross).every((stage) => stage.side === OWNER));
  assert.ok(SIDE_NOTES[PREPARED].note.length > 10);
  assert.ok(SIDE_NOTES[OWNER].note.length > 10);
});

test("only the signing side can move value, and every prepared stage is read-only", () => {
  for (const stage of STAGES.filter((row) => row.side === PREPARED))
    assert.equal(
      /eth_sendTransaction|eth_signTransaction|personal_sign/.test(stage.detail),
      false,
      `${stage.id} claims a signing call`,
    );
  assert.match(STAGES.find((row) => row.id === "sign").detail, /eth_sendTransaction/);
});

test("stages adapt to native transfers and multi-signature actions", () => {
  const erc20 = stagesFor({ nativeTransfer: false, steps: 1 }).map((stage) => stage.id);
  assert.ok(erc20.includes("contract"));
  assert.equal(erc20.includes("confirm"), false);
  const native = stagesFor({ nativeTransfer: true, steps: 1 }).map((stage) => stage.id);
  assert.equal(native.includes("contract"), false);
  const swap = stagesFor({ nativeTransfer: false, steps: 2 }).map((stage) => stage.id);
  assert.ok(swap.includes("confirm"));
});

test("progress starts idle and applyStage does not mutate", () => {
  const stages = stagesFor();
  const start = initialProgress(stages);
  assert.ok(Object.values(start).every((status) => status === "pending"));
  const summary = progressSummary(start, stages);
  assert.equal(summary.state, "idle");
  assert.equal(summary.crossed, false);
  const next = applyStage(start, "verify", "done");
  assert.equal(start.verify, "pending", "the original progress was mutated");
  assert.equal(next.verify, "done");
});

test("a failure before the line reports that nothing was asked of the wallet", () => {
  const stages = stagesFor();
  let progress = initialProgress(stages);
  progress = applyStage(progress, "verify", "done");
  progress = applyStage(progress, "wallet", "done");
  progress = applyStage(progress, "simulate", "failed");
  const summary = progressSummary(progress, stages);
  assert.equal(summary.state, "failed");
  assert.equal(summary.crossed, false);
  assert.match(summary.text, /No signature was requested and nothing moved/);
});

test("a failure at the signature reports that nothing was submitted", () => {
  const stages = stagesFor();
  const summary = progressSummary(applyStage(initialProgress(stages), "sign", "failed"), stages);
  assert.equal(summary.state, "failed");
  assert.equal(summary.crossed, true);
  assert.match(summary.text, /Nothing was submitted without your signature/);
});

test("crossing the line is only reported once the wallet is asked to sign", () => {
  const stages = stagesFor();
  let progress = initialProgress(stages);
  for (const id of ["verify", "wallet", "contract", "simulate", "gas", "recheck"]) {
    progress = applyStage(progress, id, "done");
    assert.equal(progressSummary(progress, stages).crossed, false, `crossed early at ${id}`);
  }
  progress = applyStage(progress, "sign", "running");
  assert.equal(progressSummary(progress, stages).crossed, true);
  progress = applyStage(progress, "sign", "done");
  progress = applyStage(progress, "submitted", "done");
  assert.equal(progressSummary(progress, stages).state, "submitted");
});

test("a real approval reports the stages in boundary order", async () => {
  const seen = [];
  const result = await sendPrepared(
    provider(),
    proposal(),
    owner,
    chainId,
    () => {},
    (id, status) => seen.push(`${id}:${status}`),
  );
  assert.equal(result, hash);
  const done = seen.filter((row) => row.endsWith(":done")).map((row) => row.split(":")[0]);
  assert.deepEqual(done, [
    "verify",
    "wallet",
    "contract",
    "simulate",
    "gas",
    "recheck",
    "sign",
    "submitted",
  ]);
  // No owner-side stage is reported before every prepared stage has finished.
  assert.ok(seen.indexOf("sign:running") > seen.indexOf("recheck:done"));
});

test("a native transfer skips the contract stage rather than claiming it ran", async () => {
  const intent = {
    ownerAddress: owner,
    accountAddress: owner,
    assetAddress: ZERO_ADDRESS,
    recipient,
    actionType: "TRANSFER",
    amount: "1000",
  };
  const native = {
    intent,
    gates: GATES.map((gate) => ({ gate, passed: true })),
    preparedTransaction: {
      to: recipient,
      data: "0x",
      value: "1000",
      chainId,
      actionHash: hash,
      intent,
    },
  };
  const seen = [];
  await sendPrepared(
    provider(),
    native,
    owner,
    chainId,
    () => {},
    (id, status) => seen.push(`${id}:${status}`),
  );
  assert.ok(seen.includes("contract:skipped"));
  assert.equal(seen.includes("contract:done"), false);
});

test("a simulation failure stops on the prepared side and never reaches signing", async () => {
  const seen = [];
  await assert.rejects(() =>
    sendPrepared(
      provider({ eth_call: () => `0x${"0".repeat(64)}` }),
      proposal(),
      owner,
      chainId,
      () => {},
      (id, status) => seen.push(`${id}:${status}`),
    ),
  );
  assert.ok(seen.includes("simulate:failed"));
  assert.equal(
    seen.some((row) => row.startsWith("sign:")),
    false,
    "the wallet was asked to sign after a failed simulation",
  );
});

test("the guided demo stops exactly at the boundary", async () => {
  const seen = [];
  await assert.rejects(() =>
    sendPrepared(
      createDemoProvider(chainId),
      demoProposal(chainId),
      DEMO_OWNER,
      chainId,
      () => {},
      (id, status) => seen.push(`${id}:${status}`),
    ),
  );
  assert.ok(seen.includes("recheck:done"), "the demo must run the real prepared-side checks");
  assert.ok(seen.includes("sign:failed"));
  assert.equal(seen.includes("submitted:done"), false);
});
