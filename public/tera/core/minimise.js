// Prompt minimisation before the assistant. The message is scrubbed on this
// device before it is sent: addresses, references, contact details and figures
// are replaced with placeholders, the skeleton is what leaves the browser, and
// the reply is re-hydrated here so the owner reads their own values back.
//
// This removes the literal values from the text. It does not make the owner
// anonymous, and nothing in this module should ever be described as if it did.

export const KIND_LABELS = {
  owner: "Your wallet address",
  address: "Wallet address",
  reference: "Transaction reference",
  payload: "Call data",
  email: "Email address",
  phone: "Phone number",
  name: "Name or ENS domain",
  amount: "Figure",
  label: "Saved label",
};

const KIND_PLURALS = {
  owner: "your wallet address",
  address: "wallet addresses",
  reference: "transaction references",
  payload: "call data payloads",
  email: "email addresses",
  phone: "phone numbers",
  name: "names or ENS domains",
  amount: "figures",
  label: "saved labels",
};

const TOKEN_NAMES = {
  owner: "YOUR_ADDRESS",
  address: "ADDRESS",
  reference: "REFERENCE",
  payload: "DATA",
  email: "EMAIL",
  phone: "PHONE",
  name: "NAME",
  amount: "AMOUNT",
  label: "LABEL",
};

// The proposal endpoint reads the recipient address and the figure out of the
// prompt text to build the transaction it hands back. Replacing those two would
// change what is prepared, so a proposal keeps them and says so. Everything
// else in the message is still removed.
export const PROPOSE_KEEP = ["owner", "address", "amount"];

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// One pass, one alternation. The first two branches are protective: a
// placeholder from an earlier pass and a standard reference such as ERC-3643
// are matched so that the figure inside them is never taken for an amount.
function scanner(labels) {
  const parts = [
    "(?<token>\\[[A-Z][A-Z_]*(?:_\\d+)?\\])",
    "(?<standard>\\b(?:ERC|EIP|BIP|SEP)-\\d+\\b)",
  ];
  if (labels.length) parts.push(`(?<label>${labels.map(escapeRegExp).join("|")})`);
  parts.push(
    "(?<reference>0x[\\da-f]{64}\\b)",
    "(?<address>0x[\\da-f]{40}\\b)",
    "(?<payload>0x[\\da-f]{8,}\\b)",
    "(?<email>[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+)",
    "(?<name>\\b[a-z\\d][a-z\\d-]*\\.(?:eth|xyz|crypto|sol|com|org|io|net|app|co|finance)\\b)",
    "(?<phone>\\+\\d[\\d\\s().-]{7,}\\d)",
    "(?<amount>\\$\\s?\\d[\\d,]*(?:\\.\\d+)?(?:\\s?[km])?\\b|\\b\\d[\\d,]*(?:\\.\\d+)?(?:\\s?[km])?\\b)",
  );
  return new RegExp(parts.join("|"), "gi");
}

// A bare small integer ("5 checks", "2 of them") carries nothing about the
// owner. A figure with a currency mark, a separator, a decimal, a k/m suffix or
// three or more digits does.
function isFigure(value) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return false;
  return /[$.,]/.test(value) || /[km]$/i.test(value.trim()) || digits.length >= 3;
}

function* scan(text, labels, owner) {
  for (const match of String(text).matchAll(scanner(labels))) {
    const groups = match.groups || {};
    const kind = Object.keys(groups).find((key) => groups[key] !== undefined);
    if (!kind || kind === "token" || kind === "standard") continue;
    const value = match[0];
    if (kind === "amount" && !isFigure(value)) continue;
    yield {
      kind: kind === "address" && owner && value.toLowerCase() === owner ? "owner" : kind,
      value,
      index: match.index,
    };
  }
}

