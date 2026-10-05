import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FREQUENCIES,
  LIMITS,
  addDays,
  cleanSchedules,
  daysUntil,
  describeFrequency,
  dueCount,
  duePayments,
  nextPayment,
  occurrence,
  parseDay,
  parseSchedule,
  reminderKey,
  reminderText,
  removeSchedule,
  saveSchedule,
  setPaused,
  settle,
  sortedSchedules,
} from "../../public/tera/core/schedules.js";

const owner = `0x${"1".repeat(40)}`;
const payee = `0x${"a".repeat(40)}`;
const hash = `0x${"b".repeat(64)}`;
// Noon on 2026-10-05 in local time, so "today" is the 5th wherever the test runs.
const NOW = new Date(2026, 9, 5, 12).getTime();

function make(overrides = {}) {
  const result = parseSchedule(
    {
      label: "Rent",
      recipient: payee,
      asset: "USDG",
      amount: "500",
      frequency: "monthly",
      start: "2026-10-31",
      ...overrides,
    },
    { owner, now: NOW },
  );
  assert.ok(result.ok, result.reason);
  return result.schedule;
}

test("days are real calendar days", () => {
  assert.deepEqual(parseDay("2026-02-28"), { year: 2026, month: 2, day: 28 });
  assert.equal(parseDay("2026-02-29"), null);
  assert.deepEqual(parseDay("2028-02-29"), { year: 2028, month: 2, day: 29 });
  for (const bad of ["2026-13-01", "2026-00-10", "2026-4-1", "tomorrow", "", null])
    assert.equal(parseDay(bad), null, String(bad));
  assert.equal(addDays("2026-12-30", 7), "2027-01-06");
  // Across the March daylight-saving change in most zones: still exactly one day.
  assert.equal(addDays("2026-03-28", 1), "2026-03-29");
  assert.equal(addDays("2026-03-29", 1), "2026-03-30");
  assert.equal(daysUntil("2026-10-07", "2026-10-05"), 2);
  assert.equal(daysUntil("2026-10-04", "2026-10-05"), -1);
});

test("a monthly payment on the 31st lands on the last day of short months and returns to the 31st", () => {
  const s = make({ start: "2026-10-31" });
  const dates = Array.from({ length: 6 }, (_, i) => occurrence(s, i));
  assert.deepEqual(dates, [
    "2026-10-31",
    "2026-11-30",
    "2026-12-31",
    "2027-01-31",
    "2027-02-28",
    "2027-03-31",
  ]);
  assert.equal(occurrence(make({ start: "2027-01-29" }), 1), "2027-02-28");
  assert.equal(occurrence(make({ start: "2027-12-29" }), 2), "2028-02-29");
});

test("weekly and two-weekly payments keep their weekday", () => {
  const weekly = make({ frequency: "weekly", start: "2026-10-09" });
  assert.deepEqual(
    [0, 1, 2, 12].map((i) => occurrence(weekly, i)),
    ["2026-10-09", "2026-10-16", "2026-10-23", "2027-01-01"],
  );
  const biweekly = make({ frequency: "biweekly", start: "2026-10-09" });
  assert.equal(occurrence(biweekly, 3), "2026-11-20");
  assert.equal(describeFrequency(biweekly), "Every 2 weeks on Friday");
  assert.equal(describeFrequency(make({ start: "2026-11-01" })), "Every month on the 1st");
  assert.equal(describeFrequency(make({ start: "2026-11-12" })), "Every month on the 12th");
  assert.equal(describeFrequency(make({ start: "2026-11-22" })), "Every month on the 22nd");
});

test("the form refuses what cannot be paid, and says why", () => {
  const bad = [
    [{ label: "  " }, /name/],
    [{ recipient: "0x123" }, /recipient/],
    [{ recipient: owner }, /own wallet/],
    [{ asset: "" }, /asset/],
    [{ amount: "0" }, /above zero/],
    [{ amount: "0.000" }, /above zero/],
    [{ amount: "-5" }, /above zero/],
    [{ amount: "1e3" }, /above zero/],
    [{ frequency: "daily" }, /how often/],
    [{ start: "31/10/2026" }, /YYYY-MM-DD/],
    [{ start: "2026-10-04" }, /past/],
    [{ end: "soon" }, /end date/],
    [{ start: "2026-11-01", end: "2026-10-30" }, /before the first/],
  ];
  for (const [overrides, reason] of bad) {
    const result = parseSchedule(
      {
        label: "Rent",
        recipient: payee,
        asset: "USDG",
        amount: "500",
        frequency: "monthly",
        start: "2026-10-31",
        ...overrides,
      },
      { owner, now: NOW },
    );
    assert.equal(result.ok, false, JSON.stringify(overrides));
    assert.match(result.reason, reason);
  }
  // Today is allowed; a label loses invisible characters and is capped.
  const ok = make({ start: "2026-10-05", label: "Ren​t  ‮day", tag: "@Landlord" });
  assert.equal(ok.label, "Rent day");
  assert.equal(ok.tag, "landlord");
  assert.equal(ok.recipient, payee);
  assert.equal(make({ label: "x".repeat(80) }).label.length, LIMITS.maxLabel);
});

test("nothing is due before the first payment date", () => {
  const s = make({ start: "2026-10-31" });
  assert.equal(dueCount(s, "2026-10-30"), 0);
  assert.deepEqual(duePayments([s], "2026-10-30"), []);
  assert.equal(dueCount(s, "2026-10-31"), 1);
});

