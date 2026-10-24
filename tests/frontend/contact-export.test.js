import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FORMAT,
  buildPayload,
  mergeImported,
  parseEnvelope,
  parsePayload,
} from "../../public/tera/core/contact-export.js";

const OWNER = "0x1111111111111111111111111111111111111111";
const MUM = "0x5b2759f9620f54a5E1651A567Ebd8381F07f9f05".toLowerCase();
const SHOP = "0x2222222222222222222222222222222222222222";

test("buildPayload cleans the book and stamps the export time", () => {
  const payload = buildPayload(
    [{ address: MUM, name: "Mum", savedAt: 1 }, { address: "not an address", name: "x" }],
    42,
  );
  assert.deepEqual(payload, { contacts: [{ address: MUM, name: "Mum", savedAt: 1 }], exportedAt: 42 });
});

test("parseEnvelope accepts only a well-formed Tera export file", () => {
  const good = { ...FORMAT, salt: "ab12", nonce: "cd34", data: "ef56" };
  const result = parseEnvelope(JSON.stringify(good));
  assert.ok(result.ok, result.reason);
  assert.deepEqual(result.envelope, { salt: "ab12", nonce: "cd34", data: "ef56" });

  assert.equal(parseEnvelope("not json").ok, false);
  assert.equal(parseEnvelope(JSON.stringify({ v: 2, kind: FORMAT.kind, salt: "ab", nonce: "cd", data: "ef" })).ok, false);
  assert.equal(parseEnvelope(JSON.stringify({ ...good, salt: "not hex" })).ok, false);
  assert.equal(parseEnvelope(JSON.stringify({ ...good, data: undefined })).ok, false);
});

test("parsePayload accepts only decrypted JSON with a contacts array", () => {
  const ok = parsePayload(JSON.stringify({ contacts: [{ address: MUM, name: "Mum", savedAt: 1 }] }));
  assert.ok(ok.ok);
  assert.deepEqual(ok.contacts, [{ address: MUM, name: "Mum", savedAt: 1 }]);

  assert.equal(parsePayload("not json").ok, false);
  assert.equal(parsePayload(JSON.stringify({ notContacts: [] })).ok, false);
});

test("mergeImported adds new contacts and leaves an existing address alone", () => {
  const existing = [{ address: MUM, name: "Mum", savedAt: 1 }];
  const imported = [
    { address: MUM, name: "Mother (renamed)", savedAt: 2 },
    { address: SHOP, name: "Shop", savedAt: 3 },
  ];
  const result = mergeImported(existing, imported, { owner: OWNER });
  assert.equal(result.added.length, 1);
  assert.equal(result.added[0].address, SHOP);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].address, MUM);
  assert.deepEqual(
    result.book.map((e) => e.name),
    ["Mum", "Shop"],
  );
});

test("mergeImported skips the owner's own address and a name clash against the existing book", () => {
  const existing = [{ address: MUM, name: "Mum", savedAt: 1 }];
  const imported = [
    { address: OWNER, name: "Me", savedAt: 1 },
    { address: SHOP, name: "mum", savedAt: 3 }, // clashes with the already-saved "Mum" once case/spacing folds
  ];
  const result = mergeImported(existing, imported, { owner: OWNER });
  assert.deepEqual(result.added, []);
  assert.equal(result.skipped.length, 2);
});
