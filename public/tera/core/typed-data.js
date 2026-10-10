// Signature requests in plain language. No network access of its own.
//
// A typed-data signature (eth_signTypedData_v4) costs no gas and sends no
// transaction, which is exactly why it is the favourite tool of wallet
// drainers: one "Sign" on a token Permit or a Permit2 message lets someone
// else move your tokens later, with no further question asked. Wallets
// usually show the raw JSON; this says what it does.
//
// The rules, each one a test:
//
//   A permit is the dangerous kind. ERC-2612 Permit, DAI-style permit and
//   every Permit2 message are red: they hand spending power to someone else.
//   An amount at or above 2^128 base units, or a DAI-style "allowed", is
//   shown as unlimited.
//
//   A transfer permit (Permit2 SignatureTransfer) is worse than an allowance:
//   the spender can take the tokens at once, so it says so.
//
//   A message that names Permit2 by its type but is addressed to another
//   contract is an imitation, and is flagged.
//
//   A request for another chain, an expiry years away, and a spender that is
//   not one Tera knows are each called out.
//
//   Anything not recognised is shown field by field and marked as unknown —
//   never as safe. Not knowing what a signature does is a reason to refuse it.

export const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";
export const UNLIMITED_FROM = 2n ** 128n;
const YEAR = 365 * 24 * 3600;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const lower = (value) => String(value ?? "").toLowerCase();
const big = (value) => {
  try {
    return BigInt(value);
  } catch {
    return null;
  }
};
const short = (address) => (ADDRESS.test(String(address)) ? `${address.slice(0, 6)}…${address.slice(-4)}` : String(address));

/**
 * The typed data inside whatever was pasted: the typed-data object itself, its
 * JSON, an eth_signTypedData request, or that request's params. Throws when
 * there is none.
 */
export function parseRequest(input) {
  let value = input;
  for (let depth = 0; depth < 4; depth++) {
    if (typeof value === "string") {
      const text = value.trim();
      try {
        value = JSON.parse(text);
      } catch {
        throw new Error("That isn't a signature request. Paste the JSON the site asked you to sign.");
      }
      continue;
    }
    if (Array.isArray(value)) {
      // [address, typedData] for v4; some sites send [typedData, address].
      const signer = value.find((item) => typeof item === "string" && ADDRESS.test(item));
      const data = value.find((item) => item !== signer);
      if (data === undefined) break;
      const parsed = parseRequest(data);
      return { ...parsed, signer: parsed.signer || (signer ? lower(signer) : null) };
    }
    if (value && typeof value === "object") {
      if (value.params) {
        value = value.params;
        continue;
      }
      if (value.primaryType && value.message && value.domain) return { typed: value, signer: null };
    }
    break;
  }
  throw new Error("That isn't a signature request. Paste the JSON the site asked you to sign.");
}

/** "1,000 USDG", "Unlimited USDG", or base units when the token is unknown. */
export function formatAmount(raw, token, tokens = {}) {
  const amount = big(raw);
  const meta = tokens[lower(token)];
  const symbol = meta?.symbol || short(token);
  if (amount === null) return `${raw} ${symbol}`;
  if (amount >= UNLIMITED_FROM) return `Unlimited ${symbol}`;
  if (!meta) return `${amount.toString()} base units of ${symbol}`;
  const unit = 10n ** BigInt(meta.decimals);
  const whole = amount / unit;
  const frac = (amount % unit).toString().padStart(meta.decimals, "0").replace(/0+$/, "").slice(0, 6);
  return `${whole.toLocaleString("en-US")}${frac ? `.${frac}` : ""} ${symbol}`;
}