test("missed payments are each answered once, oldest first, and none is paid twice", () => {
  let list = [make({ start: "2026-10-31" })];
  const id = list[0].id;
  // The app was closed until February: four payments are due.
  let [due] = duePayments(list, "2027-02-28");
  assert.equal(due.date, "2026-10-31");
  assert.equal(due.count, 5);
  assert.match(
    reminderText(due, "2027-02-28"),
    /was due on 2026-10-31\. 4 more after it are also due\./,
  );

  let result = settle(list, id, "2026-10-31", { status: "paid", hash, now: NOW });
  assert.ok(result.ok);
  list = result.schedules;
  // A second tap on the same, now stale, payment changes nothing.
  const again = settle(list, id, "2026-10-31", { status: "paid", hash, now: NOW });
  assert.equal(again.ok, false);
  assert.match(again.reason, /already settled/);

  result = settle(list, id, "2026-11-30", { status: "skipped", now: NOW });
  list = result.schedules;
  [due] = duePayments(list, "2027-02-28");
  assert.equal(due.date, "2026-12-31");
  assert.equal(due.count, 3);
  assert.deepEqual(
    list[0].log.map(({ date, status, hash: h }) => [date, status, h]),
    [
      ["2026-11-30", "skipped", undefined],
      ["2026-10-31", "paid", hash],
    ],
  );
  assert.equal(reminderKey(due), `${id}:2026-12-31`);
});

test("a paused schedule is never due, and resuming keeps its place", () => {
  let list = [make({ start: "2026-10-05" })];
  const id = list[0].id;
  list = setPaused(list, id, true);
  assert.deepEqual(duePayments(list, "2026-12-10"), []);
  list = setPaused(list, id, false);
  const [due] = duePayments(list, "2026-12-10");
  assert.equal(due.date, "2026-10-05");
  assert.equal(due.count, 3);
});

test("a schedule with an end date stops after its last payment", () => {
  let list = [make({ frequency: "weekly", start: "2026-10-05", end: "2026-10-19" })];
  const id = list[0].id;
  assert.equal(dueCount(list[0], "2027-01-01"), 3);
  for (const date of ["2026-10-05", "2026-10-12", "2026-10-19"])
    list = settle(list, id, date, { status: "paid", hash, now: NOW }).schedules;
  assert.equal(nextPayment(list[0]), null);
  assert.deepEqual(duePayments(list, "2027-01-01"), []);
  // Ended schedules sort after those still running.
  const running = make({ label: "Allowance", start: "2026-11-01" });
  assert.deepEqual(
    sortedSchedules([...list, running]).map(({ schedule }) => schedule.label),
    ["Allowance", "Rent"],
  );
});

test("changing when a schedule runs starts its count again; renaming does not", () => {
  let list = [make({ start: "2026-10-05" })];
  const original = list[0];
  list = settle(list, original.id, "2026-10-05", { status: "paid", hash, now: NOW }).schedules;
  const renamed = parseSchedule(
    { ...list[0], label: "Flat rent" },
    { owner, existing: list[0], now: NOW },
  ).schedule;
  assert.equal(renamed.settled, 1);
  assert.equal(renamed.id, original.id);
  assert.equal(renamed.log.length, 1);
  const moved = parseSchedule(
    { ...list[0], start: "2026-10-20" },
    { owner, existing: list[0], now: NOW },
  ).schedule;
  assert.equal(moved.settled, 0);
});

test("stored data is cleaned on read, and the list is capped", () => {
  const good = make();
  const cleaned = cleanSchedules([
    good,
    good, // duplicate id
    { ...good, id: "x2", recipient: "nope" },
    { ...good, id: "x3", frequency: "hourly" },
    null,
    "rent",
    {
      ...good,
      id: "x4",
      settled: -3,
      log: [
        { date: "bad", status: "paid" },
        { date: "2026-10-31", status: "lost" },
      ],
    },
  ]);
  assert.deepEqual(
    cleaned.map((s) => s.id),
    [good.id, "x4"],
  );
  assert.equal(cleaned[1].settled, 0);
  assert.deepEqual(cleaned[1].log, []);
  assert.deepEqual(cleanSchedules(undefined), []);

  let list = [];
  for (let i = 0; i < LIMITS.maxSchedules; i += 1)
    list = saveSchedule(list, { ...good, id: `id${i}` }).schedules;
  const full = saveSchedule(list, { ...good, id: "one-more" });
  assert.equal(full.ok, false);
  assert.match(full.reason, /up to 50/);
  // Replacing one that exists is still allowed at the cap.
  assert.ok(saveSchedule(list, { ...good, id: "id3", label: "Changed" }).ok);
  assert.equal(removeSchedule(list, "id3").length, LIMITS.maxSchedules - 1);
});

test("reminders name the payee and when it fell due", () => {
  const s = make({ start: "2026-10-05", tag: "landlord" });
  const [due] = duePayments([s], "2026-10-05");
  assert.equal(reminderText(due, "2026-10-05"), "Rent: 500 USDG to @landlord is due today.");
  assert.equal(reminderText(due, "2026-10-06"), "Rent: 500 USDG to @landlord was due yesterday.");
  const [plain] = duePayments([make({ start: "2026-10-05" })], "2026-10-05");
  assert.match(reminderText(plain, "2026-10-05"), /to 0xaaaa…aaaa is due today/);
  assert.match(reminderText(plain, "2026-10-05", "Mum"), /to Mum is due today/);
  assert.ok(Object.keys(FREQUENCIES).length === 3);
});
