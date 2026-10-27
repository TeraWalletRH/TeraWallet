// Talking to a Ledger's Ethereum app, byte by byte. No device access of its
// own; extension/src/ledger.ts opens the device (WebHID) and signs.
//
// Ledger publishes this protocol, and it's small enough to write out here
// rather than ship Ledger's own libraries, which bring hundreds of
// dependencies into a wallet whose code must be what was reviewed.
//
//   A command (an APDU) is CLA INS P1 P2 Lc data. Over USB it travels in
//   64-byte packets: channel (2 bytes), tag 0x05, a sequence number (2), and
//   in the first packet the command's length (2), then the bytes. Answers
//   come back the same way and end with a two-byte status, 0x9000 for OK.
//
//   An account is named by its derivation path, sent as a count and then
//   each step as 4 bytes, with the top bit set for a hardened step.
//
//   Anything longer than one command (a transaction, a message) goes in
//   chunks: the first carries the path (and, for a message, its length),
//   and each later chunk says it continues (P1 0x80). Chunks stay at 150
//   bytes, as Ledger's own library sends them, so no app version is fed a
//   chunk it can't take.
//
// The rules, each one a test: framing round-trips any length; a path encodes
// exactly; chunks rebuild the payload; every status a person can act on
// says what to do.

export const CLA = 0xe0;
export const INS = { address: 0x02, transaction: 0x04, message: 0x08, typed: 0x0c };
export const OK = 0x9000;
export const CHANNEL = 0x0101;
const TAG = 0x05;
const PACKET = 64;
const CHUNK = 150;

/** The first accounts, as Ledger Live numbers them and as most other wallets do. */
export const SCHEMES = {
  live: (i) => `44'/60'/${i}'/0/0`,
  standard: (i) => `44'/60'/0'/0/${i}`,
};

/** A derivation path ("44'/60'/0'/0/0", "m/" optional) as the app takes it. */
export function encodePath(path) {
  const steps = String(path)
    .replace(/^m\//, "")
    .split("/")
    .map((step) => {
      const hard = step.endsWith("'");
      const digits = hard ? step.slice(0, -1) : step;
      const n = /^\d+$/.test(digits) ? Number(digits) : NaN;
      if (!Number.isInteger(n) || n < 0 || n >= 0x80000000)
        throw new Error(`Not a derivation path: ${path}`);
      return hard ? n + 0x80000000 : n;
    });
  if (!steps.length || steps.length > 10) throw new Error(`Not a derivation path: ${path}`);
  const out = new Uint8Array(1 + steps.length * 4);
  out[0] = steps.length;
  steps.forEach((step, i) => new DataView(out.buffer).setUint32(1 + i * 4, step));
  return out;
}

/** One command. */
export function apdu(ins, p1, p2, data = new Uint8Array()) {
  if (data.length > 255) throw new Error("A Ledger command carries at most 255 bytes.");
  return Uint8Array.from([CLA, ins, p1, p2, data.length, ...data]);
}

const join = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/**
 * The commands for a long payload: the path (and, with `withLength`, the
 * payload's length as 4 bytes) first, then chunks of at most 150 bytes.
 */
export function chunked(ins, path, payload, { withLength = false } = {}) {
  const head = withLength
    ? join(encodePath(path), Uint8Array.from([0, 0, 0, 0]))
    : encodePath(path);
  if (withLength) new DataView(head.buffer).setUint32(head.length - 4, payload.length);
  const first = Math.max(0, CHUNK - head.length);
  const out = [apdu(ins, 0x00, 0x00, join(head, payload.slice(0, first)))];
  for (let at = first; at < payload.length; at += CHUNK)
    out.push(apdu(ins, 0x80, 0x00, payload.slice(at, at + CHUNK)));
  return out;
}

/** A command as USB packets. */
export function frame(command, channel = CHANNEL) {
  const data = join(Uint8Array.from([command.length >> 8, command.length & 0xff]), command);
  const packets = [];
  for (let seq = 0, at = 0; at < data.length || seq === 0; seq++) {
    const packet = new Uint8Array(PACKET);
    packet.set([channel >> 8, channel & 0xff, TAG, seq >> 8, seq & 0xff]);
    const room = PACKET - 5;
    packet.set(data.slice(at, at + room), 5);
    at += room;
    packets.push(packet);
  }
  return packets;
}

/**
 * Collects an answer's packets. `push` returns the whole answer (status
 * included) once the last packet is in, null before then.
 */
export function reader(channel = CHANNEL) {
  let length = -1;
  let seq = 0;
  let body = new Uint8Array();
  return {
    push(packet) {
      const p = packet instanceof Uint8Array ? packet : new Uint8Array(packet);
      if (((p[0] << 8) | p[1]) !== channel || p[2] !== TAG) return null;
      if (((p[3] << 8) | p[4]) !== seq) throw new Error("The Ledger's answer came out of order.");
      let data = p.slice(5);
      if (seq === 0) {
        length = (data[0] << 8) | data[1];
        data = data.slice(2);
      }
      seq++;
      body = join(body, data);
      return body.length >= length ? body.slice(0, length) : null;
    },
  };
}

/** The status at the end of an answer. */
export const statusOf = (answer) =>
  answer.length >= 2 ? (answer[answer.length - 2] << 8) | answer[answer.length - 1] : 0;

/** What a status means for the person holding the Ledger, or null for OK. */
export function ledgerError(status) {
  if (status === OK) return null;
  if (status === 0x6985 || status === 0x5501) return "You rejected it on your Ledger.";
  if (status === 0x6a80 || status === 0x6a84 || status === 0x6a88)
    return "Your Ledger needs Blind signing for this. Turn it on in the Ethereum app's settings, then try again.";
  if ([0x6d00, 0x6e00, 0x6e01, 0x6511, 0x6d02, 0x6a83].includes(status))
    return "Open the Ethereum app on your Ledger, then try again.";
  if (status === 0x5515 || status === 0x6b0c || status === 0x6982)
    return "Unlock your Ledger, open the Ethereum app, then try again.";
  return `Your Ledger refused this (status 0x${status.toString(16).padStart(4, "0")}).`;
}

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** GET ADDRESS's answer: the address, as 0x and 40 hex characters (unchecksummed). */
export function parseAddress(answer) {
  const keyLength = answer[0];
  const addressLength = answer[1 + keyLength];
  const ascii = new TextDecoder().decode(
    answer.slice(2 + keyLength, 2 + keyLength + addressLength),
  );
  if (!/^[0-9a-fA-F]{40}$/.test(ascii)) throw new Error("The Ledger sent back something odd.");
  return `0x${ascii}`;
}

/** A signing answer: v (one byte), r and s (32 bytes each). */
export function parseSignature(answer) {
  if (answer.length < 65 + 2) throw new Error("The Ledger sent back something odd.");
  return { v: answer[0], r: `0x${hex(answer.slice(1, 33))}`, s: `0x${hex(answer.slice(33, 65))}` };
}
