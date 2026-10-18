import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHAIN_HEX,
  ERRORS,
  accountsFor,
  checkRequest,
  classify,
  grant,
  listSites,
  passwordWait,
  permissionsFor,
  revoke,
  siteOrigin,
  switchChain,
} from "../../public/tera/core/dapp-connect.js";

const ANA = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

test("only https sites, and http on this computer, can connect", () => {
  assert.equal(siteOrigin("https://app.uniswap.org/swap?x=1"), "https://app.uniswap.org");
  assert.equal(siteOrigin("http://localhost:5173/"), "http://localhost:5173");
  assert.equal(siteOrigin("http://127.0.0.1:8080/a"), "http://127.0.0.1:8080");
  assert.equal(siteOrigin("http://[::1]:3000/"), "http://[::1]:3000");
  assert.equal(siteOrigin("http://example.com/"), "");
  assert.equal(siteOrigin("file:///Users/me/page.html"), "");
  assert.equal(siteOrigin("chrome-extension://abc/popup.html"), "");
  assert.equal(siteOrigin("not a url"), "");
  assert.equal(siteOrigin(undefined), "");
});

test("the network is Robinhood Chain", () => {
  assert.equal(CHAIN_HEX, "0x1237");
});

test("requests are sorted by who answers them", () => {
  assert.equal(classify("eth_requestAccounts"), "connect");
  assert.equal(classify("eth_accounts"), "accounts");
  assert.equal(classify("eth_chainId"), "chain");
  assert.equal(classify("eth_getBalance"), "read");
  assert.equal(classify("eth_call"), "read");
  assert.equal(classify("personal_sign"), "signing");
  assert.equal(classify("eth_sendTransaction"), "send");
  assert.equal(classify("eth_signTransaction"), "signing");
  assert.equal(classify("eth_signTypedData_v4"), "signing");
  assert.equal(classify("wallet_switchEthereumChain"), "switch");
  assert.equal(classify("toString"), "unsupported");
  assert.equal(classify("debug_traceTransaction"), "unsupported");
});

test("malformed requests are refused before anything else", () => {
  assert.equal(checkRequest(null).code, ERRORS.invalidRequest);
  assert.equal(checkRequest({}).code, ERRORS.invalidRequest);
  assert.equal(checkRequest({ method: "x".repeat(101) }).code, ERRORS.invalidRequest);
  assert.equal(checkRequest({ method: "eth_call", params: "0x" }).code, ERRORS.invalidParams);
  assert.equal(checkRequest({ method: "eth_chainId" }), null);
  assert.equal(checkRequest({ method: "eth_call", params: [] }), null);
});

test("switching to Robinhood Chain works; anything else is unrecognized", () => {
  assert.equal(switchChain([{ chainId: "0x1237" }]), null);
  assert.equal(switchChain([{ chainId: "0x1" }]).code, ERRORS.unrecognizedChain);
  assert.equal(switchChain([]).code, ERRORS.invalidParams);
  assert.equal(switchChain([{ chainId: 4663 }]).code, ERRORS.invalidParams);
});

test("a site sees no address until connected, and loses it on disconnect", () => {
  let sites = {};
  assert.deepEqual(accountsFor(sites, "https://a.app"), []);
  assert.deepEqual(permissionsFor(sites, "https://a.app"), []);
  sites = grant(sites, "https://a.app", [ANA], 1000);
  assert.deepEqual(accountsFor(sites, "https://a.app"), [ANA]);
  assert.equal(permissionsFor(sites, "https://a.app")[0].parentCapability, "eth_accounts");
  // Other origins, including subdomains and plain http, are other sites.
  assert.deepEqual(accountsFor(sites, "https://evil.a.app"), []);
  assert.deepEqual(accountsFor(sites, "http://a.app"), []);
  const before = sites;
  sites = revoke(sites, "https://a.app");
  assert.deepEqual(accountsFor(sites, "https://a.app"), []);
  assert.deepEqual(accountsFor(before, "https://a.app"), [ANA], "grant and revoke don't mutate");
});

test("only a real origin can be granted", () => {
  assert.throws(() => grant({}, "http://example.com", [ANA]));
  assert.throws(() => grant({}, "https://a.app/path", [ANA]));
  assert.throws(() => grant({}, "__proto__", [ANA]));
});

test("connected sites list newest first", () => {
  let sites = grant({}, "https://old.app", [ANA], 1);
  sites = grant(sites, "https://new.app", [ANA], 2);
  assert.deepEqual(
    listSites(sites).map((s) => s.origin),
    ["https://new.app", "https://old.app"],
  );
  assert.deepEqual(listSites(undefined), []);
});

test("wrong passwords: five free tries, then a doubling wait up to 15 minutes", () => {
  assert.equal(passwordWait(0), 0);
  assert.equal(passwordWait(4), 0);
  assert.equal(passwordWait(5), 30_000);
  assert.equal(passwordWait(6), 60_000);
  assert.equal(passwordWait(20), 15 * 60_000);
});
