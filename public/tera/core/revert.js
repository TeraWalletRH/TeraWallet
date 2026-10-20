// Why a transaction was refused, in words. No network access of its own; the
// wallet passes in the error its simulation or broadcast threw.
//
// A token that refuses a transfer answers with a short error code. viem knows
// the standard ones only when it has the token's full description, so for most
// tokens it says "Execution reverted for an unknown reason", which tells the
// owner nothing. USDG, for one, answers an empty wallet with InsufficientFunds().
//
// The rules, each one a test:
//
//   The common refusals are named: not enough of the token, not approved,
//   paused, a frozen address, a receiver the token won't accept. A token's own
//   message (Error("…")) is shown as the token wrote it, after the same "not
//   enough" check, since that is the usual one.
//
//   An error this doesn't recognise still says which code the token gave,
//   rather than "unknown": it is something to search for or report.
//
//   Nothing is invented: no error code found means no explanation, and the
//   wallet shows its own message.

const CODES = {
  "0x356680b7": "balance", // InsufficientFunds() (USDG)
  "0xf4d678b8": "balance", // InsufficientBalance()
  "0xe450d38c": "balance", // ERC20InsufficientBalance(address,uint256,uint256)
  "0xfb8f41b2": "allowance", // ERC20InsufficientAllowance(address,uint256,uint256)
  "0x13be252b": "allowance", // InsufficientAllowance()
  "0xd93c0665": "paused", // EnforcedPause()
  "0x1fd1cc44": "frozen", // AddressFrozen()
  "0x552afea0": "frozen", // AccountFrozen()
  "0xec442f05": "receiver", // ERC20InvalidReceiver(address)
};
const ERROR_STRING = "0x08c379a0";
const PANIC = "0x4e487b71";

/** Every piece of text an error carries: its message, details, data, and its causes'. */
function texts(error, depth = 0) {
  if (!error || depth > 5) return [];
  if (typeof error === "string") return [error];
  const own = [error.data, error.shortMessage, error.details, error.message]
    .map((part) => (typeof part === "object" && part?.data ? part.data : part))
    .filter((part) => typeof part === "string");
  return [...own, ...texts(error.cause, depth + 1)];
}

/** The revert data an error carries (0x + selector + arguments), or "". */
export function revertData(error) {
  for (const text of texts(error)) {
    // A labelled "data: 0x…" first, then any hex in the text. An address or a
    // hash in a message is not revert data; a selector plus whole 32-byte
    // words is.
    const labelled = text.match(/data:?\s*"?(0x[0-9a-fA-F]+)/)?.[1];
    for (const candidate of [labelled, ...(text.match(/0x[0-9a-fA-F]{8,}/g) ?? [])]) {
      const data = String(candidate ?? "").toLowerCase();
      if (data.length >= 10 && (data.length - 10) % 64 === 0) return data;
    }
  }
  return "";
}

function decodeString(data) {
  try {
    const length = Number(BigInt(`0x${data.slice(74, 138)}`));
    const bytes = data.slice(138, 138 + length * 2).match(/../g) || [];
    return new TextDecoder().decode(Uint8Array.from(bytes, (b) => parseInt(b, 16)));
  } catch {
    return "";
  }
}

/**
 * What a refusal means, in a sentence, or null when the error carries no
 * revert code. `symbol` names the token being sent, when there is one.
 *
 * @param {unknown} error
 * @param {{ symbol?: string }} [context]
 * @returns {string | null}
 */
export function explainRevert(error, { symbol = "" } = {}) {
  const data = revertData(error);
  if (!data) return null;
  const token = symbol || "this token";
  const selector = data.slice(0, 10);
  const kind = CODES[selector];
  const enough = symbol || "of this token";
  if (kind === "balance")
    return `This wallet doesn't have enough ${enough} for this. Nothing was sent.`;
  if (kind === "allowance")
    return `${token} hasn't been approved for this amount, so the transfer was refused. Nothing was sent.`;
  if (kind === "paused")
    return `${token} transfers are paused by its issuer right now. Nothing was sent.`;
  if (kind === "frozen")
    return `${token}'s issuer has frozen one of these addresses, so it can't send or receive. Nothing was sent.`;
  if (kind === "receiver")
    return `${token} won't accept that address as a receiver. Nothing was sent.`;
  if (selector === ERROR_STRING) {
    const reason = decodeString(data);
    if (/exceeds balance|insufficient (?:balance|funds)/i.test(reason))
      return `This wallet doesn't have enough ${enough} for this. Nothing was sent.`;
    if (reason) return `The transaction was refused: "${reason.slice(0, 160)}". Nothing was sent.`;
  }
  if (selector === PANIC)
    return `The contract stopped with an internal error (code ${BigInt(`0x${data.slice(10, 74)}`).toString()}). Nothing was sent.`;
  return `The transaction was refused by the contract (error ${selector}). Nothing was sent.`;
}
