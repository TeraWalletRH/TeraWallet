// The signature log: a record, kept on this device, of every message the
// wallet has signed. No storage or network access of its own;
// android/src/storage.ts writes it (sealed, per wallet) at the one place
// every signature is made, and android/App.tsx shows it.
//
// A transaction leaves a public trace on chain. A signed message leaves none:
// it can log you in, approve a team payment or prove you own an address, and
// afterwards nothing shows it ever happened. This keeps that trace for the
// owner.
//
// The rules, each one a test:
//
//   Every signature gets an entry: when, which account, who asked (the
//   service the wallet was talking to), what it was (the first line of the
//   message, or the typed-data type), and the full content, decoded.
//
//   Newest first, at most 200 entries; the oldest drop off. Very long content
//   is cut at 4,000 characters and says so.
//
//   The signature itself is kept short (start and end), enough to match it
//   against one shown elsewhere, without keeping a reusable copy around.
//
//   Logging can be turned off, and the log cleared.

export const MAX_ENTRIES = 200;
export const MAX_TEXT = 4000;

const TYPED_TITLES = {
  SafeTx: "Safe transaction",
  Permit: "Token permit",
  PermitSingle: "Permit2 approval",
  PermitBatch: "Permit2 approval",
  PermitTransferFrom: "Permit2 transfer",
  OrderComponents: "Marketplace order",
};

const cut = (text) => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n… (cut at ${MAX_TEXT} characters)` : text);
const short = (signature) => {
  const s = String(signature ?? "");
  return s.length > 22 ? `${s.slice(0, 10)}…${s.slice(-8)}` : s;
};

/** A signed message as text: a string as is, raw bytes as hex. */
export function messageText(message) {
  if (typeof message === "string") return message;
  const raw = message?.raw;
  if (typeof raw === "string") return raw;
  if (raw && typeof raw.length === "number")
    return `0x${Array.from(raw, (b) => Number(b).toString(16).padStart(2, "0")).join("")}`;
  return String(message ?? "");
}

/** JSON with big integers written as decimal strings. */
export const typedText = (typed) =>
  JSON.stringify(
    { domain: typed?.domain, primaryType: typed?.primaryType, message: typed?.message },
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    2,
  );

/**
 * The log entry for one signature.
 * input: { kind: "message" | "typed", message?, typed?, address, site, signature, now? }
 */
export function entryFor(input) {
  const at = input.now ?? Date.now();
  if (input.kind === "typed") {
    const type = String(input.typed?.primaryType ?? "");
    const name = input.typed?.domain?.name;
    return {
      at,
      kind: "typed",
      address: input.address,
      site: input.site,
      title: TYPED_TITLES[type] || (type ? `Typed data: ${type}` : "Typed data"),
      detail: name ? String(name) : undefined,
      text: cut(typedText(input.typed)),
      signature: short(input.signature),
    };
  }
  const text = messageText(input.message);
  const first = text.split("\n").map((line) => line.trim()).find(Boolean) || "Empty message";
  return {
    at,
    kind: "message",
    address: input.address,
    site: input.site,
    title: first.length > 80 ? `${first.slice(0, 79)}…` : first,
    text: cut(text),
    signature: short(input.signature),
  };
}

/** The log with `entry` added: newest first, capped. Unchanged if logging is off. */
export function append(log, entry) {
  const current = log || {};
  if (current.off) return current;
  return { ...current, items: [entry, ...(current.items || [])].slice(0, MAX_ENTRIES) };
}

/** Entries whose title, content, site or account contain `query` (any case). */
export function search(items, query) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return items || [];
  return (items || []).filter((e) =>
    [e.title, e.detail, e.text, e.site, e.address].some((v) => String(v ?? "").toLowerCase().includes(q)),
  );
}
