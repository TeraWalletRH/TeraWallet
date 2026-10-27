import { test } from "node:test";
import assert from "node:assert/strict";
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

const hex = (bytes) => Buffer.from(bytes).toString("hex");

test("a path encodes as a count and hardened steps", () => {
  assert.equal(
    hex(encodePath("44'/60'/0'/0/0")),
    "05" + "8000002c" + "8000003c" + "80000000" + "00000000" + "00000000",
  );
  assert.equal(hex(encodePath("m/44'/60'/3'/0/0")), hex(encodePath(SCHEMES.live(3))));
  assert.equal(SCHEMES.standard(2), "44'/60'/0'/0/2");
  assert.throws(() => encodePath("44'/sixty"));
  assert.throws(() => encodePath(""));
});

test("framing round-trips commands of any length", () => {
  for (const length of [0, 1, 57, 58, 59, 200, 255]) {
    const command = apdu(
      INS.message,
      0,
      0,
      Uint8Array.from({ length }, (_, i) => i & 0xff),
    );
    const packets = frame(command);
    assert.ok(packets.every((p) => p.length === 64));
    const r = reader();
    let out = null;
    for (const p of packets) out = r.push(p) ?? out;
    assert.equal(hex(out), hex(command), `length ${length}`);
  }
});

test("a reader ignores other channels and refuses packets out of order", () => {
  const packets = frame(apdu(INS.message, 0, 0, new Uint8Array(200)));
  const other = Uint8Array.from(packets[0]);
  other[1] = 0x02;
  assert.equal(reader().push(other), null);
  const r = reader();
  r.push(packets[0]);
  assert.throws(() => r.push(packets[2]), /out of order/);
});

test("chunks carry the path first and rebuild the payload", () => {
  const payload = Uint8Array.from({ length: 700 }, (_, i) => (i * 7) & 0xff);
  const path = SCHEMES.live(0);
  const commands = chunked(INS.message, path, payload, { withLength: true });
  assert.ok(commands.every((c) => c.length - 5 <= 150));
  assert.equal(commands[0][2], 0x00);
  assert.ok(commands.slice(1).every((c) => c[2] === 0x80));
  const head = encodePath(path).length + 4;
  const first = commands[0].slice(5);
  assert.equal(new DataView(first.buffer, first.byteOffset).getUint32(head - 4), 700);
  const rebuilt = [first.slice(head), ...commands.slice(1).map((c) => c.slice(5))];
  assert.equal(hex(Buffer.concat(rebuilt)), hex(payload));
});

test("statuses say what to do", () => {
  assert.equal(ledgerError(0x9000), null);
  assert.match(ledgerError(0x6985), /rejected/);
  assert.match(ledgerError(0x6a80), /Blind signing/);
  assert.match(ledgerError(0x6e00), /Open the Ethereum app/);
  assert.match(ledgerError(0x5515), /Unlock/);
  assert.match(ledgerError(0x1234), /0x1234/);
  assert.equal(statusOf(Uint8Array.from([1, 2, 0x90, 0x00])), 0x9000);
});

test("answers parse", () => {
  const address = "f39fd6e51aad88f6f4ce6ab8827279cfffb92266";
  const answer = Uint8Array.from([65, ...new Uint8Array(65), 40, ...Buffer.from(address), 0x90, 0]);
  assert.equal(parseAddress(answer), `0x${address}`);
  const sig = Uint8Array.from([
    1,
    ...new Uint8Array(32).fill(0xaa),
    ...new Uint8Array(32).fill(0xbb),
    0x90,
    0,
  ]);
  assert.deepEqual(parseSignature(sig), {
    v: 1,
    r: `0x${"aa".repeat(32)}`,
    s: `0x${"bb".repeat(32)}`,
  });
});