/**
 * Scrub a message for the assistant.
 *
 * `keep` names the kinds that must survive verbatim because the service reads
 * them out of the text; they are still reported so the owner sees them.
 * `labels` are the owner's own counterparty names, matched before anything
 * else. `owner` marks the connected address so it reads as `[YOUR_ADDRESS]`.
 *
 * Returns the original text, the skeleton that may be sent, the placeholder
 * mapping — which never leaves this device — and the two segment lists the
 * side-by-side view is drawn from.
 */
export function minimise(text, options = {}) {
  const source = String(text ?? "");
  const labels = (options.labels || [])
    .map((label) => String(label).trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const keep = new Set(options.keep || []);
  const owner = options.owner ? String(options.owner).toLowerCase() : "";
  const placeholders = [];
  const kept = [];
  const counts = {};
  const counters = {};
  const seen = new Map();
  const typed = [];
  const sent = [];
  let last = 0;

  for (const found of scan(source, labels, owner)) {
    const before = source.slice(last, found.index);
    if (before) {
      typed.push({ text: before });
      sent.push({ text: before });
    }
    last = found.index + found.value.length;
    if (keep.has(found.kind)) {
      kept.push({ kind: found.kind, value: found.value });
      typed.push({ text: found.value, kind: found.kind, kept: true });
      sent.push({ text: found.value, kind: found.kind, kept: true });
      continue;
    }
    // The same value mentioned twice keeps the same placeholder, so the
    // message still reads as one story and re-hydration stays exact.
    const key = `${found.kind}:${found.value.toLowerCase()}`;
    let record = seen.get(key);
    if (!record) {
      counters[found.kind] = (counters[found.kind] || 0) + 1;
      const token =
        found.kind === "owner"
          ? "[YOUR_ADDRESS]"
          : `[${TOKEN_NAMES[found.kind]}_${counters[found.kind]}]`;
      record = { token, kind: found.kind, value: found.value };
      seen.set(key, record);
      placeholders.push(record);
      counts[found.kind] = (counts[found.kind] || 0) + 1;
    }
    typed.push({ text: found.value, kind: found.kind, token: record.token });
    sent.push({ text: record.token, kind: found.kind, token: record.token });
  }

  const tail = source.slice(last);
  if (tail) {
    typed.push({ text: tail });
    sent.push({ text: tail });
  }

  return {
    text: source,
    skeleton: sent.map((segment) => segment.text).join(""),
    placeholders,
    kept,
    counts,
    typed,
    sent,
  };
}

/**
 * Put the owner's own values back into a reply, on this device. Models echo a
 * placeholder in whatever case they like, so the match ignores it.
 */
export function rehydrate(text, placeholders = []) {
  let output = String(text ?? "");
  for (const { token, value } of placeholders)
    output = output.replace(new RegExp(escapeRegExp(token), "gi"), () => value);
  return output;
}

/**
 * A last line of defence, in the shape of `redact.leaks`: re-scan the skeleton
 * and report any kind still present that was meant to be replaced. A non-empty
 * result must stop the send.
 */
export function residual(skeleton, keep = []) {
  const allowed = new Set(keep);
  const kinds = new Set();
  for (const found of scan(skeleton, [], "")) if (!allowed.has(found.kind)) kinds.add(found.kind);
  // An address the owner asked to keep is reported as `address` by a bare
  // re-scan, because the connected address is not passed to this check.
  if (allowed.has("address")) kinds.delete("owner");
  return [...kinds].sort();
}

/** Plain lines for the legend: "2 wallet addresses", "1 figure". */
export function summary(result) {
  return Object.entries(result?.counts || {}).map(([kind, count]) =>
    count === 1 ? `1 ${KIND_LABELS[kind].toLowerCase()}` : `${count} ${KIND_PLURALS[kind]}`,
  );
}

/** The kinds kept verbatim, named once each, for the "kept as typed" line. */
export function keptKinds(result) {
  return [...new Set((result?.kept || []).map((entry) => entry.kind))].sort();
}
