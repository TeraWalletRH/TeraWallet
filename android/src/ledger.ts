// A Ledger as the wallet's signer, for the web build only (WebHID has no
// native-app equivalent). The bytes are core/ledger-apdu.js's, the same
// protocol the Chrome extension signs with; this file only differs from
// extension/src/ledger.ts in where it runs: a browser tab instead of an
// extension service worker. Chrome allows WebHID from a tab the same way it
// does from an extension (117+, once the page has been granted the device).
//
// The key never leaves the Ledger, and Tera trusts nothing it sends back:
// every signature is checked to recover to the wallet's own address before
// it's used, so a different Ledger, a different account or a garbled answer
// is refused rather than broadcast.

import {
  getAddress,
  getTypesForEIP712Domain,
  hashDomain,
  hashStruct,
  hexToBytes,
  recoverMessageAddress,
  recoverTransactionAddress,
  recoverTypedDataAddress,
  serializeTransaction,
  toBytes,
  type Hex,
  type TransactionSerializableEIP1559,
} from "viem";
import {
  INS,
  SCHEMES,
  apdu,
  chunked,
  encodePath,
  frame,
  ledgerError,
  parseAddress,
  parseSignature,
  reader,
  statusOf,
} from "../../public/tera/core/ledger-apdu.js";

export const VENDOR = 0x2c97;
/** The Ledger's own interface, as opposed to its keyboard or FIDO ones. */
const USAGE_PAGE = 0xffa0;
const ANSWER_WAIT_MS = 180_000;

export const NO_LEDGER = "Connect your Ledger with its cable, unlock it and open the Ethereum app.";

/** One command in, the whole answer (status included) out. */
export type Exchange = (command: Uint8Array) => Promise<Uint8Array>;

type HIDDevice = {
  vendorId: number;
  opened: boolean;
  collections: { usagePage: number }[];
  open(): Promise<void>;
  sendReport(id: number, data: Uint8Array): Promise<void>;
  addEventListener(type: "inputreport", listener: (event: { data: DataView }) => void): void;
  removeEventListener(type: "inputreport", listener: (event: { data: DataView }) => void): void;
};
type HID = {
  getDevices(): Promise<HIDDevice[]>;
  requestDevice(options: { filters: { vendorId: number }[] }): Promise<HIDDevice[]>;
};
const hid = () => (globalThis.navigator as unknown as { hid?: HID })?.hid;

/** Whether this browser can reach a Ledger at all -- checked before the "Ledger" choice is even offered. */
export const ledgerSupported = () => typeof navigator !== "undefined" && !!hid();

const isLedger = (device: HIDDevice) =>
  device.vendorId === VENDOR && device.collections.some((c) => c.usagePage === USAGE_PAGE);

/**
 * From a page, on a click: Chrome's own picker, which grants this tab the
 * Ledger from then on (for this origin, until the permission is revoked).
 * Returns false if the owner picked nothing.
 */
export async function allowLedger() {
  const api = hid();
  if (!api) throw new Error("This browser can't reach a Ledger. Use Chrome 117 or newer.");
  if ((await api.getDevices()).some(isLedger)) return true;
  const picked = await api.requestDevice({ filters: [{ vendorId: VENDOR }] });
  return picked.some(isLedger);
}

let queue: Promise<unknown> = Promise.resolve();

/** The granted Ledger, over WebHID, one command at a time. */
export const webHid: Exchange = (command) => {
  const run = queue.then(async () => {
    const device = (await hid()?.getDevices())?.find(isLedger);
    if (!device) throw new Error(NO_LEDGER);
    if (!device.opened) await device.open().catch(() => Promise.reject(new Error(NO_LEDGER)));
    const collect = reader();
    let listener: (event: { data: DataView }) => void = () => {};
    const answer = new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Your Ledger didn't answer in time. Try again.")),
        ANSWER_WAIT_MS,
      );
      listener = ({ data }) => {
        try {
          const whole = collect.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
          if (whole) {
            clearTimeout(timer);
            resolve(whole);
          }
        } catch (error) {
          clearTimeout(timer);
          reject(error);
        }
      };
    });
    device.addEventListener("inputreport", listener);
    try {
      for (const packet of frame(command)) await device.sendReport(0, packet);
      return await answer;
    } finally {
      device.removeEventListener("inputreport", listener);
    }
  });
  queue = run.catch(() => {});
  return run;
};

/** Send a command and return the answer's data, or throw what the status means. */
async function call(exchange: Exchange, command: Uint8Array) {
  const answer = await exchange(command);
  const problem = ledgerError(statusOf(answer));
  if (problem) throw new Error(problem);
  return answer.slice(0, -2);
}

