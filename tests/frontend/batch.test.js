import { test } from "node:test";
import assert from "node:assert/strict";
import { LIMITS, largest, parse, recipientKind, toUnits, total } from "../../public/tera/core/batch.js";
import { check } from "../../public/tera/core/limits.js";

const A = "0x5b27aa00000000000000000000000000000c9f05";
const B = "0x00000000000000000000000000000000000000bb";

test("a pasted list or CSV reads one payment per line, with an optional note", () => {
  const { payments, errors } = parse(
    `recipient,amount,note\n${A}, 25, rent share\n@mum\t10.5\n\n# skipped\n${B} 1,000`.replace("1,000", "1000"),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(
    payments.map((p) => [p.line, p.to, p.kind, p.amount, p.units, p.note]),
    [
      [2, A, "address", "25", 25_000_000n, "rent share"],
      [3, "@mum", "tag", "10.5", 10_500_000n, ""],
      [6, B, "address", "1000", 1_000_000_000n, ""],
    ],
  );
  assert.equal(total(payments), 1_035_500_000n);
  assert.equal(largest(payments), 1_000_000_000n);
});

test("a note may hold commas, and $ before an amount is fine", () => {
  const { payments } = parse(`${A}, $12.50, lunch, coffee and cake`);
  assert.equal(payments[0].amount, "12.50");
  assert.equal(payments[0].note, "lunch, coffee and cake");
});

test("every line that cannot be paid is an error with its line number, never skipped", () => {
  const { payments, errors } = parse(
    [`${A}, 5`, "0x123, 5", `${B}, five`, `${B}, 1.1234567`, `${B}, 0`, `${A.toUpperCase().replace("0X", "0x")}, 3`, "justone"].join(
      "\n",
    ),
  );
  assert.equal(payments.length, 1);
  assert.deepEqual(
    errors.map((e) => [e.line, e.reason]),
    [
      [2, "recipient"],
      [3, "amount"],
      [4, "decimals"],
      [5, "zero"],
      [6, "duplicate"],
      [7, "columns"],
    ],
  );
  assert.equal(errors.find((e) => e.reason === "duplicate").first, 1);
});

test("emails are recipients only where they resolve, and the list is capped", () => {
  assert.equal(recipientKind("pay@acme.com"), "");
  assert.equal(recipientKind("pay@acme.com", { emails: true }), "email");
  assert.equal(recipientKind("@astra"), "tag");
  assert.equal(recipientKind("astra"), "");
  const many = Array.from({ length: LIMITS.maxPayments + 2 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, "0")}, 1`).join("\n");
  const { payments, errors } = parse(many);
  assert.equal(payments.length, LIMITS.maxPayments);
  assert.deepEqual(
    errors.map((e) => e.reason),
    ["too-many", "too-many"],
  );
});

test("amounts are read at the token's decimals", () => {
  assert.equal(toUnits("1.5", 18), 1_500_000_000_000_000_000n);
  assert.equal(toUnits("1.5", 0), null);
  assert.equal(parse(`${A}, 0.000000000000000001`, { decimals: 18 }).payments[0].units, 1n);
});

test("a batch meets the per-payment cap by its biggest line, and the day by its total", () => {
  const limits = { perPayment: "50000000", daily: "100000000", monthly: null };
  assert.deepEqual(check({ limits, amount: 90_000_000n, rows: [], largest: 40_000_000n }), { ok: true });
  assert.equal(check({ limits, amount: 90_000_000n, rows: [], largest: 60_000_000n }).kind, "perPayment");
  assert.equal(check({ limits, amount: 120_000_000n, rows: [], largest: 40_000_000n }).kind, "daily");
  // Without `largest`, one payment is held to both, as before.
  assert.equal(check({ limits, amount: 90_000_000n, rows: [] }).kind, "perPayment");
});
