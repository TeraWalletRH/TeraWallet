import { test } from "node:test";
import assert from "node:assert/strict";
import { diff, findLookalike, looksLike } from "../../public/tera/core/lookalike.js";

const MUM = "0x5b27aa00000000000000000000000000000c9f05";
const FAKE = "0x5b27ff11111111111111111111111111111c9f05";
const OTHER = "0x1234000000000000000000000000000000005678";

test("an address that starts and ends like a known one is a lookalike", () => {
  assert.equal(looksLike(FAKE, MUM), true);
  assert.equal(looksLike(FAKE.toUpperCase().replace("0X", "0x"), MUM), true);
  // The same address is not a lookalike of itself.
  assert.equal(looksLike(MUM, MUM.toUpperCase().replace("0X", "0x")), false);
  // Sharing only the start, or only the end, is not enough.
  assert.equal(looksLike("0x5b27ff1111111111111111111111111111112222", MUM), false);
  assert.equal(looksLike("0x9999ff11111111111111111111111111111c9f05", MUM), false);
  // Three and three is the floor, and eight together.
  assert.equal(looksLike("0x5b2fff1111111111111111111111111111111f05", MUM), false);
  assert.equal(looksLike("0x5b27af1111111111111111111111111111111f05", MUM), true);
  assert.equal(looksLike("not an address", MUM), false);
});

test("the closest known address is named, and a known address is never flagged", () => {
  const known = [
    { address: MUM, label: "Mum" },
    { address: OTHER, label: "paid on 3 Sep" },
  ];
  assert.deepEqual(findLookalike(FAKE, known), { address: MUM, label: "Mum" });
  assert.equal(findLookalike(MUM, known), null);
  assert.equal(findLookalike("0x0000000000000000000000000000000000000001", known), null);
  // The address being paid is known as well as resembling another: it is known, so fine.
  assert.equal(findLookalike(FAKE, [...known, { address: FAKE, label: "Shop" }]), null);
  assert.equal(findLookalike("", known), null);
});

test("the difference is marked run by run", () => {
  const runs = diff(FAKE, MUM);
  assert.equal(runs.map((r) => r.text).join(""), FAKE);
  assert.deepEqual(
    runs.map((r) => r.same),
    [true, false, true],
  );
  assert.equal(runs[0].text, "0x5b27");
  assert.equal(runs[2].text, "c9f05");
});
