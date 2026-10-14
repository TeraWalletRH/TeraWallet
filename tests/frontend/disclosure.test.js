import { test } from "node:test";
import assert from "node:assert/strict";
import { disclose, mask } from "../../public/tera/core/disclosure.js";

const OWNER = "0xAbCdEf0000000000000000000000000000001234";
const request = (body) => ({
  url: "https://api.terawallet.app/api/agent/chat",
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

test("a question: shown as sent, contains only the message, no address", () => {
  const d = disclose(request({ message: "What is USDG?" }), { owner: OWNER, at: 5 });
  assert.equal(d.url, "https://api.terawallet.app/api/agent/chat");
  assert.equal(d.method, "POST");
  assert.deepEqual(d.headers, { "Content-Type": "application/json" });
  assert.equal(d.body, '{\n  "message": "What is USDG?"\n}');
  assert.deepEqual(d.fields, ["message"]);
  assert.equal(d.addressSent, false);
  assert.equal(d.at, 5);
});

test("a proposal: the address is reported as sent, the session token masked", () => {
  const d = disclose(
    request({ prompt: "pay 5 USDG", ownerAddress: OWNER, sessionToken: "sess_abcdefgh9876" }),
    { owner: OWNER },
  );
  assert.deepEqual(d.fields, ["prompt", "ownerAddress", "sessionToken"]);
  assert.deepEqual(d.secrets, ["sessionToken"]);
  assert.equal(d.addressSent, true);
  assert.ok(!d.body.includes("sess_abcdefgh9876"));
  assert.match(d.body, /"sessionToken": "••••••9876"/);
});

test("the address is found anywhere in the request, in any case", () => {
  const d = disclose(request({ message: `my wallet is ${OWNER.toLowerCase()}` }), { owner: OWNER });
  assert.equal(d.addressSent, true);
});

test("short secrets are fully masked", () => {
  assert.equal(mask("abc"), "••••");
  assert.equal(mask(undefined), "••••");
});

test("a request with no body says so", () => {
  const d = disclose({ url: "https://x/api", method: "GET", headers: {} }, { owner: OWNER });
  assert.equal(d.body, "");
  assert.deepEqual(d.fields, []);
});
