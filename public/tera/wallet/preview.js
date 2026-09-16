// Transaction intent preview: the human-readable action beside the raw fields
// a wallet will actually sign. The sentence is only ever as specific as the
// calldata decoding allows — an unrecognised payload is described as exactly
// that, never guessed at from the surrounding proposal.

import { formatUnits, sameAddress, isAddress, ZERO_ADDRESS } from "./core.js";

export const MAX_UINT256 = (1n << 256n) - 1n;
// Anything this large is unlimited in practice, whatever the exact constant.
const UNLIMITED_FLOOR = 1n << 255n;

const SELECTORS = {
  "0xa9059cbb": {
    name: "transfer",
    signature: "transfer(address,uint256)",
    args: [
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
    ],
  },
  "0x095ea7b3": {
    name: "approve",
    signature: "approve(address,uint256)",
    args: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
  },
  "0x23b872dd": {
    name: "transferFrom",
    signature: "transferFrom(address,address,uint256)",
    args: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
  },
};

function decodeWord(word, type) {
  if (type === "address") return `0x${word.slice(24)}`;
  try {
    return BigInt(`0x${word}`).toString();
  } catch {
    return word;
  }
}

export function decodeCalldata(data) {
  const payload = String(data ?? "").toLowerCase();
  if (!payload || payload === "0x")
    return {
      known: true,
      native: true,
      name: "native transfer",
      selector: null,
      args: [],
      words: [],
    };
  const selector = payload.slice(0, 10);
  const body = payload.slice(10);
  const words = body.match(/.{1,64}/g) || [];
  const definition = SELECTORS[selector];
  if (!definition) return { known: false, native: false, name: "", selector, args: [], words };
  const args = definition.args.map((arg, index) => ({
    ...arg,
    raw: words[index] || "",
    value: words[index] ? decodeWord(words[index], arg.type) : "",
  }));
  return {
    known: true,
    native: false,
    name: definition.name,
    signature: definition.signature,
    selector,
    args,
    words,
    // Anything beyond the declared arguments is not described by the signature.
    extraWords: Math.max(0, words.length - definition.args.length),
  };
}

function amountText(value, asset) {
  if (value === "" || value === undefined || value === null) return "an unknown amount";
  try {
    const amount = BigInt(value);
    if (amount >= UNLIMITED_FLOOR) return `an unlimited amount of ${asset?.symbol || "this token"}`;
    if (!asset || !Number.isInteger(asset.decimals)) return `${amount.toString()} base units`;
    return `${formatUnits(value, asset.decimals)} ${asset.symbol}`;
  } catch {
    return "an unknown amount";
  }
}

function argOf(decoded, name) {
  return decoded.args.find((arg) => arg.name === name)?.value ?? "";
}

/**
 * Plain-language description plus the raw fields, and anything about the
 * payload the owner should look at twice before signing.
 */
export function describeTransaction({ tx, intent, asset, chainId, networkName } = {}) {
  if (!tx) return null;
  const decoded = decodeCalldata(tx.data);
  const network = networkName ? `${networkName} (chain ${chainId})` : `chain ${chainId}`;
  const flags = [];
  const flag = (level, text) => flags.push({ level, text });
  let action = "Unknown action";
  let sentence = "";

  let value = 0n;
  try {
    value = BigInt(tx.value ?? 0);
  } catch {
    value = 0n;
  }

  if (decoded.native) {
    action = "Send the network's own token";
    sentence = `Send ${asset && Number.isInteger(asset.decimals) ? `${formatUnits(value.toString(), asset.decimals)} ${asset.symbol}` : `${value.toString()} wei`} to ${tx.to} on ${network}.`;
  } else if (decoded.name === "transfer") {
    action = "Move a token you hold";
    sentence = `Send ${amountText(argOf(decoded, "amount"), asset)} to ${argOf(decoded, "recipient")} on ${network}.`;
  } else if (decoded.name === "approve") {
    action = "Grant a spending allowance";
    sentence = `Allow ${argOf(decoded, "spender")} to spend ${amountText(argOf(decoded, "amount"), asset)} from your balance on ${network}. This permission stays in place until you change it.`;
    flag(
      "note",
      "An allowance is not a one-off payment. It lets the spender move that amount at any time until you revoke it.",
    );
  } else if (decoded.name === "transferFrom") {
    action = "Move a token using an allowance";
    sentence = `Move ${amountText(argOf(decoded, "amount"), asset)} from ${argOf(decoded, "from")} to ${argOf(decoded, "to")} on ${network}.`;
  } else {
    action = "Unrecognised function";
    sentence = `This calls an unrecognised function (${decoded.selector || "no selector"}) on ${tx.to}, on ${network}. Tera cannot tell you what it does. Do not approve it unless you understand the contract.`;
    flag(
      "attention",
      "The function being called is not one this wallet can decode, so the description above is the most that can honestly be said about it.",
    );
  }

  // Payload-level warnings, independent of what the proposal claims.
  const amount = argOf(decoded, "amount");
  if (amount) {
    try {
      if (BigInt(amount) >= UNLIMITED_FLOOR)
        flag(
          "attention",
          decoded.name === "approve"
            ? "This grants an effectively unlimited allowance. A limited amount is safer where the contract accepts one."
            : "The amount is effectively unlimited for this token.",
        );
    } catch {
      /* Unparseable amounts are already reported as unknown. */
    }
  }
  if (!decoded.native && value > 0n)
    flag(
      "attention",
      "This contract call also sends the network's own token. A plain token transfer should not carry value.",
    );
  if (decoded.extraWords)
    flag(
      "attention",
      `The payload carries ${decoded.extraWords} extra word${decoded.extraWords === 1 ? "" : "s"} beyond the function's declared arguments.`,
    );
  const destination = argOf(decoded, "recipient") || argOf(decoded, "to");
  if (destination && destination === ZERO_ADDRESS)
    flag(
      "attention",
      "The destination is the zero address. Tokens sent there cannot be recovered.",
    );
  if (destination && sameAddress(destination, tx.to))
    flag(
      "attention",
      "The destination is the token contract itself. Tokens sent to their own contract are usually unrecoverable.",
    );
  if (!isAddress(tx.to)) flag("attention", "The transaction target is not a valid address.");

  // Does the payload match what the owner was shown?
  if (intent) {
    if (
      decoded.name === "transfer" &&
      intent.recipient &&
      !sameAddress(destination, intent.recipient)
    )
      flag("attention", "The recipient in the payload is not the recipient in this proposal.");
    if (decoded.name === "transfer" && intent.amount && String(amount) !== String(intent.amount))
      flag("attention", "The amount in the payload is not the amount in this proposal.");
  }

  const rows = [
    { label: "Network", value: network },
    { label: "Sends to", value: tx.to ?? "—" },
    { label: "Value", value: `${value.toString()} wei` },
    {
      label: "Function",
      value: decoded.native
        ? "none (plain transfer)"
        : decoded.signature || decoded.selector || "—",
    },
    ...decoded.args.map((arg) => ({ label: `↳ ${arg.name}`, value: String(arg.value) })),
    { label: "Calldata", value: tx.data && tx.data !== "0x" ? tx.data : "0x (empty)" },
    { label: "Action reference", value: tx.actionHash || "—" },
  ];
  return { action, sentence, decoded, flags, rows };
}
