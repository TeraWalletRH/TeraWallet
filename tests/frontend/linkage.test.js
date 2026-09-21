import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LINKED,
  WOULD_LINK,
  SEPARATED,
  ORDER,
  STRUCTURAL,
  LIMITS,
  emptyLedger,
  noteAccount,
  noteRead,
  partiesFor,
  pairingOf,
  pairings,
  separationSummary,
  describePair,
  capacity,
  accountsNamed,
  spanOf,
  shortAccount,
} from "../../public/tera/core/linkage.js";

const A = "0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa";
const B = "0xBbBBbBBbBbbBbbBbbBbBbBbbbBBbbbBbbbBbBBbB";
const C = "0xcCCccCCCCcCCCcCcCcCCCcccCcCCCCcCccccCCcC";

test("an account and a party are recorded once, however often they are seen", () => {
  let ledger = noteRead(emptyLedger(), A, "alpha.example");
  ledger = noteRead(ledger, A, "alpha.example");
  ledger = noteRead(ledger, A.toLowerCase(), "alpha.example");
  assert.deepEqual(ledger.accounts, [A.toLowerCase()]);
  assert.deepEqual(partiesFor(ledger, A), ["alpha.example"]);
});

test("a pair is linked once one party has answered for both", () => {
  let ledger = noteRead(emptyLedger(), A, "alpha.example");
  ledger = noteRead(ledger, B, "beta.example");
  assert.equal(pairingOf(ledger, A, B).state, SEPARATED);
  ledger = noteRead(ledger, B, "alpha.example");
  const pairing = pairingOf(ledger, A, B);
  assert.equal(pairing.state, LINKED);
  assert.deepEqual(pairing.shared, ["alpha.example"]);
});

test("a link is never taken back, however the pool changes afterwards", () => {
  // The point of the ledger. An operator that answered for two accounts keeps
  // that; a screen that showed the pair recovering would be wrong in the only
  // direction it is not allowed to be wrong in.
  let ledger = noteRead(emptyLedger(), A, "alpha.example");
  ledger = noteRead(ledger, B, "alpha.example");
  // A fresh pool that would now assign them apart.
  const assign = (account) => (account === A.toLowerCase() ? "gamma.example" : "delta.example");
  assert.equal(pairingOf(ledger, A, B, assign).state, LINKED);
});

test("the pair that is about to be joined is reported before it is", () => {
  // The only state an owner can still act on, which is why it is a state at all
  // rather than a footnote under a separated pair.
  const ledger = noteAccount(noteAccount(emptyLedger(), A), B);
  const pairing = pairingOf(ledger, A, B, () => "alpha.example");
  assert.equal(pairing.state, WOULD_LINK);
  assert.equal(pairing.pending, "alpha.example");
  assert.match(describePair(pairing), /next balance read/i);
});

test("a forecast onto a party that already saw both is not reported as pending", () => {
  let ledger = noteRead(emptyLedger(), A, "alpha.example");
  ledger = noteRead(ledger, B, "alpha.example");
  const pairing = pairingOf(ledger, A, B, () => "alpha.example");
  assert.equal(pairing.state, LINKED);
  assert.equal(pairing.pending, "");
});

