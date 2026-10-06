// Recurring payments: rent on the 1st, a salary every other Friday, pocket money
// every week.
//
// Tera never holds the owner's key, so it cannot pay anyone while they are away
// and does not pretend to. A schedule is a reminder with the payment already
// written out: when one falls due, the owner is told, opens the normal send
// screen with the recipient, asset, amount and note filled in, reads the same
// checks every send gets, and signs. Nothing leaves the wallet on a timer.
//
// A schedule is private and local, like a contact. It is written into the
// owner's encrypted data on this device — the vault on web, the sealed data file
// on Android — and is never sent to Tera.
//
// Dates are calendar days, "YYYY-MM-DD", read in the owner's own time zone. A
// payment due "on the 1st" is due on the 1st where the owner is, and a schedule
// moved between devices in different zones keeps its days rather than drifting
// by one.
//
// The rules, each one a test:
//
//   A monthly payment keeps the day it started on. One that starts on the 31st
//   is paid on the last day of shorter months and back on the 31st after them,
//   never sliding to the 28th for good.
//
//   Every due payment is answered once. A payment is either paid or skipped,
//   and only then does the next one come due. If the app was closed for three
//   months, the owner sees that three are due and settles them one at a time —
//   none is paid twice and none disappears.
//
//   The address is what gets paid. A schedule may remember the tag it was set
//   up with; the send screen resolves the tag again when the payment is made,
//   and the review shows the address that will be signed.
//
//   Robinhood Chain only, the same as contacts and tags.
//
// A schedule is one of two kinds. A payment sends an asset to someone. A buy
// (dollar-cost averaging) spends a fixed amount on an asset at each date: when
// it is due the swap screen opens filled in, the owner reads the live quote and
// signs. Each completed buy records what was spent and what was received, so
// the owner can see their average price. The amount received is first the
// quoted figure and is replaced by what the transaction actually delivered
// once its receipt is read; until then it is marked as an estimate.

export const ScheduleError = class ScheduleError extends Error {};

/** The published limits, quoted in the form and in the tests. */
export const LIMITS = { maxSchedules: 50, maxLabel: 40, maxLog: 24 };

/** What a schedule does at each date. */
export const KINDS = ["payment", "buy"];

/** What a buy of `asset` is paid with: ETH for TERA, USDG for everything else. */
export const payAssetFor = (asset) => (asset === "TERA" ? "ETH" : "USDG");

/** How often a schedule repeats. Days between payments, or monthly by date. */
export const FREQUENCIES = {
  weekly: { label: "Every week", days: 7 },
  biweekly: { label: "Every 2 weeks", days: 14 },
  monthly: { label: "Every month", days: 0 },
};

const ADDRESS = /^0x[0-9a-f]{40}$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const AMOUNT = /^\d+(\.\d+)?$/;
const SYMBOL = /^[A-Za-z0-9.]{1,12}$/;
const TAG = /^@?[a-z0-9_]{1,32}$/i;
// Control characters, zero-width characters, bidi embeddings and overrides, and
// the byte order mark — the same set contacts.js strips from a name.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f­​-‏‪-‮⁠-⁤⁦-⁯﻿]/g;

const pad = (n) => String(n).padStart(2, "0");

/** A calendar day as "YYYY-MM-DD", from a Date read in local time. */
export const dayKey = (date = new Date()) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** Today, where the owner is. */
export const today = (now = Date.now()) => dayKey(new Date(now));

