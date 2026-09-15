import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createApi,
  ApiError,
  parseUnits,
  formatUnits,
  GATES,
  executionIssue,
  sendPrepared,
  checkReceipt,
  ZERO_ADDRESS,
} from "../../public/tera/wallet/core.js";
import { renderAssistantMarkdown } from "../../public/tera/wallet/markdown.js";

const owner = `0x${"1".repeat(40)}`;
const recipient = `0x${"2".repeat(40)}`;
const token = `0x${"3".repeat(40)}`;
const hash = `0x${"4".repeat(64)}`;
const chainId = 4663;
function proposal() {
  const intent = {
    ownerAddress: owner,
    accountAddress: owner,
    assetAddress: token,
    recipient,
    actionType: "TRANSFER",
    amount: "1234567",
  };
  return {
    intent,
    preparedAt: Date.now(),
    gates: GATES.map((gate) => ({ gate, passed: true })),
    preparedTransaction: {
      to: token,
      data: `0xa9059cbb${recipient.slice(2).padStart(64, "0")}${BigInt(intent.amount).toString(16).padStart(64, "0")}`,
      value: "0x0",
      chainId,
      actionHash: hash,
      intent,
    },
  };
}
function wallet(overrides = {}) {
  const calls = [];
  return {
    calls,
    request: async (args) => {
      calls.push(args);
      if (args.method in overrides)
        return typeof overrides[args.method] === "function"
          ? overrides[args.method](args)
          : overrides[args.method];
      return {
        eth_accounts: [owner],
        eth_chainId: "0x1237",
        eth_getCode: "0x6000",
        eth_call: `0x${"0".repeat(63)}1`,
        eth_estimateGas: "0x10000",
        eth_sendTransaction: hash,
        eth_getTransactionReceipt: null,
      }[args.method];
    },
  };
}

test("token amounts retain precision and respect each asset decimal count", () => {
  assert.equal(parseUnits("1.234567", 6), "1234567");
  assert.equal(
    parseUnits("9007199254740993.000000000000000001", 18),
    "9007199254740993000000000000000001",
  );
  assert.equal(
    formatUnits("9007199254740993000000000000000001", 18),
    "9007199254740993.000000000000000001",
  );
  assert.equal(formatUnits("0", 6), "0");
  for (const value of ["0", "-1", "1e6", "Infinity", ".1", "1.0000001"])
    assert.throws(() => parseUnits(value, 6));
});

test("assistant Markdown supports formatting while escaping unsafe HTML", () => {
  const html = renderAssistantMarkdown(
    "**AAPL** is Apple.\n\n### Key facts\n- **Exchange**: NASDAQ\n- `AAPL`\n\n[Docs](https://example.com/docs)\n\n<script>alert(1)</script>",
  );
  assert.match(html, /<strong>AAPL<\/strong>/);
  assert.match(html, /<h3>Key facts<\/h3>/);
  assert.match(
    html,
    /<ul><li><strong>Exchange<\/strong>: NASDAQ<\/li><li><code>AAPL<\/code><\/li><\/ul>/,
  );
  assert.match(html, /href="https:\/\/example.com\/docs"/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(renderAssistantMarkdown("[bad](javascript:alert(1))"), /href=/);
});

test("API preserves failed gate details and sends exact JSON", async () => {
  let request;
  const body = { amount: "1234567" };
  const gates = [{ gate: "policy_vault", passed: false }];
  const api = createApi("https://example.test/", async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ success: false, error: "Policy blocked", gates }), {
      status: 422,
    });
  });
  await assert.rejects(
    api("/api/intent/prepare", body),
    (error) =>
      error instanceof ApiError && error.status === 422 && error.payload.gates[0].passed === false,
  );
  assert.equal(request.url, "https://example.test/api/intent/prepare");
  assert.equal(request.options.body, JSON.stringify(body));
});

test("API rejects unavailable, non-JSON, and invalid responses", async () => {
  for (const fetcher of [
    async () => {
      throw new Error("offline");
    },
    async () => new Response("<html>bad gateway</html>", { status: 502 }),
    async () => new Response("null"),
  ]) {
    await assert.rejects(createApi("https://example.test", fetcher)("/api/assets"), ApiError);
  }
});

test("only the exact owner-reviewed transfer with five passing gates is executable", () => {
  assert.equal(executionIssue(proposal(), owner, chainId), null);
  const alterations = [
    (p) => {
      p.preparedTransaction.to = recipient;
    },
    (p) => {
      p.preparedTransaction.data = p.preparedTransaction.data.slice(0, -1) + "0";
    },
    (p) => {
      p.preparedTransaction.value = "0x1";
    },
    (p) => {
      p.preparedTransaction.chainId = 1;
    },
    (p) => {
      p.preparedTransaction.actionHash = "0xbad";
    },
    (p) => {
      p.intent.ownerAddress = recipient;
    },
    (p) => {
      p.intent.accountAddress = recipient;
    },
    (p) => {
      p.intent.recipient = "";
    },
    (p) => {
      p.intent.assetAddress = "0x123";
    },
    (p) => {
      p.intent.amount = "-1";
    },
    (p) => {
      p.gates[0].passed = false;
    },
    (p) => {
      p.gates.pop();
    },
    (p) => {
      p.gates.push(p.gates[0]);
    },
  ];
  for (const mutate of alterations) {
    const p = proposal();
    mutate(p);
    assert.ok(executionIssue(p, owner, chainId), mutate.toString());
  }
});