function when(seconds, now) {
  const at = big(seconds);
  if (at === null) return { text: String(seconds), far: false };
  if (at === 0n) return { text: "Never expires", far: true };
  if (at >= 2n ** 47n) return { text: "Never expires", far: true };
  const n = Number(at);
  return { text: new Date(n * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC", far: n - now > YEAR };
}

/**
 * What a typed-data request does.
 *
 * Returns { kind, danger: "high" | "unknown" | "low", title, rows: [[label, value]], warnings: [text] }.
 * context: { chainId, owner, now (seconds), tokens: {address: {symbol, decimals}}, spenders: {address: name} }
 */
export function explain(typed, context = {}) {
  const { chainId, owner, now = Math.floor(Date.now() / 1000), tokens = {}, spenders = {} } = context;
  const domain = typed?.domain || {};
  const message = typed?.message || {};
  const type = String(typed?.primaryType || "");
  const contract = lower(domain.verifyingContract);
  const warnings = [];
  const spenderName = (address) => spenders[lower(address)] || null;
  const who = (address) => spenderName(address) || short(address);
  const spenderWarning = (address) => {
    if (!spenderName(address)) warnings.push(`The spender ${short(address)} is not a contract Tera knows. Make sure you trust the site that asked.`);
  };
  const expiryWarning = (expiry) => {
    if (expiry.far) warnings.push("This permission lasts more than a year, or never expires.");
  };
  if (domain.chainId != null && chainId != null && big(domain.chainId) !== BigInt(chainId))
    warnings.push(`This request is for chain ${domain.chainId}, not Robinhood Chain (${chainId}).`);
  const signerField = message.owner ?? message.holder ?? message.from;
  if (owner && ADDRESS.test(String(signerField)) && lower(signerField) !== lower(owner))
    warnings.push(`It is written for ${short(signerField)}, not this wallet.`);
  const permit2Type = ["PermitSingle", "PermitBatch", "PermitTransferFrom", "PermitBatchTransferFrom", "PermitWitnessTransferFrom"].includes(type);
  if (permit2Type && contract !== PERMIT2)
    warnings.push(`It is shaped like a Permit2 message but is addressed to ${short(contract)}, not Permit2. Treat it as an imitation.`);
  const rows = [];
  const result = (kind, danger, title) => {
    rows.push(["Asked by", domain.name ? String(domain.name) : "Unnamed site"]);
    if (contract) rows.push(["Contract", short(contract)]);
    if (domain.chainId != null) rows.push(["Chain", String(domain.chainId)]);
    return { kind, danger, title, rows, warnings };
  };

  // ERC-2612: Permit(owner, spender, value, nonce, deadline), on the token itself.
  if (type === "Permit" && "spender" in message && "value" in message) {
    const amount = formatAmount(message.value, contract, tokens);
    const expiry = when(message.deadline, now);
    rows.push(["Lets spend", amount], ["Spender", who(message.spender)], ["Valid until", expiry.text]);
    spenderWarning(message.spender);
    expiryWarning(expiry);
    return result("permit", "high", `This lets ${who(message.spender)} spend ${amount} from your wallet`);
  }
  // DAI-style: Permit(holder, spender, nonce, expiry, allowed).
  if (type === "Permit" && "allowed" in message) {
    const token = tokens[contract]?.symbol || short(contract);
    const expiry = when(message.expiry, now);
    const on = message.allowed === true || message.allowed === "true";
    rows.push(["Lets spend", on ? `Unlimited ${token}` : "Nothing (removes permission)"], ["Spender", who(message.spender)], ["Valid until", expiry.text]);
    if (!on) return result("permit", "low", `This removes ${who(message.spender)}'s permission to spend ${token}`);
    spenderWarning(message.spender);
    expiryWarning(expiry);
    return result("permit", "high", `This lets ${who(message.spender)} spend all of your ${token}`);
  }
  // Permit2 AllowanceTransfer: PermitSingle / PermitBatch.
  if (type === "PermitSingle" || type === "PermitBatch") {
    const details = [].concat(message.details || []);
    const amounts = details.map((d) => formatAmount(d.amount, d.token, tokens));
    for (const amount of amounts) rows.push(["Lets spend", amount]);
    rows.push(["Spender", who(message.spender)]);
    const expiries = details.map((d) => when(d.expiration, now));
    if (expiries[0]) rows.push(["Permission lasts until", expiries[0].text]);
    rows.push(["Sign by", when(message.sigDeadline, now).text]);
    spenderWarning(message.spender);
    if (expiries.some((e) => e.far)) expiryWarning({ far: true });
    return result("permit2", "high", `This lets ${who(message.spender)} spend ${amounts.join(", ") || "your tokens"} through Permit2`);
  }
  // Permit2 SignatureTransfer: the spender takes the tokens straight away.
  if (type === "PermitTransferFrom" || type === "PermitBatchTransferFrom" || type === "PermitWitnessTransferFrom") {
    const permitted = [].concat(message.permitted || []);
    const amounts = permitted.map((p) => formatAmount(p.amount, p.token, tokens));
    for (const amount of amounts) rows.push(["Can take now", amount]);
    rows.push(["Taken by", who(message.spender)], ["Valid until", when(message.deadline, now).text]);
    spenderWarning(message.spender);
    return result("permit2-transfer", "high", `This lets ${who(message.spender)} take ${amounts.join(", ") || "your tokens"} from your wallet immediately`);
  }
  // Seaport and similar marketplace orders.
  if (type === "OrderComponents" || ("offer" in message && "consideration" in message)) {
    const offer = [].concat(message.offer || []).length;
    rows.push(["You give", `${offer} item${offer === 1 ? "" : "s"}`], ["Order ends", when(message.endTime, now).text]);
    warnings.push("A marketplace order hands over what it offers to whoever fills it. Check the price you receive in the site itself before signing.");
    return result("order", "high", "This lists items from your wallet for sale");
  }
  // Anything else: every field, marked unknown.
  const flat = [];
  const walk = (value, path) => {
    if (flat.length >= 14) return;
    if (value && typeof value === "object") for (const [key, inner] of Object.entries(value)) walk(inner, path ? `${path}.${key}` : key);
    else flat.push([path, ADDRESS.test(String(value)) ? short(String(value)) : String(value).slice(0, 80)]);
  };
  walk(message, "");
  rows.push(["Type", type || "Unnamed"], ...flat);
  warnings.push("Tera doesn't recognise this kind of request. Only sign it if you know exactly what the site will do with it.");
  return result("unknown", "unknown", `An unrecognised ${type || ""} signature request`.replace("  ", " "));
}
