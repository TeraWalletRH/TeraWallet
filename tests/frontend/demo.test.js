import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEMO_OWNER,
  DEMO_ASSETS,
  GUIDE,
  guideStep,
  demoApi,
  demoProposal,
  demoReply,
  createDemoProvider,
  createDemoState,
  DemoSignatureBlocked,
} from "../../public/tera/wallet/demo.js";
import {
  isAddress,
  isHash,
  executionIssue,
  sendPrepared,
  errorMessage,
  GATES,
  sameAddress,
} from "../../public/tera/wallet/core.js";
import { describeRequest, summarize } from "../../public/tera/wallet/privacy.js";

const chainId = 4663;

test("sample data uses valid, clearly fake addresses", () => {
  assert.ok(isAddress(DEMO_OWNER));
  assert.ok(DEMO_OWNER.startsWith("0xde30"));
  for (const asset of DEMO_ASSETS) {
    assert.ok(isAddress(asset.address), `${asset.symbol} address`);
    assert.ok(Number.isInteger(asset.decimals) && asset.decimals >= 0 && asset.decimals <= 36);
    assert.equal(asset.status, "ACTIVE");
    assert.match(asset.issuer, /demo data/);
  }
});

test("the demo answers every path the wallet calls", () => {
  const paths = [
    "/api/assets",
    "/api/account/register",
    `/api/account/${DEMO_OWNER}`,
    `/api/account/${DEMO_OWNER}/history`,
    `/api/session/${DEMO_OWNER}`,
    "/api/assets/preflight",
    "/api/intent/receipt",
  ];
  for (const path of paths) {
    const payload = demoApi(path, undefined, chainId);
    assert.equal(payload.success, true, path);
  }
  assert.ok(Array.isArray(demoApi("/api/assets", undefined, chainId).assets));
  assert.ok(Array.isArray(demoApi(`/api/session/${DEMO_OWNER}`, undefined, chainId).sessions));
  assert.ok(
    Array.isArray(demoApi(`/api/account/${DEMO_OWNER}/history`, undefined, chainId).history),
  );
  assert.equal(
    demoApi("/api/agent/chat", { message: "what do you see?" }, chainId).reply.length > 0,
    true,
  );
});

test("a demo proposal is complete enough to reach the approval boundary", () => {
  const proposal = demoProposal(chainId);
  assert.equal(proposal.gates.length, GATES.length);
  assert.ok(proposal.gates.every((gate) => gate.passed));
  assert.ok(isHash(proposal.preparedTransaction.actionHash));
  assert.equal(proposal.preparedTransaction.chainId, chainId);
  assert.equal(executionIssue(proposal, DEMO_OWNER, chainId), null);
});

test("a blocked demo proposal reports the rule without revealing the limit owner-side", () => {
  const proposal = demoProposal(chainId, { amount: "2500000000" }, true);
  assert.equal(proposal.success, false);
  assert.ok(proposal.error);
  assert.equal(proposal.gates.filter((gate) => !gate.passed).length, 1);
  assert.ok(executionIssue(proposal, DEMO_OWNER, chainId));
});

test("the demo provider serves reads but refuses to sign", async () => {
  const provider = createDemoProvider(chainId);
  assert.equal(Number(await provider.request({ method: "eth_chainId" })), chainId);
  assert.ok(sameAddress((await provider.request({ method: "eth_accounts" }))[0], DEMO_OWNER));
  const balance = await provider.request({
    method: "eth_call",
    params: [{ to: DEMO_ASSETS[0].address, data: `0x70a08231${"0".repeat(64)}` }, "latest"],
  });
  assert.ok(BigInt(balance) > 0n);
  await assert.rejects(
    () => provider.request({ method: "eth_sendTransaction", params: [{}] }),
    DemoSignatureBlocked,
  );
});

test("approving in the demo runs the real path and stops at the signature", async () => {
  const provider = createDemoProvider(chainId);
  const proposal = demoProposal(chainId);
  let reachedSend = false;
  await assert.rejects(
    () => sendPrepared(provider, proposal, DEMO_OWNER, chainId, () => (reachedSend = true)),
    (error) => {
      assert.ok(error instanceof DemoSignatureBlocked);
      // Not a wallet rejection code: the notice must read as the boundary.
      assert.equal(error.code, undefined);
      assert.match(errorMessage(error), /never asks a real wallet to sign/);
      return true;
    },
  );
  assert.equal(reachedSend, true, "simulation and gas estimation must pass first");
});

test("the guided walkthrough covers the boundary in order", () => {
  assert.ok(GUIDE.length >= 5);
  for (const step of GUIDE) {
    assert.ok(step.id && step.title && step.body && step.action);
    assert.ok(["privacy", "agent", "approvals", "dashboard", "receipts"].includes(step.route));
  }
  assert.equal(new Set(GUIDE.map((step) => step.id)).size, GUIDE.length);
  assert.equal(guideStep(0).route, "privacy");
  assert.equal(guideStep(-5).id, GUIDE[0].id);
  assert.equal(guideStep(99).id, GUIDE[GUIDE.length - 1].id);
});

test("demo state is self-contained and repeatable", () => {
  const first = createDemoState(chainId);
  assert.equal(first.owner, DEMO_OWNER);
  assert.equal(first.assetsLoaded, true);
  assert.equal(first.chain, chainId);
  assert.equal(first.drafts.length, 2);
  assert.equal(first.account.stats.intents.confirmed_intents, 1);
  assert.equal(executionIssue(first.drafts[0], DEMO_OWNER, chainId), null);
  const second = createDemoState(chainId);
  assert.deepEqual(second.drafts[0].intent, first.drafts[0].intent);
  assert.equal(second.records.length, 0);
});

test("simulated requests are counted apart from sent ones", () => {
  const log = [
    { ...describeRequest("/api/agent/chat", { message: "hi" }), simulated: true },
    { ...describeRequest("/api/intent/prepare", { ownerAddress: DEMO_OWNER }), simulated: true },
    describeRequest("/api/assets"),
  ];
  const totals = summarize(log);
  assert.equal(totals.requests, 3);
  assert.equal(totals.simulated, 2);
  assert.equal(totals.identifying, 1);
});

test("demo replies stay generic and carry no sample values", () => {
  for (const message of ["what can you see?", "transfer 100 USDG", "hello"]) {
    const reply = demoReply(message);
    assert.ok(reply.length > 0);
    assert.equal(reply.includes(DEMO_OWNER), false);
  }
});
