import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LIMITS,
  SCOPE,
  cleanBook,
  contactFor,
  nameFor,
  parseName,
  recentPayees,
  removeContact,
  saveContact,
  searchContacts,
  sortedContacts,
} from "../../public/tera/core/contacts.js";

const OWNER = "0x1111111111111111111111111111111111111111";
const MUM = "0x5b2759f9620f54a5E1651A567Ebd8381F07f9f05";
const SHOP = "0x2222222222222222222222222222222222222222";

test("a plain name is accepted and trimmed", () => {
  assert.deepEqual(parseName("  Mum  "), { ok: true, name: "Mum", reason: "" });
  assert.equal(parseName("Rent   landlord").name, "Rent landlord");
});

test("an empty or overlong name is refused", () => {
  assert.equal(parseName("   ").ok, false);
  assert.equal(parseName("x".repeat(LIMITS.maxLength + 1)).ok, false);
  assert.equal(parseName("x".repeat(LIMITS.maxLength)).ok, true);
});

test("a name cannot read as a Tera tag", () => {
  assert.equal(parseName("@astra").ok, false);
});

test("a name cannot carry an address", () => {
  assert.equal(parseName("0x5b2759f9").ok, false);
  assert.equal(parseName("pay 0xABCD here").ok, false);
  assert.equal(parseName("Oxford").ok, true);
});

test("invisible and direction-changing characters are removed", () => {
  // U+202E would render the rest of the name right to left.
  assert.equal(parseName("Mu‮m").name, "Mum");
  assert.equal(parseName("M​um").name, "Mum");
  assert.equal(parseName("​​").ok, false);
});

test("saving stores the lowercase address and the name", () => {
  const result = saveContact([], { address: MUM, name: "Mum", owner: OWNER, now: 5 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.book, [{ address: MUM.toLowerCase(), name: "Mum", savedAt: 5 }]);
  assert.equal(nameFor(result.book, MUM.toUpperCase().replace("0X", "0x")), "Mum");
});

test("saving an address again renames it and keeps when it was first saved", () => {
  const first = saveContact([], { address: MUM, name: "Mum", now: 5 }).book;
  const second = saveContact(first, { address: MUM, name: "Mother", now: 9 });
  assert.equal(second.ok, true);
  assert.equal(second.book.length, 1);
  assert.deepEqual(contactFor(second.book, MUM), {
    address: MUM.toLowerCase(),
    name: "Mother",
    savedAt: 5,
  });
});

test("two addresses may not share a name, ignoring case and spacing", () => {
  const book = saveContact([], { address: MUM, name: "Mum", now: 1 }).book;
  const clash = saveContact(book, { address: SHOP, name: " m U m ", now: 2 });
  assert.equal(clash.ok, false);
  assert.match(clash.reason, /already the name of 0x5b27…9f05/);
  assert.equal(clash.book.length, 1);
});

test("the owner's own wallet and a malformed address are refused", () => {
  assert.equal(saveContact([], { address: OWNER, name: "Me", owner: OWNER }).ok, false);
  assert.equal(saveContact([], { address: "0x123", name: "Short" }).ok, false);
});

test("the book passed in is never changed", () => {
  const book = saveContact([], { address: MUM, name: "Mum", now: 1 }).book;
  const frozen = JSON.stringify(book);
  saveContact(book, { address: SHOP, name: "Shop", now: 2 });
  removeContact(book, MUM);
  assert.equal(JSON.stringify(book), frozen);
});

test("removing forgets the name and leaves the rest", () => {
  let book = saveContact([], { address: MUM, name: "Mum", now: 1 }).book;
  book = saveContact(book, { address: SHOP, name: "Shop", now: 2 }).book;
  book = removeContact(book, MUM);
  assert.deepEqual(
    book.map((entry) => entry.name),
    ["Shop"],
  );
  assert.equal(nameFor(book, MUM), "");
});

test("a stored list is cleaned, not trusted", () => {
  const book = cleanBook([
    { address: MUM, name: "Mum", savedAt: 1 },
    { address: MUM, name: "Duplicate address" },
    { address: SHOP, name: "MUM" },
    { address: "nonsense", name: "Bad" },
    { address: SHOP, name: "@shop" },
    null,
  ]);
  assert.deepEqual(book, [{ address: MUM.toLowerCase(), name: "Mum", savedAt: 1 }]);
  assert.deepEqual(cleanBook("not a list"), []);
});

test("recent payees come newest first, once each, with saved names, never the owner", () => {
  const book = saveContact([], { address: SHOP, name: "Shop" }).book;
  const history = [
    { payee: MUM, createdAt: 10 },
    { payee: SHOP, createdAt: 30 },
    { payee: MUM.toLowerCase(), createdAt: 20 },
    { payee: OWNER, createdAt: 40 },
    // A swap or a private-route deposit: no payee, so not a send to someone.
    { recipient: SHOP, createdAt: 50 },
  ];
  assert.deepEqual(recentPayees(history, book, { owner: OWNER }), [
    { address: SHOP, name: "Shop", lastSentAt: 30 },
    { address: MUM.toLowerCase(), name: "", lastSentAt: 20 },
  ]);
  assert.equal(recentPayees(history, book, { limit: 1 }).length, 1);
});

test("search matches part of a name or the start of an address", () => {
  let book = saveContact([], { address: MUM, name: "Mum", now: 1 }).book;
  book = saveContact(book, { address: SHOP, name: "Corner shop", now: 2 }).book;
  assert.deepEqual(
    searchContacts(book, "shop").map((entry) => entry.name),
    ["Corner shop"],
  );
  assert.deepEqual(
    searchContacts(book, "0x5B27").map((entry) => entry.name),
    ["Mum"],
  );
  assert.deepEqual(
    sortedContacts(book).map((entry) => entry.name),
    ["Corner shop", "Mum"],
  );
});

test("saved addresses are never offered for a bridge", () => {
  assert.equal(SCOPE.bridge, false);
  assert.equal(SCOPE.transfer, true);
});
