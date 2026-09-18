// One reading of a checked receipt, for every surface that reports one.
//
// There are three places a receipt gets checked: the wallet's own dialog, the
// command-line verifier, and the offline page. The temptation in each is to
// write the summary sentence locally, because each has a different way of
// drawing a table. That is how a verifier drifts from the thing it verifies —
// not by computing a different answer, but by describing the same answer more
// kindly in the place the owner is most likely to read it.
//
// So the wording lives here, beside the states it describes, and a surface
// chooses only how to draw it.

import { PASS, FAIL, UNVERIFIABLE, SKIPPED, ORDER, labelFor, tally } from "./verdict.js";

export { PASS, FAIL, UNVERIFIABLE, SKIPPED };

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/**
 * The one sentence a reader gets before the table.
 *
 * `summarise` in `verdict.js` says this for the approval gates, in the language
 * of an action about to be taken. A receipt is the opposite tense — it reports
 * on something already done — and the unproven case means something different
 * here, so the sentence is written for it rather than borrowed.
 */
// The checks that establish the file describes its own turn. A failure among
// these means the text and the hashes disagree; a failure anywhere else does
// not, and must not borrow the sentence that says it does.
const COMMITMENT = new Set(["format", "input_hash", "output_hash", "short_ref", "digest"]);

export function headline(checks = []) {
  const counts = tally(checks);
  const total = checks.length;
  if (!total) return { status: SKIPPED, line: "Nothing was checked." };

  if (counts[FAIL]) {
    const failed = checks.filter((check) => check?.status === FAIL);
    // A receipt naming a build nobody published still describes its own turn
    // accurately. Saying otherwise would overstate the finding, which is the
    // failure mode this whole vocabulary exists to avoid — in the direction
    // that sounds appropriately severe, which is the easy direction to miss.
    if (failed.some((check) => COMMITMENT.has(check?.id)))
      return {
        status: FAIL,
        line: `${plural(counts[FAIL], "check failed", "checks failed")}. This receipt does not describe the turn it claims to.`,
      };
    const names = failed.map((check) => String(check?.label || check?.id).toLowerCase()).join(", ");
    return {
      status: FAIL,
      line: `${plural(counts[FAIL], "check failed", "checks failed")}: ${names}. The text matches the hashes recorded for it — what failed is something else this file claims.`,
    };
  }
  if (counts[UNVERIFIABLE])
    return {
      status: UNVERIFIABLE,
      line: `${plural(counts[PASS], "check", "checks")} passed. ${plural(counts[UNVERIFIABLE], "claim", "claims")} could not be established from the file alone — read ${counts[UNVERIFIABLE] === 1 ? "it" : "them"} before relying on this.`,
    };
  if (counts[SKIPPED] && !counts[PASS])
    return { status: SKIPPED, line: "No check could run against this file." };
  return {
    status: PASS,
    line: `${plural(counts[PASS], "check", "checks")} passed. The text in this file is the text the receipt commits to.`,
  };
}

/**
 * The checks, worst first.
 *
 * Ordered by `ORDER` rather than by the order they were run, because a reader
 * who stops after two lines should have read the two that matter. Nothing is
 * filtered out: a report that drops the skipped rows reads as a shorter, better
 * result than it is.
 */
export function rows(checks = []) {
  return [...checks]
    .sort((a, b) => ORDER.indexOf(a?.status) - ORDER.indexOf(b?.status))
    .map((check) => ({
      id: check?.id || "",
      label: check?.label || check?.id || "Check",
      status: check?.status || SKIPPED,
      mark: labelFor(check?.status, "receipt"),
      detail: check?.detail || "",
    }));
}

/**
 * What the file says about itself, as opposed to what was checked.
 *
 * Kept apart from the checks on purpose. Every field here is the receipt's own
 * claim, and a reader who sees them in the same table as the verified rows will
 * read them as verified too.
 */
export function claims(receipt = {}) {
  const stated = [
    ["Receipt", receipt.shortRef],
    ["Answered by", receipt.answeredBy],
    ["Read from", receipt.module],
    ["Model", receipt.model],
    ["Build release", receipt.release],
    ["Recorded at", receipt.at],
    ["Signed by", receipt.signer],
  ];
  return stated
    .filter(([, value]) => value !== undefined && value !== null && String(value) !== "")
    .map(([label, value]) => ({ label, value: String(value) }));
}

const RULE = "-".repeat(72);

/**
 * The whole report as plain text, for a terminal or a saved file.
 *
 * Deliberately not colour-coded: the state is in the word. A reader piping this
 * into a file, or reading it where colour does not survive, gets the same
 * report as someone looking at a terminal.
 */
export function text(result = {}, receipt = {}) {
  const checks = result.checks || [];
  const summary = headline(checks);
  const counts = tally(checks);
  const out = [];

  out.push("Tera receipt check");
  out.push(RULE);
  out.push(summary.line);
  out.push("");

  const stated = claims(receipt);
  if (stated.length) {
    out.push("What the file states about itself");
    for (const { label, value } of stated) out.push(`  ${label.padEnd(16)}${value}`);
    out.push("");
    out.push("  None of the above is checked by this tool. They are the file's own claims.");
    out.push("");
  }

  out.push("Checks");
  for (const row of rows(checks)) {
    out.push(`  [${row.mark.toUpperCase()}] ${row.label}`);
    if (row.detail) out.push(`      ${row.detail}`);
  }
  out.push("");
  out.push(
    `  ${counts[PASS]} passed, ${counts[FAIL]} failed, ${counts[UNVERIFIABLE]} unproven, ${counts[SKIPPED]} not applicable.`,
  );
  out.push(RULE);
  return out.join("\n");
}

/**
 * The process exit code for a checked receipt.
 *
 * Only a failed check is an error. An unproven claim is not a failure and must
 * not be reported as one — but it is not a clean pass either, so it gets a code
 * of its own rather than being folded into success.
 */
export function exitCode(result = {}) {
  const counts = tally(result.checks || []);
  if (counts[FAIL]) return 1;
  if (counts[UNVERIFIABLE]) return 2;
  return 0;
}
