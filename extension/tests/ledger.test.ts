// src/ledger.ts against a stand-in Ledger: the Ethereum app's commands,
// answered with a real key, so the chunking, parsing and checks all run as
// they would against a device. Run with: bun test extension/tests
import { expect, it } from "bun:test";
import {
  concat,
  keccak256,
  parseTransaction,
  recoverMessageAddress,
  toHex,
  verifyTypedData,
  type Hex,
} from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { INS, SCHEMES, statusOf } from "../../public/tera/core/ledger-apdu.js";
import { ledgerAccount, ledgerAccounts, type Exchange } from "../src/ledger";

const PHRASE = "test test test test test test test test test test test junk";
const OTHER = "legal winner thank year wave sausage worth useful legal winner thank yellow";

const decodePath = (bytes: Uint8Array) => {
  const steps: string[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  for (let i = 0; i < bytes[0]; i++) {
    const n = view.getUint32(1 + i * 4);
    steps.push(n >= 0x80000000 ? `${n - 0x80000000}'` : String(n));
  }
  return { path: `m/${steps.join("/")}`, used: 1 + bytes[0] * 4 };
};

const keyAt = (phrase: string, path: string) =>
  privateKeyToAccount(
    toHex(mnemonicToAccount(phrase, { path: path as never }).getHdKey().privateKey!),
  );

const ok = (data: number[] | Uint8Array) => Uint8Array.from([...data, 0x90, 0x00]);
const sigAnswer = (signature: Hex, legacyV: boolean) => {
  const bytes = Buffer.from(signature.slice(2), "hex");
  const v = bytes[64];
  return ok([legacyV ? v : v - 27, ...bytes.subarray(0, 64)]);
};

/** A Ledger with `phrase` on it. `refuse` answers every signing command with that status. */
function fakeLedger(phrase: string, { refuse }: { refuse?: number } = {}): Exchange {
  let pending: { ins: number; path: string; data: number[]; total?: number } | null = null;
  return async (command) => {
    const [, ins, p1] = command;
    const data = command.slice(5);
    if (ins === INS.address) {
      const { path } = decodePath(data);
      const address = keyAt(phrase, path).address.slice(2).toLowerCase();
      return ok([65, ...new Uint8Array(65), 40, ...Buffer.from(address)]);
    }
    if (refuse) return Uint8Array.from([refuse >> 8, refuse & 0xff]);
    if (ins === INS.typed) {
      const { path, used } = decodePath(data);
      const digest = keccak256(
        concat([
          "0x1901",
          toHex(data.slice(used, used + 32)),
          toHex(data.slice(used + 32, used + 64)),
        ]),
      );
      return sigAnswer(await keyAt(phrase, path).sign({ hash: digest }), true);
    }
    if (p1 === 0x00) {
      const { path, used } = decodePath(data);
      let rest = Array.from(data.slice(used));
      let total: number | undefined;
      if (ins === INS.message) {
        total = new DataView(Uint8Array.from(rest.slice(0, 4)).buffer).getUint32(0);
        rest = rest.slice(4);
      }
      pending = { ins, path, data: rest, total };
    } else pending!.data.push(...data);
    const p = pending!;
    if (p.ins === INS.message) {
      if (p.data.length < p.total!) return ok([]);
      const signature = await keyAt(phrase, p.path).signMessage({
        message: { raw: Uint8Array.from(p.data) },
      });
      return sigAnswer(signature, true);
    }
    // A type-2 transaction: 0x02 then an RLP list, whose header says how long it is.
    const bytes = Uint8Array.from(p.data);
    const header = bytes[1];
    const length =
      header <= 0xf7
        ? 2 + (header - 0xc0)
        : (() => {
            const n = header - 0xf7;
            let len = 0;
            for (let i = 0; i < n; i++) len = len * 256 + bytes[2 + i];
            return 2 + n + len;
          })();
    if (bytes.length < length) return ok([]);
    const signature = await keyAt(phrase, p.path).sign({ hash: keccak256(bytes) });
    return sigAnswer(signature, false);
  };
}

const PATH = SCHEMES.live(0);
const owner = keyAt(PHRASE, `m/${PATH}`).address;

it("lists the first accounts", async () => {
  const live = await ledgerAccounts("live", 3, fakeLedger(PHRASE));
  expect(live[0]).toEqual({ path: PATH, address: owner });
  expect(live[1].address).toBe(keyAt(PHRASE, `m/${SCHEMES.live(1)}`).address);
  const standard = await ledgerAccounts("standard", 2, fakeLedger(PHRASE));
  expect(standard[0].address).toBe(owner);
  expect(standard[1].address).toBe(keyAt(PHRASE, `m/${SCHEMES.standard(1)}`).address);
});

it("signs a long message that recovers to the wallet", async () => {
  const account = ledgerAccount(PATH, owner, fakeLedger(PHRASE));
  const message = "Sign in to example.com\n\n" + "x".repeat(600);
  const signature = await account.signMessage({ message });
  expect(await recoverMessageAddress({ message, signature })).toBe(owner);
  const raw = await account.signMessage({ message: { raw: "0xdeadbeef" } });
  expect(await recoverMessageAddress({ message: { raw: "0xdeadbeef" }, signature: raw })).toBe(
    owner,
  );
});

it("signs typed data", async () => {
  const account = ledgerAccount(PATH, owner, fakeLedger(PHRASE));
  const typed = {
    domain: {
      name: "Permit2",
      chainId: 4663,
      verifyingContract: "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Hex,
    },
    types: {
      Spend: [
        { name: "spender", type: "address" },
        { name: "amount", type: "uint256" },
      ],
    },
    primaryType: "Spend",
    message: { spender: "0x0000000000000000000000000000000000000001", amount: 5n },
  };
  const signature = await account.signTypedData(typed as never);
  expect(await verifyTypedData({ ...typed, address: owner, signature } as never)).toBe(true);
});

it("signs a transaction with a long payload, and the right parity", async () => {
  const account = ledgerAccount(PATH, owner, fakeLedger(PHRASE));
  const tx = {
    type: "eip1559" as const,
    chainId: 4663,
    nonce: 7,
    to: "0x5fc5360d0400a0fd4f2af552add042d716f1d168" as Hex,
    value: 0n,
    data: `0xa9059cbb${"00".repeat(400)}` as Hex,
    gas: 90_000n,
    maxFeePerGas: 2_000_000_000n,
    maxPriorityFeePerGas: 1_000_000n,
  };
  const signed = await account.signTransaction(tx);
  const parsed = parseTransaction(signed as never);
  expect(parsed.nonce).toBe(7);
  expect(parsed.chainId).toBe(4663);
  const { recoverTransactionAddress } = await import("viem");
  expect(await recoverTransactionAddress({ serializedTransaction: signed as never })).toBe(owner);
});

it("refuses a Ledger that doesn't hold the wallet", async () => {
  const account = ledgerAccount(PATH, owner, fakeLedger(OTHER));
  await expect(account.signMessage({ message: "hi" })).rejects.toThrow("doesn't hold");
});

it("says what a refusal on the device means", async () => {
  const rejected = ledgerAccount(PATH, owner, fakeLedger(PHRASE, { refuse: 0x6985 }));
  await expect(rejected.signMessage({ message: "hi" })).rejects.toThrow(
    "rejected it on your Ledger",
  );
  const blind = ledgerAccount(PATH, owner, fakeLedger(PHRASE, { refuse: 0x6a80 }));
  await expect(
    blind.signTransaction({
      type: "eip1559",
      chainId: 4663,
      nonce: 0,
      to: owner,
      value: 1n,
      gas: 21000n,
      maxFeePerGas: 1n,
      maxPriorityFeePerGas: 1n,
    }),
  ).rejects.toThrow("Blind signing");
  expect(statusOf(Uint8Array.from([0x69, 0x85]))).toBe(0x6985);
});

it("refuses a garbled signature instead of passing it on", async () => {
  const junk: Exchange = async () =>
    Uint8Array.from([0, ...new Array(32).fill(0x11), ...new Array(32).fill(0x22), 0x90, 0x00]);
  await expect(ledgerAccount(PATH, owner, junk).signMessage({ message: "hi" })).rejects.toThrow(
    "doesn't hold",
  );
});
