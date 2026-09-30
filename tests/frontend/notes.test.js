import { test } from "node:test";
import assert from "node:assert/strict";
import { LIMITS, cleanNote, cleanNotes, keyFor, noteFor, setNote } from "../../public/tera/core/notes.js";
import { filter } from "../../public/tera/core/activity-search.js";

const H1 = "0x" + "a".repeat(64);
const H2 = "0x" + "b".repeat(64);

test("a note is cleaned: invisible characters out, spaces collapsed, capped", () => {
  assert.equal(cleanNote("  rent​ for\n\n May  "), "rent for May");
  assert.equal(cleanNote("‮yam rof tner"), "yam rof tner");
  assert.equal(cleanNote("x".repeat(500)).length, LIMITS.maxLength);
  assert.equal(cleanNote(null), "");
});

test("notes are kept by lowercase hash; an empty note removes it", () => {
  let notes = setNote({}, H1.toUpperCase().replace("0X", "0x"), "Rent for May");
  assert.deepEqual(notes, { [H1]: "Rent for May" });
  assert.equal(noteFor(notes, H1), "Rent for May");
  assert.equal(noteFor(notes, H2), "");
  const before = notes;
  notes = setNote(notes, H1, "   ");
  assert.deepEqual(notes, {});
  // The map passed in is not changed.
  assert.deepEqual(before, { [H1]: "Rent for May" });
  // Something that is not a transaction hash is never a key.
  assert.equal(keyFor("0x1234"), "");
  assert.deepEqual(setNote({}, "not a hash", "hi"), {});
});

test("past the cap, the oldest notes go first", () => {
  let notes = {};
  for (let i = 0; i <= LIMITS.maxNotes; i++) notes = setNote(notes, "0x" + i.toString(16).padStart(64, "0"), `n${i}`);
  assert.equal(Object.keys(notes).length, LIMITS.maxNotes);
  assert.equal(noteFor(notes, "0x" + "0".repeat(64)), "");
  assert.equal(noteFor(notes, "0x" + LIMITS.maxNotes.toString(16).padStart(64, "0")), `n${LIMITS.maxNotes}`);
});

test("stored notes are cleaned on read", () => {
  assert.deepEqual(cleanNotes({ [H1.toUpperCase().replace("0X", "0x")]: " hi ", "0x12": "no", [H2]: "", x: 5 }), {
    [H1]: "hi",
  });
  assert.deepEqual(cleanNotes(null), {});
});

test("activity search finds a transaction by its note", () => {
  const rows = [
    { hash: H1, title: "Sent 25 USDG", status: "confirmed", createdAt: 1 },
    { hash: H2, title: "Sent 5 USDG", status: "confirmed", createdAt: 2 },
  ];
  const notes = { [H1]: "Rent for May" };
  const found = filter(rows, { query: "rent" }, { noteFor: (h) => noteFor(notes, h) });
  assert.deepEqual(
    found.map((r) => r.hash),
    [H1],
  );
});
