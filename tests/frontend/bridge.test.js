import test from "node:test";
import assert from "node:assert/strict";
import { checkBridgeQuote, sendBridge } from "../../public/tera/wallet/bridge.js";
const owner = `0x${"1".repeat(40)}`;
const token = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const deposit = "0x4cd00e387622c35bddb9b4c962c136462338bc31";
const hash = `0x${"a".repeat(64)}`;
const word = s => s.slice(2).padStart(64, "0");
const amount = (1000000n).toString(16).padStart(64, "0");
const input = { ownerAddress: owner, recipient: `0x${"2".repeat(40)}`, destinationChainId: 8453, amount: "1000000" };
function quote() { return { requestId: hash, input, expiresAt: Date.now() + 120000, amountOut: "990000", minimumAmountOut: "985050", steps: [
  { id: "approve", to: token, data: `0x095ea7b3${word(deposit)}${amount}`, value: "0x0", chainId: 4663 },
  { id: "deposit", to: deposit, data: `0xe8017952${word(owner)}${word(token)}${amount}${"a".repeat(64)}`, value: "0x0", chainId: 4663 },
] }; }
test("bridge blocks expired quotes, wrong recipients and changed approvals", () => {
  const q = quote();
  assert.doesNotThrow(() => checkBridgeQuote(q, input));
  assert.throws(() => checkBridgeQuote(q, input, q.expiresAt));
  assert.throws(() => checkBridgeQuote(q, { ...input, recipient: owner }));
  q.steps[0].data = q.steps[0].data.slice(0, -64) + "f".repeat(64);
  assert.throws(() => checkBridgeQuote(q, input));
});
test("bridge waits for allowance receipt and records deposit without claiming delivery", async () => {
  const events = [];
  const provider = { request: async ({ method }) => {
    events.push(method);
    return { eth_accounts: [owner], eth_chainId: "0x1237", eth_getCode: "0x1234", eth_call: "0x", eth_estimateGas: "0x20000", eth_sendTransaction: hash, eth_getTransactionReceipt: { status: "0x1" } }[method];
  } };
  const recorded = [];
  await sendBridge(provider, quote(), input, () => {}, (step, h) => recorded.push([step, h]), () => {});
  assert.deepEqual(recorded, [["approve", hash], ["deposit", hash]]);
  assert(events.indexOf("eth_getTransactionReceipt") < events.lastIndexOf("eth_sendTransaction"));
});
test("wallet mismatch never sends a bridge transaction", async () => {
  let sent = false;
  const provider = { request: async ({ method }) => {
    if (method === "eth_sendTransaction") sent = true;
    return method === "eth_accounts" ? [input.recipient] : "0x1237";
  } };
  await assert.rejects(sendBridge(provider, quote(), input, () => {}, () => {}, () => {}));
  assert.equal(sent, false);
});
test("failed allowance or expired quote after allowance never submits a deposit", async () => {
  for (const failure of ["reverted", "expired"]) {
    const q = quote();
    let sends = 0;
    const provider = { request: async ({ method }) => {
      if (method === "eth_sendTransaction") { sends++; return hash; }
      if (method === "eth_getTransactionReceipt") {
        if (failure === "expired") q.expiresAt = 0;
        return { status: failure === "reverted" ? "0x0" : "0x1" };
      }
      return { eth_accounts: [owner], eth_chainId: "0x1237", eth_getCode: "0x1234", eth_call: "0x", eth_estimateGas: "0x20000" }[method];
    } };
    await assert.rejects(sendBridge(provider, q, input, () => {}, () => {}, () => {}));
    assert.equal(sends, 1);
  }
});
