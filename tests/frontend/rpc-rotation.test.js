import { test } from "node:test";
import assert from "node:assert/strict";
import { createRotation, isNodeFault, nodeList } from "../../public/tera/core/rpc-rotation.js";

test("reads take turns, each starting at the next node", () => {
  const rotation = createRotation(3);
  assert.deepEqual(rotation.next("eth_call"), [0, 1, 2]);
  assert.deepEqual(rotation.next("eth_getBalance"), [1, 2, 0]);
  assert.deepEqual(rotation.next("eth_blockNumber"), [2, 0, 1]);
  assert.deepEqual(rotation.next("eth_call"), [0, 1, 2]);
});

test("log searches and anything to do with sending stay on the first node", () => {
  const rotation = createRotation(4);
  rotation.next("eth_call");
  for (const method of ["eth_getLogs", "eth_sendRawTransaction", "eth_getTransactionCount", "eth_getTransactionReceipt"])
    assert.deepEqual(rotation.next(method), [0, 1, 2, 3], method);
  // Pinned requests don't use up a turn.
  assert.deepEqual(rotation.next("eth_call"), [1, 2, 3, 0]);
});

test("with rotation off every read starts at the first node", () => {
  const rotation = createRotation(3);
  assert.deepEqual(rotation.next("eth_call", false), [0, 1, 2]);
  assert.deepEqual(rotation.next("eth_call", false), [0, 1, 2]);
});

test("a single node is always first", () => {
  const rotation = createRotation(1);
  assert.deepEqual(rotation.next("eth_call"), [0]);
  assert.deepEqual(rotation.next("eth_call"), [0]);
  assert.throws(() => createRotation(0));
});

test("unreachable, slow, rate-limited and failing nodes are faults; a revert is an answer", () => {
  assert.equal(isNodeFault({ name: "HttpRequestError" }), true);
  assert.equal(isNodeFault({ name: "TimeoutError" }), true);
  assert.equal(isNodeFault({ name: "RpcRequestError", code: -32005 }), true);
  assert.equal(isNodeFault({ name: "Whatever", status: 503 }), true);
  assert.equal(isNodeFault({ name: "Whatever", status: 429 }), true);
  assert.equal(isNodeFault({ name: "Outer", cause: { name: "TimeoutError" } }), true);
  assert.equal(isNodeFault({ name: "ContractFunctionRevertedError", code: 3 }), false);
  assert.equal(isNodeFault({ name: "RpcRequestError", code: -32000, message: "execution reverted" }), false);
  assert.equal(isNodeFault({ name: "Whatever", status: 400 }), false);
  assert.equal(isNodeFault(null), false);
});

test("the node list puts the network's own first and drops repeats", () => {
  assert.deepEqual(nodeList("https://a", ["https://b", " https://a ", "", "https://c"]), ["https://a", "https://b", "https://c"]);
});