/** Parse "YYYY-MM-DD" into its parts, or null when it is not a real day. */
export function parseDay(text) {
  const match = DAY.exec(String(text ?? "").trim());
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export const isDay = (text) => parseDay(text) !== null;

/** Days in a month, `month` counted from 1. */
export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// Day arithmetic in UTC, so a daylight-saving change cannot add or lose a day.
const toUtc = ({ year, month, day }) => Date.UTC(year, month - 1, day);
const fromUtc = (ms) => {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};

/** `day` moved by `count` days. */
export function addDays(day, count) {
  const parts = parseDay(day);
  if (!parts) throw new ScheduleError("Invalid date.");
  return fromUtc(toUtc(parts) + count * 86_400_000);
}

/**
 * The `index`th payment date of a schedule, counted from 0 at its start.
 *
 * Monthly payments land on the start's day of the month, or the last day of a
 * month too short to have it.
 */
export function occurrence(schedule, index) {
  const start = parseDay(schedule.start);
  if (!start) throw new ScheduleError("Invalid start date.");
  const frequency = FREQUENCIES[schedule.frequency];
  if (!frequency) throw new ScheduleError("Invalid frequency.");
  if (frequency.days) return addDays(schedule.start, index * frequency.days);
  const months = start.month - 1 + index;
  const year = start.year + Math.floor(months / 12);
  const month = (months % 12) + 1;
  const day = Math.min(start.day, daysInMonth(year, month));
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * The next payment not yet paid or skipped, as `{ date, index }`, or null when
 * the schedule has ended.
 */
export function nextPayment(schedule) {
  const index = Number.isSafeInteger(schedule.settled) ? schedule.settled : 0;
  const date = occurrence(schedule, index);
  if (schedule.end && date > schedule.end) return null;
  return { date, index };
}

/**
 * How many payments have fallen due by `on` and are not yet answered. The next
 * one is the oldest of them.
 */
export function dueCount(schedule, on) {
  if (schedule.paused) return 0;
  let count = 0;
  let index = Number.isSafeInteger(schedule.settled) ? schedule.settled : 0;
  // A year of weekly payments is the most an owner can be behind on and still
  // be shown an exact count; past that the count is capped, not looped forever.
  while (count < 60) {
    const date = occurrence(schedule, index);
    if (date > on || (schedule.end && date > schedule.end)) break;
    count += 1;
    index += 1;
  }
  return count;
}

/**
 * Every schedule with a payment due by `on`, oldest due first:
 * `{ schedule, date, count }`, where `date` is the payment to settle next and
 * `count` is how many are due including it.
 */
export function duePayments(schedules, on) {
  const due = [];
  for (const schedule of cleanSchedules(schedules)) {
    const count = dueCount(schedule, on);
    if (!count) continue;
    due.push({ schedule, date: nextPayment(schedule).date, count });
  }
  return due.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Days from `on` until a date, negative when it has passed. */
export function daysUntil(date, on) {
  const a = parseDay(on);
  const b = parseDay(date);
  if (!a || !b) return NaN;
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

const ORDINAL = (n) => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;
};
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "Every month on the 1st", "Every 2 weeks on Friday". */
export function describeFrequency(schedule) {
  const start = parseDay(schedule.start);
  const frequency = FREQUENCIES[schedule.frequency];
  if (!start || !frequency) return "";
  if (!frequency.days) return `${frequency.label} on the ${ORDINAL(start.day)}`;
  return `${frequency.label} on ${WEEKDAYS[new Date(toUtc(start)).getUTCDay()]}`;
}

/** A label with invisible characters removed and spacing collapsed. */
export function cleanLabel(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LIMITS.maxLabel);
}

/** A tag as stored: lowercase, without the "@". "" when it is not one. */
const cleanTag = (text) => {
  const tag = String(text ?? "").trim();
  return TAG.test(tag) ? tag.replace(/^@/, "").toLowerCase() : "";
};

/**
 * Read what the owner filled in and return the schedule to store.
 *
 * Returns `{ ok, schedule, reason }` rather than throwing, because the form
 * shows the reason as it is. `existing` is the schedule being edited, whose id,
 * history and progress are kept.
 *
 * @param {Record<string, any>} input
 * @param {{ owner?: string, existing?: any, now?: number }} [options]
 * @returns {{ ok: boolean, schedule: any, reason: string }}
 */
export function parseSchedule(input, { owner = "", existing = null, now = Date.now() } = {}) {
  const fail = (reason) => ({ ok: false, schedule: null, reason });
  const kind = input?.kind === "buy" ? "buy" : "payment";
  const label = cleanLabel(input?.label);
  if (!label)
    return fail(
      kind === "buy"
        ? "Give the buy a name, like Weekly TERA."
        : "Give the payment a name, like Rent.",
    );

  let recipient = "";
  if (kind === "payment") {
    recipient = String(input?.recipient ?? "")
      .trim()
      .toLowerCase();
    if (!ADDRESS.test(recipient)) return fail("Enter a valid recipient address.");
    if (owner && recipient === String(owner).toLowerCase())
      return fail("This is your own wallet. Choose who the payment goes to.");
  }

  const asset = String(input?.asset ?? "").trim();
  if (!SYMBOL.test(asset))
    return fail(kind === "buy" ? "Choose what to buy." : "Choose the asset to pay in.");
  if (kind === "buy" && asset === "USDG") return fail("Choose an asset other than USDG to buy.");

  const amount = String(input?.amount ?? "").trim();
  if (!AMOUNT.test(amount) || !/[1-9]/.test(amount)) return fail("Enter an amount above zero.");

  const frequency = String(input?.frequency ?? "");
  if (!FREQUENCIES[frequency]) return fail("Choose how often it repeats.");

  const start = String(input?.start ?? "").trim();
  if (!isDay(start)) return fail("Enter the first payment date as YYYY-MM-DD.");
  // A new schedule cannot begin in the past: it would arrive already overdue.
  // An edited one keeps its start, so its history still lines up.
  if (!existing && start < today(now)) return fail("The first payment cannot be in the past.");

  const end = String(input?.end ?? "").trim();
  if (end && !isDay(end)) return fail("Enter the end date as YYYY-MM-DD, or leave it empty.");
  if (end && end < start) return fail("The end date is before the first payment.");

  const sameTiming = existing && existing.start === start && existing.frequency === frequency;
  const schedule = {
    id: existing?.id || newId(now),
    kind,
    label,
    recipient,
    tag: kind === "payment" ? cleanTag(input?.tag) : "",
    asset,
    // What a buy spends, fixed by the asset so a stored schedule cannot name a
    // pair the swap screen does not offer.
    payAsset: kind === "buy" ? payAssetFor(asset) : asset,
    amount,
    frequency,
    start,
    end: end || null,
    paused: Boolean(existing?.paused),
    // Changing when a schedule runs starts its count again, so the old count
    // cannot point at a date the new timing never has.
    settled: sameTiming ? existing.settled || 0 : 0,
    log: existing?.log ? existing.log.slice(0, LIMITS.maxLog) : [],
    totals: kind === "buy" ? cleanTotals(existing?.totals) : undefined,
    createdAt: existing?.createdAt || now,
  };
  if (kind !== "buy") delete schedule.totals;
  return { ok: true, schedule, reason: "" };
}

const newId = (now) =>
  `s${now.toString(36)}${Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, "0")}`;

/** Keep only well-formed schedules. What a stored list means, whatever it held. */
export function cleanSchedules(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of list) {
    if (!entry || typeof entry.id !== "string" || seen.has(entry.id)) continue;
    const parsed = parseSchedule(entry, { existing: entry });
    if (!parsed.ok) continue;
    const log = Array.isArray(entry.log)
      ? entry.log
          .filter(
            (item) =>
              item && isDay(item.date) && (item.status === "paid" || item.status === "skipped"),
          )
          .map((item) => ({
            date: item.date,
            status: item.status,
            ...(typeof item.hash === "string" && /^0x[0-9a-f]{64}$/i.test(item.hash)
              ? { hash: item.hash.toLowerCase() }
              : {}),
            at: Number.isSafeInteger(item.at) ? item.at : 0,
            ...(isAmount(item.spent) ? { spent: item.spent } : {}),
            ...(isAmount(item.received) ? { received: item.received } : {}),
            ...(item.estimated ? { estimated: true } : {}),
          }))
          .slice(0, LIMITS.maxLog)
      : [];
    seen.add(entry.id);
    out.push({
      ...parsed.schedule,
      settled: Number.isSafeInteger(entry.settled) && entry.settled >= 0 ? entry.settled : 0,
      log,
    });
    if (out.length >= LIMITS.maxSchedules) break;
  }
  return out;
}

/** Add or replace a schedule. Returns `{ ok, schedules, reason }`. */
export function saveSchedule(schedules, schedule) {
  const current = cleanSchedules(schedules);
  const exists = current.some((entry) => entry.id === schedule.id);
  if (!exists && current.length >= LIMITS.maxSchedules)
    return {
      ok: false,
      schedules: current,
      reason: `You can keep up to ${LIMITS.maxSchedules} scheduled payments. Remove one first.`,
    };
  const next = exists
    ? current.map((entry) => (entry.id === schedule.id ? schedule : entry))
    : [...current, schedule];
  return { ok: true, schedules: next, reason: "" };
}

/** The list without this schedule. Removing an unknown id is not an error. */
export const removeSchedule = (schedules, id) =>
  cleanSchedules(schedules).filter((entry) => entry.id !== id);

/** The schedule with this id, or null. */
export const scheduleFor = (schedules, id) =>
  cleanSchedules(schedules).find((entry) => entry.id === id) ?? null;

/**
 * Answer the payment due on `date` — paid, with the transaction hash, or
 * skipped — and move the schedule on to its next payment.
 *
 * Only the payment that is actually next can be answered, so a payment cannot
 * be marked twice by a second tap or a stale screen.
 */
export function settle(
  schedules,
  id,
  date,
  { status, hash = "", spent = "", received = "", estimated = false, now = Date.now() },
) {
  const current = cleanSchedules(schedules);
  const schedule = current.find((entry) => entry.id === id);
  if (!schedule)
    return { ok: false, schedules: current, reason: "That schedule no longer exists." };
  const next = nextPayment(schedule);
  if (!next || next.date !== date)
    return { ok: false, schedules: current, reason: "That payment was already settled." };
  if (status !== "paid" && status !== "skipped")
    return { ok: false, schedules: current, reason: "Invalid status." };
  const entry = { date, status, at: now };
  if (status === "paid" && /^0x[0-9a-f]{64}$/i.test(hash)) entry.hash = hash.toLowerCase();
  const updated = {
    ...schedule,
    settled: next.index + 1,
    log: [entry, ...schedule.log].slice(0, LIMITS.maxLog),
  };
  // A completed buy adds to the running totals, which outlive the capped log.
  if (schedule.kind === "buy" && status === "paid" && isAmount(spent) && isAmount(received)) {
    entry.spent = spent;
    entry.received = received;
    if (estimated) entry.estimated = true;
    updated.totals = {
      buys: schedule.totals.buys + 1,
      spent: addDecimal(schedule.totals.spent, spent),
      received: addDecimal(schedule.totals.received, received),
    };
  }
  return {
    ok: true,
    schedules: current.map((item) => (item.id === id ? updated : item)),
    reason: "",
  };
}

/** Pause or resume. A paused schedule is never due; resuming keeps its place. */
export function setPaused(schedules, id, paused) {
  return cleanSchedules(schedules).map((entry) =>
    entry.id === id ? { ...entry, paused: Boolean(paused) } : entry,
  );
}

/** Schedules for a list the owner scans: those with a next payment, soonest first, then ended. */
export function sortedSchedules(schedules) {
  const keyed = cleanSchedules(schedules).map((schedule) => ({
    schedule,
    next: nextPayment(schedule),
  }));
  keyed.sort((a, b) => {
    if (!a.next !== !b.next) return a.next ? -1 : 1;
    if (a.next && b.next && a.next.date !== b.next.date) return a.next.date < b.next.date ? -1 : 1;
    return a.schedule.label.localeCompare(b.schedule.label);
  });
  return keyed;
}

const isAmount = (value) => typeof value === "string" && AMOUNT.test(value);

/**
 * Exact decimal addition on strings, so totals of token amounts never pick up
 * floating-point error however many buys are added.
 */
export function addDecimal(a, b) {
  const [ai, af = ""] = String(a).split(".");
  const [bi, bf = ""] = String(b).split(".");
  const places = Math.max(af.length, bf.length);
  const sum = BigInt(ai + af.padEnd(places, "0")) + BigInt(bi + bf.padEnd(places, "0"));
  return fromScaled(sum, places);
}

/** `a - b` for decimal strings, never below zero. */
function subtractDecimal(a, b) {
  const [ai, af = ""] = String(a).split(".");
  const [bi, bf = ""] = String(b).split(".");
  const places = Math.max(af.length, bf.length);
  const diff = BigInt(ai + af.padEnd(places, "0")) - BigInt(bi + bf.padEnd(places, "0"));
  return fromScaled(diff < 0n ? 0n : diff, places);
}

function fromScaled(value, places) {
  if (!places) return value.toString();
  const text = value.toString().padStart(places + 1, "0");
  const whole = text.slice(0, -places);
  const fraction = text.slice(-places).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function cleanTotals(totals) {
  return {
    buys: Number.isSafeInteger(totals?.buys) && totals.buys >= 0 ? totals.buys : 0,
    spent: isAmount(totals?.spent) ? totals.spent : "0",
    received: isAmount(totals?.received) ? totals.received : "0",
  };
}

/**
 * Replace a buy's quoted amount with what its transaction actually delivered,
 * read from the receipt. Only an entry still marked as an estimate changes, so
 * reading the same receipt twice changes nothing the second time.
 */
export function recordFill(schedules, id, hash, received) {
  const current = cleanSchedules(schedules);
  const schedule = current.find((entry) => entry.id === id);
  const target = String(hash).toLowerCase();
  const index = schedule?.log.findIndex((item) => item.hash === target) ?? -1;
  if (!schedule || index < 0 || !isAmount(received)) return current;
  const entry = schedule.log[index];
  if (!entry.estimated || !isAmount(entry.received)) return current;
  const log = [...schedule.log];
  log[index] = { ...entry, received, estimated: undefined };
  delete log[index].estimated;
  const totals = {
    ...schedule.totals,
    received: addDecimal(subtractDecimal(schedule.totals.received, entry.received), received),
  };
  return current.map((item) => (item.id === id ? { ...schedule, log, totals } : item));
}

/**
 * How a recurring buy is going: number of buys, totals, and the average price
 * paid per unit of the asset, in the asset it was paid with. `average` is null
 * before anything has been received. `estimated` says whether any buy in the
 * recent log still carries a quoted rather than a delivered amount.
 */
export function buyProgress(schedule) {
  const totals = cleanTotals(schedule?.totals);
  const received = Number(totals.received);
  return {
    buys: totals.buys,
    spent: totals.spent,
    received: totals.received,
    average: received > 0 ? Number(totals.spent) / received : null,
    estimated: (schedule?.log || []).some((item) => item.estimated),
  };
}

/** One line for a reminder: "Rent: 500 USDG to @landlord is due today." */
export function reminderText(due, on, recipientName = "") {
  const { schedule, date, count } = due;
  const who = recipientName || (schedule.tag ? `@${schedule.tag}` : short(schedule.recipient));
  const days = daysUntil(date, on);
  const when =
    days === 0 ? "is due today" : days === -1 ? "was due yesterday" : `was due on ${date}`;
  const more =
    count > 1 ? ` ${count - 1} more after it ${count === 2 ? "is" : "are"} also due.` : "";
  if (schedule.kind === "buy")
    return `${schedule.label}: buy ${schedule.asset} with ${schedule.amount} ${schedule.payAsset} ${when}.${more}`;
  return `${schedule.label}: ${schedule.amount} ${schedule.asset} to ${who} ${when}.${more}`;
}

/** A key that names one reminder, so each due payment is announced once. */
export const reminderKey = (due) => `${due.schedule.id}:${due.date}`;

export const PRIVACY_NOTE =
  "Scheduled payments are kept in your encrypted data on this device and are never sent to Tera. Tera cannot pay them for you: when one is due you review and sign it like any other send.";

const short = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`;
