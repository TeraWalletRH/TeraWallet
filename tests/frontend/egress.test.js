import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parties,
  egressStatus,
  egressSummary,
  exportableEgress,
  REACH,
} from "../../public/tera/wallet/egress.js";
import { describeRequest } from "../../public/tera/wallet/privacy.js";

const config = { apiUrl: "https://api.terawallet.app", siteHost: "terawallet.app", chainId: 4663 };
const owner = `0x${"1".repeat(40)}`;
const rows = (log = [], context = {}) => egressStatus(parties(config), { log, ...context });
const row = (list, id) => list.find((entry) => entry.id === id);

test("every party declares a reach that is documented", () => {
  for (const party of parties(config)) {
    assert.ok(REACH[party.reach], `${party.id} has an undocumented reach`);
    assert.ok(party.learns.length, `${party.id} says nothing about what it learns`);
    assert.ok(party.control, `${party.id} offers the owner nothing`);
  }
});

test("the configured hosts are named, not guessed", () => {
  const list = parties({
    ...config,
    rpcUrl: "https://rpc.example.test/v1",
    explorerUrl: "https://scan.example.test",
  });
  assert.equal(row(list, "tera-service").host, "api.terawallet.app");
  assert.equal(row(list, "chain-rpc").host, "rpc.example.test");
  assert.equal(row(list, "explorer").host, "scan.example.test");
});

test("only a party this browser connects to is said to see the network address", () => {
  const list = parties(config);
  const seesAddress = list
    .filter((entry) => entry.reach === "direct" || entry.reach === "wallet")
    .map((entry) => entry.id);
  assert.deepEqual(seesAddress.sort(), ["chain-rpc", "page-host", "tera-service", "wallet-rpc"]);
  for (const id of ["model-provider", "relay"]) {
    assert.equal(row(list, id).reach, "relayed");
    assert.ok(row(list, id).withheld.includes("The network address you are on"));
  }
});

test("requests this page makes are counted against the right party", () => {
  const log = [
    describeRequest("/api/agent/chat", { message: "hello" }),
    describeRequest("/api/bridge/quote", { ownerAddress: owner, amount: "1" }),
    describeRequest("/api/assets"),
  ];
  const list = rows(log);
  assert.equal(row(list, "tera-service").requests, 3);
  assert.equal(row(list, "model-provider").requests, 1);
  assert.equal(row(list, "relay").requests, 1);
  assert.equal(row(list, "model-provider").seesYouNow, true);
});

test("a party not contacted is reported as not contacted", () => {
  const list = rows([describeRequest("/api/assets")]);
  assert.equal(row(list, "relay").requests, 0);
  assert.equal(row(list, "relay").seesYouNow, false);
  assert.match(row(list, "relay").note, /Not contacted/);
});

test("the demo claims nothing reached anyone", () => {
  const log = [{ ...describeRequest("/api/agent/chat", { message: "hi" }), simulated: true }];
  const list = rows(log, { demo: true, owner });
  assert.equal(row(list, "model-provider").seesYouNow, false);
  assert.equal(row(list, "tera-service").seesYouNow, false);
  assert.equal(row(list, "wallet-rpc").seesYouNow, false);
});

test("a simulated request is never counted against a real party", () => {
  const log = [{ ...describeRequest("/api/agent/chat", { message: "hi" }), simulated: true }];
  assert.equal(row(rows(log), "tera-service").requests, 0);
});

test("what this page cannot observe is marked uncounted, never zero", () => {
  const list = rows([]);
  for (const id of ["wallet-rpc", "chain-rpc"]) {
    assert.equal(row(list, id).uncounted, true);
    assert.equal(row(list, id).requests, undefined);
  }
});

test("the wallet's own provider is live only while a wallet is connected", () => {
  assert.equal(row(rows([], { owner }), "wallet-rpc").seesYouNow, true);
  assert.equal(row(rows([]), "wallet-rpc").seesYouNow, false);
});

test("the ledger row counts transactions from this device", () => {
  assert.match(row(rows([], { records: 2 }), "ledger").note, /2 transactions/);
  assert.equal(row(rows([], { records: 0 }), "ledger").seesYouNow, false);
  assert.equal(row(rows([], { records: 2 }), "ledger").seesYouNow, true);
});

test("the explorer is only reached when a link is opened", () => {
  const explorer = row(rows([describeRequest("/api/assets")]), "explorer");
  assert.equal(explorer.seesYouNow, false);
  assert.equal(explorer.reach, "onDemand");
});

test("the summary counts parties rather than asserting a number", () => {
  const log = [describeRequest("/api/agent/chat", { message: "hello" })];
  const totals = egressSummary(rows(log, { owner, records: 1 }));
  assert.equal(totals.parties, 8);
  assert.equal(totals.direct, 4);
  assert.equal(totals.relayed, 2);
  assert.equal(totals.uncounted, 2);
  // Page host, Tera, the model provider, the wallet's provider and the ledger.
  assert.equal(totals.seeingYouNow, 5);
});

test("the export keeps the reach distinction and carries no owner data", () => {
  const log = [describeRequest("/api/agent/propose", { prompt: "buy SPCX", ownerAddress: owner })];
  const output = exportableEgress(rows(log, { owner }));
  const model = output.parties.find((entry) => entry.party === "Assistant model provider");
  assert.equal(model.seesYourNetworkAddress, false);
  assert.equal(model.contactedThisSession, true);
  const tera = output.parties.find((entry) => entry.party === "Tera service API");
  assert.equal(tera.seesYourNetworkAddress, true);
  const serialized = JSON.stringify(output);
  assert.equal(serialized.includes(owner), false);
  assert.equal(serialized.includes("buy SPCX"), false);
});
