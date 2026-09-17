import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normaliseEndpoint,
  describeEndpoint,
  createRpc,
  probeEndpoint,
  balanceReader,
  EndpointError,
  READ_METHODS,
} from "../../public/tera/wallet/endpoint.js";

const ZERO = `0x${"0".repeat(40)}`;
const owner = `0x${"1".repeat(40)}`;
const token = `0x${"2".repeat(40)}`;
const key = "https://rpc.example.test/v1/secret-api-key";

// A fetcher that records what it was asked and answers like a JSON-RPC node.
function fakeNode(handler) {
  const calls = [];
  const fetcher = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, init, body });
    const answer = handler(body, calls.length);
    return {
      ok: answer.ok !== false,
      status: answer.status || 200,
      json: async () => answer.payload,
    };
  };
  return { fetcher, calls };
}

test("an endpoint must be a usable URL", () => {
  assert.throws(() => normaliseEndpoint(""), EndpointError);
  assert.throws(() => normaliseEndpoint("not a url"), EndpointError);
  assert.throws(() => normaliseEndpoint("ws://rpc.example.test"), EndpointError);
  assert.equal(normaliseEndpoint("  https://rpc.example.test/v1  "), "https://rpc.example.test/v1");
});

test("plain http is refused unless the node is on this machine", () => {
  assert.throws(() => normaliseEndpoint("http://rpc.example.test"), EndpointError);
  assert.equal(normaliseEndpoint("http://localhost:8545"), "http://localhost:8545/");
  assert.equal(normaliseEndpoint("http://127.0.0.1:8545"), "http://127.0.0.1:8545/");
});

test("credentials in the URL are refused rather than stored", () => {
  assert.throws(() => normaliseEndpoint("https://user:pass@rpc.example.test"), EndpointError);
});

test("only the host is ever described, never the key in the path", () => {
  const described = describeEndpoint(key);
  assert.equal(described.host, "rpc.example.test");
  assert.equal(described.secure, true);
  assert.equal(described.local, false);
  assert.equal(JSON.stringify(described).includes("secret-api-key"), false);
  assert.equal(describeEndpoint("http://localhost:8545").local, true);
});

test("a signing method is refused before any request is made", async () => {
  const node = fakeNode(() => ({ payload: { result: "0x1" } }));
  const rpc = createRpc(key, node.fetcher);
  for (const method of [
    "eth_sendTransaction",
    "personal_sign",
    "eth_accounts",
    "eth_requestAccounts",
    "eth_signTransaction",
    "eth_estimateGas",
    "eth_getTransactionReceipt",
  ]) {
    await assert.rejects(() => rpc({ method }), EndpointError);
  }
  assert.equal(node.calls.length, 0);
});

test("the read list is exactly what a balance needs and nothing more", () => {
  assert.deepEqual(READ_METHODS, ["eth_chainId", "eth_blockNumber", "eth_getBalance", "eth_call"]);
});

test("a read carries no cookies and no referrer", async () => {
  const node = fakeNode(() => ({ payload: { result: "0x2a" } }));
  const rpc = createRpc(key, node.fetcher);
  await rpc({ method: "eth_getBalance", params: [owner, "latest"] });
  assert.equal(node.calls[0].init.credentials, "omit");
  assert.equal(node.calls[0].init.referrerPolicy, "no-referrer");
  assert.equal(node.calls[0].body.method, "eth_getBalance");
  assert.equal(node.calls[0].body.jsonrpc, "2.0");
});

test("an endpoint on the wrong network is rejected, not used", async () => {
  const node = fakeNode(() => ({ payload: { result: "0x1" } }));
  await assert.rejects(
    () => probeEndpoint(createRpc(key, node.fetcher), 4663),
    (error) => {
      assert.ok(error instanceof EndpointError);
      assert.match(error.message, /network 1.*4663/);
      return true;
    },
  );
});

test("an endpoint on the right network reports its id", async () => {
  const node = fakeNode(() => ({ payload: { result: "0x1237" } }));
  assert.equal(await probeEndpoint(createRpc(key, node.fetcher), 4663), 4663);
});

test("a node error is surfaced by host, never by URL", async () => {
  const node = fakeNode(() => ({ payload: { error: { message: "rate limited" } } }));
  const rpc = createRpc(key, node.fetcher);
  await assert.rejects(
    () => rpc({ method: "eth_chainId" }),
    (error) => {
      assert.match(error.message, /rpc\.example\.test/);
      assert.equal(error.message.includes("secret-api-key"), false);
      return true;
    },
  );
});

test("an unreachable endpoint is reported without leaking the URL", async () => {
  const rpc = createRpc(key, async () => {
    throw new Error("network down");
  });
  await assert.rejects(
    () => rpc({ method: "eth_chainId" }),
    (error) => {
      assert.equal(error.message.includes("secret-api-key"), false);
      assert.match(error.message, /could not be reached/);
      return true;
    },
  );
});

test("a non-JSON or empty answer is an error rather than a wrong balance", async () => {
  const broken = createRpc(key, async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new Error("not json");
    },
  }));
  await assert.rejects(() => broken({ method: "eth_chainId" }), EndpointError);
  const empty = fakeNode(() => ({ payload: {} }));
  await assert.rejects(
    () => createRpc(key, empty.fetcher)({ method: "eth_chainId" }),
    EndpointError,
  );
  const failed = fakeNode(() => ({ ok: false, status: 502, payload: {} }));
  await assert.rejects(
    () => createRpc(key, failed.fetcher)({ method: "eth_chainId" }),
    EndpointError,
  );
});

test("balance reads ask for exactly what the wallet's own provider is asked", async () => {
  const node = fakeNode(() => ({ payload: { result: "0x64" } }));
  const read = balanceReader(createRpc(key, node.fetcher), ZERO);
  await read({ assetAddress: ZERO, owner });
  await read({ assetAddress: token, owner });
  assert.equal(node.calls[0].body.method, "eth_getBalance");
  assert.deepEqual(node.calls[0].body.params, [owner, "latest"]);
  assert.equal(node.calls[1].body.method, "eth_call");
  assert.deepEqual(node.calls[1].body.params, [
    { to: token, data: `0x70a08231${owner.slice(2).padStart(64, "0")}` },
    "latest",
  ]);
});
