// Signature requests from websites, for the Tera browser extension. No
// platform API of its own; extension/src/background.ts asks these rules,
// shows the result in the approval window and signs only after the owner
// approves with their password.
//
// A signature costs nothing and leaves no trace on chain, which is why
// phishing sites ask for them. The rules, each one a test:
//
//   Only a connected site can ask, and only for the address it was given.
//
//   Messages (personal_sign) are shown as text. Hex is read as bytes, as
//   every wallet does; bytes that aren't readable text are shown as hex and
//   marked: a signature over data you can't read could be authorising
//   anything.
//
//   A sign-in message (Sign-In with Ethereum) names the site it logs you
//   into. If that isn't the site asking, it says so in red: that's how a
//   phishing page logs in as you somewhere else. A sign-in for another
//   address or another chain is called out too.
//
//   Typed data (eth_signTypedData_v3/v4) is explained by core/typed-data.js:
//   permits in red, anything unrecognised as unknown, never as safe. A
//   request for another chain is refused outright, not just flagged.
//
//   Raw-hash signing (eth_sign) is refused: nothing about it can be shown.
//
//   Anything red or unknown needs the owner to tick that they understand
//   before the Sign button works.

import { explain, parseRequest } from "./typed-data.js";
import { CHAIN_ID, ERRORS, rpcError } from "./dapp-connect.js";

export const SIGNABLE = new Set(["personal_sign", "eth_signTypedData_v3", "eth_signTypedData_v4"]);

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX = /^0x(?:[0-9a-fA-F]{2})*$/;
const lower = (value) => String(value ?? "").toLowerCase();

/** Why a signing method Tera doesn't offer is refused. */
export function refusal(method) {
  if (method === "eth_sign")
    return rpcError(
      ERRORS.unsupported,
      "Tera doesn't sign raw hashes (eth_sign): there's no way to show you what you'd be agreeing to.",
    );
  if (method === "eth_signTypedData")
    return rpcError(
      ERRORS.unsupported,
      "Use eth_signTypedData_v4. The original version isn't supported.",
    );
  return rpcError(
    ERRORS.unsupported,
    "Sending transactions isn't in this version of the Tera extension yet.",
  );
}

/**
 * A personal_sign message as the owner will see it, and as it will be signed.
 * Returns { text, sign, readable }: `sign` is the string itself or { raw: hex }.
 */
export function readMessage(message) {
  const value = String(message ?? "");
  if (!HEX.test(value) || value === "0x") return { text: value, sign: value, readable: true };
  const bytes = Uint8Array.from(value.slice(2).match(/../g) || [], (b) => parseInt(b, 16));
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    // Control characters other than line breaks and tabs mean it isn't text.

    if (!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))
      return { text, sign: { raw: value }, readable: true };
  } catch {
    // Not UTF-8: shown as hex below.
  }
  return { text: value, sign: { raw: value }, readable: false };
}

/** The fields of a Sign-In with Ethereum (EIP-4361) message, or null when it isn't one. */
export function signIn(text) {
  const lines = String(text ?? "").split("\n");
  const head =
    /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\S+) wants you to sign in with your Ethereum account:$/i.exec(
      lines[0]?.trim() ?? "",
    );
  if (!head) return null;
  const field = (name) => {
    const line = lines.find((l) => l.startsWith(`${name}: `));
    return line ? line.slice(name.length + 2).trim() : null;
  };
  return {
    domain: head[2],
    address: lines[1]?.trim() ?? "",
    uri: field("URI"),
    chainId: field("Chain ID"),
  };
}

function owns(accounts, address) {
  return accounts.some((a) => lower(a) === lower(address));
}

/**
 * What a signature request asks, ready for the approval window, or { error }.
 * context: { origin, accounts (the site's connected addresses), tokens, spenders }
 *
 * Result: { kind: "message" | "typed", address, danger: "low" | "unknown" | "high",
 *           title, warnings, ...kind-specific fields }
 */
export function signRequest(method, params, context) {
  const { origin, accounts = [], tokens = {}, spenders = {} } = context;
  if (!SIGNABLE.has(method)) return { error: refusal(method) };
  if (!accounts.length)
    return {
      error: rpcError(ERRORS.unauthorized, "Connect to Tera before asking for a signature."),
    };
  const list = Array.isArray(params) ? params : [];

  if (method === "personal_sign") {
    let [message, address] = list;
    // Some sites send [address, message].
    if (ADDRESS.test(String(message)) && !ADDRESS.test(String(address)))
      [message, address] = [address, message];
    if (typeof message !== "string")
      return { error: rpcError(ERRORS.invalidParams, "Expected [message, address].") };
    if (!ADDRESS.test(String(address)) || !owns(accounts, address))
      return { error: rpcError(ERRORS.unauthorized, "This site isn't connected to that address.") };
    const read = readMessage(message);
    const warnings = [];
    let danger = "low";
    let title = "Sign a message";
    const login = read.readable ? signIn(read.text) : null;
    if (!read.readable) {
      danger = "unknown";
      warnings.push(
        "This isn't readable text. Signing data you can't read could authorise something you can't see. Only sign if you know exactly what it is.",
      );
    }
    if (login) {
      const host = new URL(origin).host;
      title = `Sign in to ${login.domain}`;
      if (lower(login.domain) !== lower(host)) {
        danger = "high";
        warnings.push(
          `This sign-in is for ${login.domain}, but the site asking is ${host}. A site that gets this signature can log in to ${login.domain} as you.`,
        );
      }
      if (ADDRESS.test(login.address) && lower(login.address) !== lower(address))
        warnings.push(`It signs in as ${login.address}, not the address signing it.`);
      if (login.chainId && Number(login.chainId) !== CHAIN_ID)
        warnings.push(`It's for chain ${login.chainId}, not Robinhood Chain (${CHAIN_ID}).`);
    }
    return {
      kind: "message",
      address,
      text: read.text,
      sign: read.sign,
      readable: read.readable,
      signIn: login,
      danger,
      title,
      warnings,
    };
  }

  // eth_signTypedData_v3 / v4: [address, typedData].
  let parsed;
  try {
    parsed = parseRequest(list);
  } catch {
    return { error: rpcError(ERRORS.invalidParams, "Expected [address, typedData].") };
  }
  const { typed, signer } = parsed;
  if (!signer || !owns(accounts, signer))
    return { error: rpcError(ERRORS.unauthorized, "This site isn't connected to that address.") };
  if (
    !typed.types ||
    typeof typed.types !== "object" ||
    !Array.isArray(typed.types[typed.primaryType])
  )
    return {
      error: rpcError(ERRORS.invalidParams, `The typed data doesn't define ${typed.primaryType}.`),
    };
  const domainChain = typed.domain?.chainId;
  if (domainChain !== undefined && domainChain !== null) {
    let id;
    try {
      id = BigInt(domainChain);
    } catch {
      id = null;
    }
    if (id !== BigInt(CHAIN_ID))
      return {
        error: rpcError(
          ERRORS.invalidParams,
          `This signature is for chain ${domainChain}. Tera only signs for Robinhood Chain (${CHAIN_ID}).`,
        ),
      };
  }
  const explained = explain(typed, { chainId: CHAIN_ID, owner: signer, tokens, spenders });
  return {
    kind: "typed",
    address: accounts.find((a) => lower(a) === lower(signer)),
    typed,
    explained,
    danger: explained.danger,
    title: explained.title,
    warnings: explained.warnings,
  };
}

/** True when the owner must tick "I understand" before signing. */
export const needsConfirm = (request) => request.danger !== "low";
