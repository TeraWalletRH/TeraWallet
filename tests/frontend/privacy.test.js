import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REQUESTS,
  LOCAL_ONLY,
  requestProfile,
  fieldNames,
  describeRequest,
  appendLog,
  summarize,
  exportable,
} from "../../public/tera/wallet/privacy.js";

const owner = `0x${"1".repeat(40)}`;

test("every documented request is complete", () => {
  assert.ok(REQUESTS.length > 0);
  assert.ok(LOCAL_ONLY.length > 0);
  for (const entry of REQUESTS) {
    assert.equal(typeof entry.id, "string");
    assert.match(entry.path, /^\/api\//);
    assert.ok(["GET", "POST"].includes(entry.method));
    assert.ok(entry.label && entry.purpose && entry.retention);
    assert.ok(Array.isArray(entry.fields));
    assert.equal(typeof entry.identifies, "boolean");
    assert.ok(entry.processors.length > 0);
  }
  assert.equal(new Set(REQUESTS.map((entry) => entry.id)).size, REQUESTS.length);
});

test("profiles match the paths the wallet actually calls", () => {
  assert.equal(requestProfile("/api/assets").id, "assets");
  assert.equal(requestProfile("/api/account/register").id, "account-register");
  assert.equal(requestProfile(`/api/account/${owner}`).id, "account-read");
  assert.equal(requestProfile(`/api/account/${owner}/history`).id, "account-history");
  assert.equal(requestProfile(`/api/session/${owner}`).id, "session-read");
  assert.equal(requestProfile("/api/assets/preflight").id, "assets-preflight");
  assert.equal(requestProfile("/api/intent/prepare").id, "intent-prepare");
  assert.equal(requestProfile("/api/intent/receipt").id, "intent-receipt");
  assert.equal(requestProfile("/api/agent/chat").id, "agent-chat");
  assert.equal(requestProfile("/api/agent/propose").id, "agent-propose");
  assert.equal(requestProfile("/api/something/else").id, "unknown");
});

test("only field names are recorded, never values", () => {
  const body = {
    ownerAddress: owner,
    accountAddress: owner,
    assetAddress: `0x${"3".repeat(40)}`,
    actionType: "TRANSFER",
    amount: "1234567",
    recipient: `0x${"2".repeat(40)}`,
    maxSpendUsdCents: undefined,
  };
  const entry = describeRequest("/api/intent/prepare", body);
  const serialized = JSON.stringify(entry);
  for (const value of ["1234567", owner, "TRANSFER", "3".repeat(40)])
    assert.equal(serialized.includes(value), false, `recorded the value ${value}`);
  assert.deepEqual(entry.sent, [
    "accountAddress",
    "actionType",
    "amount",
    "assetAddress",
    "ownerAddress",
    "recipient",
  ]);
  assert.equal(entry.method, "POST");
  assert.equal(entry.identifies, true);
});

test("a chat message is recorded without its text and without an address", () => {
  const entry = describeRequest("/api/agent/chat", { message: "sell everything I own" });
  assert.deepEqual(entry.sent, ["message"]);
  assert.equal(entry.identifies, false);
  assert.equal(JSON.stringify(entry).includes("sell everything"), false);
  assert.ok(entry.processors.includes("Assistant model provider"));
});

test("reads describe the address carried in the path", () => {
  const entry = describeRequest(`/api/account/${owner}`);
  assert.equal(entry.method, "GET");
  assert.equal(entry.identifies, true);
  assert.deepEqual(entry.sent, ["ownerAddress (in the request path)"]);
  assert.equal(entry.path, "/api/account/{address}");
  assert.equal(JSON.stringify(entry).includes(owner), false);
});

test("an undocumented path is redacted before it is logged", () => {
  const entry = describeRequest(`/api/unknown/${owner}/detail`);
  assert.equal(entry.id, "unknown");
  assert.equal(entry.path, "/api/unknown/{value}/detail");
  assert.equal(JSON.stringify(entry).includes(owner), false);
});

test("the registry read sends no owner data", () => {
  const entry = describeRequest("/api/assets");
  assert.deepEqual(entry.sent, []);
  assert.equal(entry.identifies, false);
});

test("fieldNames ignores missing and non-object bodies", () => {
  assert.deepEqual(fieldNames(undefined), []);
  assert.deepEqual(fieldNames(null), []);
  assert.deepEqual(fieldNames("message"), []);
  assert.deepEqual(fieldNames([1, 2]), []);
  assert.deepEqual(fieldNames({ b: 1, a: 2, c: undefined }), ["a", "b"]);
});

test("the log keeps newest first and stays bounded", () => {
  let log = [];
  for (let i = 0; i < 8; i++) log = appendLog(log, describeRequest("/api/assets", undefined, i), 5);
  assert.equal(log.length, 5);
  assert.equal(log[0].at, 7);
  assert.equal(log[4].at, 3);
});

test("summarize counts identifying requests and model-provider requests", () => {
  const log = [
    describeRequest("/api/agent/chat", { message: "hello" }),
    describeRequest("/api/account/register", { ownerAddress: owner, chainId: 4663 }),
    describeRequest("/api/assets"),
  ];
  assert.deepEqual(summarize(log), {
    requests: 3,
    simulated: 0,
    identifying: 1,
    toModelProvider: 1,
    fields: 3,
  });
});

test("the export carries field names, destination and retention only", () => {
  const log = [describeRequest("/api/agent/propose", { prompt: "buy SPCX", ownerAddress: owner })];
  const output = exportable(log, "api.terawallet.app");
  assert.equal(output.destination, "api.terawallet.app");
  assert.equal(output.requests.length, 1);
  assert.deepEqual(output.requests[0].fieldsSent, ["ownerAddress", "prompt"]);
  assert.ok(output.requests[0].retention);
  const serialized = JSON.stringify(output);
  assert.equal(serialized.includes("buy SPCX"), false);
  assert.equal(serialized.includes(owner), false);
});