test("the good word carries its own caveat, so a surface cannot drop it", () => {
  let ledger = noteRead(emptyLedger(), A, "alpha.example");
  ledger = noteRead(ledger, B, "beta.example");
  const sentence = describePair(pairingOf(ledger, A, B));
  assert.match(sentence, /Tera's service/);
  assert.match(sentence, /network address/);
  assert.match(sentence, /wallet extension/);
});

test("pairs are reported worst first", () => {
  let ledger = noteRead(emptyLedger(), A, "alpha.example");
  ledger = noteRead(ledger, B, "beta.example");
  ledger = noteRead(ledger, C, "alpha.example");
  const list = pairings(ledger);
  assert.equal(list.length, 3);
  assert.deepEqual(
    list.map((pair) => ORDER.indexOf(pair.state)),
    [...list.map((pair) => ORDER.indexOf(pair.state))].sort((one, two) => one - two),
  );
  assert.equal(list[0].state, LINKED);
});

test("the summary counts what the table shows", () => {
  let ledger = noteRead(emptyLedger(), A, "alpha.example");
  ledger = noteRead(ledger, B, "alpha.example");
  ledger = noteRead(ledger, C, "beta.example");
  const summary = separationSummary(ledger);
  assert.equal(summary.accounts, 3);
  assert.equal(summary.pairs, 3);
  assert.equal(summary.linked, 1);
  assert.equal(summary.separated, 2);
});

test("one account on its own produces no pairs and no claim", () => {
  const summary = separationSummary(noteAccount(emptyLedger(), A), () => "alpha.example");
  assert.equal(summary.accounts, 1);
  assert.equal(summary.pairs, 0);
});

test("a pool too small to separate the accounts says so as arithmetic", () => {
  assert.equal(capacity(1, 0).enough, true);
  assert.equal(capacity(1, 0).note, "");
  assert.equal(capacity(3, 1).enough, false);
  assert.match(capacity(3, 1).note, /every pair is joined/i);
  assert.equal(capacity(4, 2).enough, false);
  assert.match(capacity(4, 2).note, /at least one pair has to share/i);
  assert.match(capacity(4, 2).note, /takes 4 operators/);
  // Enough capacity is not the same as actually separated, and the note says so
  // rather than letting the headline overtake the table.
  assert.equal(capacity(2, 3).enough, true);
  assert.match(capacity(2, 3).note, /still land two accounts on the same operator/i);
});

test("a request naming two of your accounts is refused, and says why", () => {
  const body = { ownerAddress: A, recipient: B, amount: "10" };
  const result = spanOf(body, [A, B, C]);
  assert.equal(result.spans, true);
  assert.deepEqual(result.named, [A.toLowerCase(), B.toLowerCase()]);
  assert.match(result.reason, /belong to the same person/i);
  assert.match(result.reason, /was not sent/i);
  assert.match(result.reason, new RegExp(shortAccount(A)));
});

test("a request naming one account is not a correlation", () => {
  // Almost every request here carries exactly one. Calling that a span would
  // fire the refusal on everything and make it mean nothing.
  const result = spanOf({ ownerAddress: A, accountAddress: A, chainId: 4663 }, [A, B]);
  assert.equal(result.spans, false);
  assert.deepEqual(result.named, [A.toLowerCase()]);
});

test("a second address that is not yours is not one of your accounts", () => {
  const stranger = "0x1111111111111111111111111111111111111111";
  assert.equal(spanOf({ ownerAddress: A, recipient: stranger }, [A, B]).spans, false);
});

test("an account is found wherever it is written, not only in fields we expected", () => {
  // The field carrying the second account is the field nobody thought of, so the
  // whole payload is walked and a match inside a string counts.
  assert.deepEqual(accountsNamed(`/api/account/${A}/history`, [A]), [A.toLowerCase()]);
  assert.deepEqual(
    accountsNamed({ note: `send to ${B} from ${A}`, meta: { list: [{ to: B }] } }, [A, B]),
    [A.toLowerCase(), B.toLowerCase()],
  );
  // Case never decides the answer, in either direction.
  assert.deepEqual(accountsNamed({ to: A.toLowerCase() }, [A.toUpperCase().replace("0X", "0x")]), [
    A.toLowerCase(),
  ]);
});

test("the guard costs nothing before any account is known", () => {
  assert.deepEqual(accountsNamed({ ownerAddress: A, recipient: B }, []), []);
  assert.equal(spanOf({ ownerAddress: A, recipient: B }, []).spans, false);
});

test("the structural parties and the limits say what separation is not", () => {
  const text = [...STRUCTURAL.map((row) => `${row.party} ${row.why}`), ...LIMITS].join(" ");
  assert.match(text, /Tera service API/);
  assert.match(text, /network address/i);
  assert.match(text, /wallet extension/i);
  // The three concessions that keep this screen from overclaiming.
  assert.match(text, /reload/i);
  assert.match(text, /compare notes/i);
  assert.match(text, /does not unlink|will not unlink/i);
});