test("transfers do not expire from local preparation time, but backend expiry is honored", () => {
  const p = proposal();
  p.preparedAt -= 10 * 60 * 1000;
  assert.equal(executionIssue(p, owner, chainId), null);
  p.expiresAt = Date.now() - 1;
  assert.match(executionIssue(p, owner, chainId), /expired/);
});

test("unquoted swaps and yield calls cannot execute", () => {
  for (const action of ["BUY", "SELL", "CLAIM_YIELD"]) {
    const p = proposal();
    p.intent.actionType = action;
    assert.ok(executionIssue(p, owner, chainId));
  }
});

test("a native ETH transfer binds recipient, empty calldata, and exact value", async () => {
  const p = proposal();
  p.intent.assetAddress = ZERO_ADDRESS;
  p.preparedTransaction = {
    ...p.preparedTransaction,
    to: recipient,
    data: "0x",
    value: "0x12d687",
  };
  assert.equal(executionIssue(p, owner, chainId), null);
  const provider = wallet();
  assert.equal(await sendPrepared(provider, p, owner, chainId), hash);
  assert.equal(
    provider.calls.some((call) => call.method === "eth_getCode"),
    false,
  );
  const submitted = provider.calls.find((call) => call.method === "eth_sendTransaction");
  assert.equal(submitted.params[0].value, "0x12d687");
  p.preparedTransaction.value = "0x0";
  assert.match(executionIssue(p, owner, chainId), /native ETH transfer/);
});

test("simulation and gas estimation precede one explicit wallet submission", async () => {
  const provider = wallet();
  const p = proposal();
  assert.equal(await sendPrepared(provider, p, owner, chainId), hash);
  const methods = provider.calls.map((c) => c.method);
  assert.ok(methods.indexOf("eth_call") < methods.indexOf("eth_sendTransaction"));
  assert.ok(methods.indexOf("eth_estimateGas") < methods.indexOf("eth_sendTransaction"));
  const submissions = provider.calls.filter((c) => c.method === "eth_sendTransaction");
  assert.equal(submissions.length, 1);
  assert.deepEqual(submissions[0].params[0], {
    from: owner,
    to: token,
    data: p.preparedTransaction.data,
    value: "0x0",
    chainId: "0x1237",
  });
});

test("wrong network, changed account, missing code and failed simulation never open a signing request", async () => {
  for (const overrides of [
    { eth_chainId: "0x1" },
    { eth_accounts: [recipient] },
    { eth_getCode: "0x" },
    { eth_call: `0x${"0".repeat(64)}` },
    {
      eth_estimateGas: () => {
        throw new Error("reverted");
      },
    },
  ]) {
    const provider = wallet(overrides);
    await assert.rejects(sendPrepared(provider, proposal(), owner, chainId));
    assert.equal(
      provider.calls.some((c) => c.method === "eth_sendTransaction"),
      false,
    );
  }
});

test("wallet changes during simulation and cancelled UI operations prevent signing", async () => {
  let reads = 0;
  const provider = wallet({ eth_accounts: () => (++reads > 1 ? [recipient] : [owner]) });
  await assert.rejects(sendPrepared(provider, proposal(), owner, chainId), /account changed/);
  assert.equal(
    provider.calls.some((c) => c.method === "eth_sendTransaction"),
    false,
  );
  const other = wallet();
  await assert.rejects(
    sendPrepared(other, proposal(), owner, chainId, () => {
      throw new Error("cancelled");
    }),
    /cancelled/,
  );
  assert.equal(
    other.calls.some((c) => c.method === "eth_sendTransaction"),
    false,
  );
});

test("wallet rejection propagates without retrying submission", async () => {
  const provider = wallet({
    eth_sendTransaction: () => {
      throw Object.assign(new Error("Rejected"), { code: 4001 });
    },
  });
  await assert.rejects(
    sendPrepared(provider, proposal(), owner, chainId),
    (error) => error.code === 4001,
  );
  assert.equal(provider.calls.filter((c) => c.method === "eth_sendTransaction").length, 1);
});

test("a hash alone is pending; only a matching successful mined receipt confirms", async () => {
  const record = { txHash: hash, owner, to: token };
  const receipt = { transactionHash: hash, from: owner, to: token, status: "0x1", blockHash: hash };
  assert.equal(await checkReceipt(wallet(), record, chainId), "pending");
  assert.equal(
    await checkReceipt(wallet({ eth_getTransactionReceipt: receipt }), record, chainId),
    "confirmed",
  );
  assert.equal(
    await checkReceipt(
      wallet({ eth_getTransactionReceipt: { ...receipt, status: "0x0" } }),
      record,
      chainId,
    ),
    "reverted",
  );
  await assert.rejects(
    checkReceipt(
      wallet({ eth_getTransactionReceipt: { ...receipt, from: recipient } }),
      record,
      chainId,
    ),
    /does not match/,
  );
  await assert.rejects(
    checkReceipt(
      wallet({ eth_getTransactionReceipt: { ...receipt, blockHash: null } }),
      record,
      chainId,
    ),
    /incomplete/,
  );
  await assert.rejects(
    checkReceipt(wallet({ eth_chainId: "0x1" }), record, chainId),
    /Switch back/,
  );
});
