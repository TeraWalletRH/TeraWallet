// Prompt minimisation for the native assistant. Values in this mapping never
// leave the device: only the placeholder skeleton is sent to the service.
export type Placeholder = { token: string; kind: string; value: string };
export type MinimiseResult = {
  text: string;
  skeleton: string;
  placeholders: Placeholder[];
  kept: { kind: string; value: string }[];
};

export const PROPOSAL_KEEP = ["owner", "address", "amount"];

const names: Record<string, string> = {
  owner: "YOUR_ADDRESS",
  address: "ADDRESS",
  reference: "REFERENCE",
  email: "EMAIL",
  phone: "PHONE",
  name: "NAME",
  amount: "AMOUNT",
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isFigure = (value: string) => {
  const digits = value.replace(/\D/g, "");
  return !!digits && (/[$.,]/.test(value) || /[km]$/i.test(value.trim()) || digits.length >= 3);
};

type Match = { index: number; value: string; kind: string };
function matches(text: string, owner: string): Match[] {
  const pattern = /(?<token>\[[A-Z][A-Z_]*(?:_\d+)?\])|(?<standard>\b(?:ERC|EIP|BIP|SEP)-\d+\b)|(?<reference>0x[\da-f]{64}\b)|(?<address>0x[\da-f]{40}\b)|(?<email>[\w.+-]+@[\w-]+(?:\.[\w-]+)+)|(?<name>\b[a-z\d][a-z\d-]*\.(?:eth|xyz|crypto|sol|com|org|io|net|app|co|finance)\b)|(?<phone>\+\d[\d\s().-]{7,}\d)|(?<amount>\$\s?\d[\d,]*(?:\.\d+)?(?:\s?[km])?\b|\b\d[\d,]*(?:\.\d+)?(?:\s?[km])?\b)/gi;
  const found: Match[] = [];
  for (const item of text.matchAll(pattern)) {
    const groups = item.groups || {};
    const kind = Object.keys(groups).find((key) => groups[key] !== undefined);
    if (!kind || kind === "token" || kind === "standard" || (kind === "amount" && !isFigure(item[0]))) continue;
    found.push({ index: item.index || 0, value: item[0], kind: kind === "address" && owner && item[0].toLowerCase() === owner.toLowerCase() ? "owner" : kind });
  }
  return found;
}

export function minimise(text: string, options: { owner?: string; keep?: string[] } = {}): MinimiseResult {
  const source = String(text || "");
  const keep = new Set(options.keep || []);
  const placeholders: Placeholder[] = [];
  const kept: { kind: string; value: string }[] = [];
  const seen = new Map<string, Placeholder>();
  const counts: Record<string, number> = {};
  let skeleton = "";
  let last = 0;
  for (const item of matches(source, options.owner || "")) {
    skeleton += source.slice(last, item.index);
    last = item.index + item.value.length;
    if (keep.has(item.kind)) { kept.push(item); skeleton += item.value; continue; }
    const key = `${item.kind}:${item.value.toLowerCase()}`;
    let entry = seen.get(key);
    if (!entry) {
      counts[item.kind] = (counts[item.kind] || 0) + 1;
      entry = { token: item.kind === "owner" ? "[YOUR_ADDRESS]" : `[${names[item.kind]}_${counts[item.kind]}]`, kind: item.kind, value: item.value };
      seen.set(key, entry);
      placeholders.push(entry);
    }
    skeleton += entry.token;
  }
  return { text: source, skeleton: skeleton + source.slice(last), placeholders, kept };
}

export function rehydrate(text: string, placeholders: Placeholder[]) {
  return placeholders.reduce((value, entry) => value.replace(new RegExp(escapeRegExp(entry.token), "gi"), () => entry.value), String(text || ""));
}

export function residual(text: string, keep: string[] = []) {
  const allowed = new Set(keep);
  return [...new Set(matches(text, "").map((item) => item.kind).filter((kind) => !allowed.has(kind)))];
}