async function signChunks(exchange: Exchange, commands: Uint8Array[]) {
  let last = new Uint8Array();
  for (const command of commands) last = await call(exchange, command);
  return parseSignature(Uint8Array.from([...last, 0x90, 0x00]));
}

/** The address at `path`, read from the Ledger (shown on its screen when `show`). */
export async function ledgerAddress(path: string, show = false, exchange = webHid) {
  return getAddress(
    parseAddress(await call(exchange, apdu(INS.address, show ? 1 : 0, 0, encodePath(path)))),
  );
}

/** The first `count` accounts under a scheme, for the owner to pick from. */
export async function ledgerAccounts(scheme: keyof typeof SCHEMES, count = 5, exchange = webHid) {
  const out: { path: string; address: string }[] = [];
  for (let i = 0; i < count; i++) {
    const path = SCHEMES[scheme](i);
    out.push({ path, address: await ledgerAddress(path, false, exchange) });
  }
  return out;
}

const mismatch = (address: string) =>
  new Error(
    `This Ledger doesn't hold ${address.slice(0, 6)}…${address.slice(-4)}. Connect the one you set Tera up with.`,
  );

/** Who signed, or null when the signature doesn't recover at all (a garbled answer). */
const signerOf = async (recover: () => Promise<string>) => {
  try {
    return getAddress(await recover());
  } catch {
    return null;
  }
};

type TypedData = {
  domain: Record<string, unknown>;
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
};

/**
 * A signer with the shape the rest of the wallet already signs with (viem's
 * local account): signMessage, signTypedData, signTransaction.
 */
export function ledgerAccount(path: string, address: string, exchange: Exchange = webHid) {
  const owner = getAddress(address);
  return {
    address: owner,

    async signMessage({ message }: { message: string | { raw: Hex | Uint8Array } }) {
      const bytes =
        typeof message === "string"
          ? new TextEncoder().encode(message)
          : typeof message.raw === "string"
            ? hexToBytes(message.raw)
            : message.raw;
      const { v, r, s } = await signChunks(
        exchange,
        chunked(INS.message, path, bytes, { withLength: true }),
      );
      const signature =
        `${r}${s.slice(2)}${(v < 27 ? v + 27 : v).toString(16).padStart(2, "0")}` as Hex;
      if ((await signerOf(() => recoverMessageAddress({ message, signature }))) !== owner)
        throw mismatch(owner);
      return signature;
    },

    async signTypedData(data: TypedData) {
      if (data.primaryType === "EIP712Domain")
        throw new Error("A Ledger can't sign a bare EIP-712 domain.");
      const types = {
        EIP712Domain: data.types.EIP712Domain ?? getTypesForEIP712Domain({ domain: data.domain }),
        ...data.types,
      };
      const domain = toBytes(hashDomain({ domain: data.domain, types } as never));
      const struct = toBytes(
        hashStruct({ data: data.message, primaryType: data.primaryType, types } as never),
      );
      const encodedPath = encodePath(path);
      const body = new Uint8Array(encodedPath.length + 64);
      body.set(encodedPath);
      body.set(domain, encodedPath.length);
      body.set(struct, encodedPath.length + 32);
      const { v, r, s } = await signChunks(exchange, [apdu(INS.typed, 0, 0, body)]);
      const signature =
        `${r}${s.slice(2)}${(v < 27 ? v + 27 : v).toString(16).padStart(2, "0")}` as Hex;
      const recovered = await signerOf(() =>
        recoverTypedDataAddress({ ...data, signature } as never),
      );
      if (recovered !== owner) throw mismatch(owner);
      return signature;
    },

    async signTransaction(tx: TransactionSerializableEIP1559) {
      const unsigned = hexToBytes(serializeTransaction(tx));
      const { v, r, s } = await signChunks(exchange, chunked(INS.transaction, path, unsigned));
      // The app's v for a typed transaction is its parity, but which form it
      // takes has varied by version: try the likely one first, keep the one
      // that recovers to this wallet.
      const likely = v === 0 || v === 1 ? v : (v - 27) & 1;
      for (const yParity of [likely, likely ^ 1]) {
        const signed = serializeTransaction(tx, { r: r as Hex, s: s as Hex, yParity });
        const from = await signerOf(() =>
          recoverTransactionAddress({ serializedTransaction: signed as never }),
        );
        if (from === owner) return signed;
      }
      throw mismatch(owner);
    },
  };
}

export type LedgerAccount = ReturnType<typeof ledgerAccount>;
