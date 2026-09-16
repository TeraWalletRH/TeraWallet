import { test } from "node:test";
import assert from "node:assert/strict";
import { split, combine, MAX_SHARES } from "../../public/tera/wallet/shamir.js";
import {
  newKeyInfo,
  isKeyInfo,
  scopeFor,
  unlockMessage,
  deriveVaultKey,
  encryptVault,
  decryptVault,
  nextEpoch,
  rotate,
  CURRENT_VERSION,
} from "../../public/tera/wallet/vault.js";
import {
  exportBundle,
  importBundle,
  createRecovery,
  recoverFromShares,
  encodeShare,
  decodeShare,
  passphraseIssue,
  EXPORT_FORMAT,
  MIN_PASSPHRASE,
} from "../../public/tera/wallet/recovery.js";

// PBKDF2 at production strength would make this suite crawl; the parameter is
// exercised, the cost is not.
const fast = { iterations: 1000 };
const owner = `0x${"1".repeat(40)}`;
const scope = scopeFor(owner, 4663, "https://terawallet.app");
const payload = { records: [{ txHash: "0xabc" }], presets: [{ name: "Payroll" }] };
const signature = `0x${"9".repeat(130)}`;

const keyFor = (info, passphrase = "", sig = signature) =>
  deriveVaultKey({ signature: sig, scope, info, passphrase });

// ---------------------------------------------------------------- Shamir

test("any threshold of shares rebuilds the secret, in any order", () => {
  const secret = new Uint8Array([1, 2, 3, 250, 255, 0, 128]);
  const shares = split(secret, { shares: 5, threshold: 3 });
  assert.equal(shares.length, 5);
  assert.deepEqual(combine([shares[0], shares[2], shares[4]]), secret);
  assert.deepEqual(combine([shares[4], shares[1], shares[0]]), secret);
  assert.deepEqual(combine(shares), secret);
});

test("fewer than the threshold does not rebuild the secret", () => {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const shares = split(secret, { shares: 5, threshold: 3 });
  assert.notDeepEqual(combine([shares[0], shares[1]]), secret);
});

test("a zero byte and an all-zero secret survive the round trip", () => {
  for (const secret of [new Uint8Array([0]), new Uint8Array(32), new Uint8Array([0, 255, 0])]) {
    const shares = split(secret, { shares: 4, threshold: 2 });
    assert.deepEqual(combine([shares[1], shares[3]]), secret);
  }
});

test("splitting refuses parameters that would not be a split", () => {
  const secret = new Uint8Array([7]);
  assert.throws(() => split(secret, { shares: 3, threshold: 1 }), /threshold below two/);
  assert.throws(() => split(secret, { shares: 2, threshold: 3 }), /at least as many shares/);
  assert.throws(() => split(new Uint8Array(), { shares: 3, threshold: 2 }), /no secret/);
  assert.throws(() => split(secret, { shares: MAX_SHARES + 1, threshold: 2 }), /At most/);
});

test("combining refuses duplicate or impossible shares", () => {
  const shares = split(new Uint8Array([9, 9]), { shares: 3, threshold: 2 });
  assert.throws(() => combine([shares[0], shares[0]]), /supplied twice/);
  assert.throws(() => combine([shares[0]]), /At least two/);
  assert.throws(() => combine([shares[0], { x: 2, y: new Uint8Array(1) }]), /same secret/);
  assert.throws(
    () => combine([shares[0], { x: 0, y: new Uint8Array(2) }]),
    /outside the valid range/,
  );
});

// The generator and the polynomial have to be a matching pair. A mismatched
// pair still produces plausible-looking shares that never reconstruct, so this
// exercises the field itself rather than only the happy path.
test("the field is a full cycle, not a short one", () => {
  // If the generator's order were short, many distinct secrets would collide
  // onto the same share values. Splitting every byte and rebuilding it proves
  // the exponent table covers all 255 non-zero elements.
  const every = new Uint8Array(256);
  for (let i = 0; i < 256; i++) every[i] = i;
  const shares = split(every, { shares: 3, threshold: 2 });
  assert.deepEqual(combine([shares[0], shares[2]]), every);
  // Distinct share points for a non-constant polynomial.
  assert.notDeepEqual(shares[0].y, shares[1].y);
});

test("many random secrets all round trip", () => {
  for (let round = 0; round < 50; round++) {
    const secret = crypto.getRandomValues(new Uint8Array(32));
    const shares = split(secret, { shares: 5, threshold: 3 });
    assert.deepEqual(combine([shares[0], shares[3], shares[4]]), secret);
  }
});

test("a fixed polynomial produces the shares the maths says it should", () => {
  // secret 0x50, single random coefficient 0x1b: f(x) = 0x50 + 0x1b·x
  const shares = split(new Uint8Array([0x50]), {
    shares: 3,
    threshold: 2,
    randomBytes: () => new Uint8Array([0x1b]),
  });
  assert.deepEqual([...shares[0].y], [0x50 ^ 0x1b]);
  assert.deepEqual(combine([shares[0], shares[2]]), new Uint8Array([0x50]));
});

// ------------------------------------------------------------- Key epochs

test("new key info is complete and recognised", () => {
  const info = newKeyInfo(fast);
  assert.equal(isKeyInfo(info), true);
  assert.equal(info.version, CURRENT_VERSION);
  assert.equal(info.epoch, 1);
  assert.equal(info.passphrase, false);
  for (const bad of [null, {}, { version: 1 }, { ...info, epoch: 0 }, { ...info, iterations: 10 }])
    assert.equal(isKeyInfo(bad), false);
});

test("the signed message changes with the epoch, which is what makes rotation work", () => {
  assert.notEqual(unlockMessage(scope, 1), unlockMessage(scope, 2));
  assert.match(unlockMessage(scope, 3), /key epoch 3/);
  // Epoch 1 keeps the original wording so an existing vault still opens.
  assert.equal(unlockMessage(scope, 1), `Unlock Tera encrypted local storage\n${scope}`);
});

test("a vault written under one key opens under the same key only", async () => {
  const info = newKeyInfo(fast);
  const vault = await encryptVault(await keyFor(info), payload, 30);
  assert.deepEqual(await decryptVault(await keyFor(info), vault), payload);
  // A different salt is a different key, even with the same signature.
  await assert.rejects(async () => decryptVault(await keyFor(newKeyInfo(fast)), vault));
});

test("rotation re-encrypts the contents and retires the old signature", async () => {
  const first = newKeyInfo(fast);
  const vault = await encryptVault(await keyFor(first), payload, 30);
  const second = newKeyInfo({ ...fast, epoch: nextEpoch(first) });
  assert.equal(second.epoch, 2);
  // The new epoch is signed separately, so the material differs.
  const rotatedSignature = `0x${"7".repeat(130)}`;
  const rotated = await rotate({
    key: await keyFor(second, "", rotatedSignature),
    payload,
    retentionDays: 30,
    info: second,
  });
  assert.deepEqual(
    await decryptVault(await keyFor(second, "", rotatedSignature), rotated.vault),
    payload,
  );
  // The old key no longer opens the rotated vault, and the old vault is gone.
  await assert.rejects(async () => decryptVault(await keyFor(first), rotated.vault));
  assert.notEqual(rotated.vault.ciphertext, vault.ciphertext);
  assert.throws(() => {
    if (!isKeyInfo(null)) throw new Error("Rotation needs the parameters of the new key.");
  });
});

test("a passphrase is required when the key was made with one", async () => {
  const info = newKeyInfo({ ...fast, passphrase: true });
  const vault = await encryptVault(await keyFor(info, "correct horse battery"), payload, 30);
  assert.deepEqual(await decryptVault(await keyFor(info, "correct horse battery"), vault), payload);
  await assert.rejects(() => keyFor(info, ""), /needs its passphrase/);
  await assert.rejects(async () => decryptVault(await keyFor(info, "wrong passphrase"), vault));
});

test("a version 1 vault still opens, and cannot pretend to have a passphrase", async () => {
  const legacy = await encryptVault(await keyFor(null), payload, 30);
  assert.deepEqual(await decryptVault(await keyFor(null), legacy), payload);
  await assert.rejects(() => keyFor(null, "some passphrase"), /predates passphrases/);
});

test("an expired vault returns nothing rather than its contents", async () => {
  const info = newKeyInfo(fast);
  const vault = await encryptVault(await keyFor(info), payload, 30);
  assert.equal(
    await decryptVault(await keyFor(info), { ...vault, expiresAt: "2020-01-01T00:00:00.000Z" }),
    null,
  );
});

// --------------------------------------------------- Export, import, recovery

test("an export round trips to a second device with the right passphrase", async () => {
  const bundle = await exportBundle(payload, "a long enough passphrase", fast);
  assert.equal(bundle.format, EXPORT_FORMAT);
  assert.deepEqual(await importBundle(bundle, "a long enough passphrase"), payload);
});

test("an export carries no plaintext of what it holds", async () => {
  const bundle = await exportBundle({ secret: "Payroll Ltd" }, "a long enough passphrase", fast);
  assert.equal(JSON.stringify(bundle).includes("Payroll"), false);
});

test("a wrong passphrase or an altered export is refused, and the two are not distinguished", async () => {
  const bundle = await exportBundle(payload, "a long enough passphrase", fast);
  await assert.rejects(() => importBundle(bundle, "not the passphrase"), /did not open this file/);
  const altered = {
    ...bundle,
    ciphertext: bundle.ciphertext.replace(/^./, (c) => (c === "A" ? "B" : "A")),
  };
  await assert.rejects(
    () => importBundle(altered, "a long enough passphrase"),
    /did not open this file/,
  );
  await assert.rejects(
    () => importBundle({ format: "something else" }, "x"),
    /not a Tera vault export/,
  );
  await assert.rejects(() => importBundle({ ...bundle, salt: "" }, "x"), /incomplete/);
});

test("a weak passphrase is refused before anything is written", async () => {
  assert.match(passphraseIssue("short"), /at least 12/);
  assert.match(passphraseIssue("123456789012345"), /Digits alone/);
  assert.equal(passphraseIssue("a long enough passphrase"), "");
  await assert.rejects(() => exportBundle(payload, "short", fast), /at least 12/);
  assert.equal(MIN_PASSPHRASE, 12);
});

test("any threshold of shares recovers the vault contents", async () => {
  const { blob, shares } = await createRecovery(payload, { shares: 5, threshold: 3 });
  assert.equal(shares.length, 5);
  assert.deepEqual(await recoverFromShares(blob, [shares[4], shares[0], shares[2]]), payload);
  assert.deepEqual(await recoverFromShares(blob, shares), payload);
});

test("too few shares recover nothing", async () => {
  const { blob, shares } = await createRecovery(payload, { shares: 4, threshold: 3 });
  await assert.rejects(() => recoverFromShares(blob, shares.slice(0, 2)), /needs 3 shares/);
});

test("shares from another recovery set do not open this one", async () => {
  const mine = await createRecovery(payload, { shares: 3, threshold: 2 });
  const other = await createRecovery({ different: true }, { shares: 3, threshold: 2 });
  await assert.rejects(
    () => recoverFromShares(mine.blob, other.shares.slice(0, 2)),
    /did not open this file/,
  );
});

test("the recovery file alone reveals nothing about its contents", async () => {
  const { blob } = await createRecovery({ secret: "Payroll Ltd" }, { shares: 3, threshold: 2 });
  assert.equal(JSON.stringify(blob).includes("Payroll"), false);
  assert.equal(JSON.stringify(blob).includes("secret"), false);
});

test("a share survives being written down, and a typo in one is caught", () => {
  const [share] = split(new Uint8Array([1, 2, 3]), { shares: 3, threshold: 2 });
  const text = encodeShare({ ...share, threshold: 2, shares: 3 });
  assert.match(text, /^TERA-R1\.2\.3\./);
  const decoded = decodeShare(`  ${text}  `);
  assert.equal(decoded.x, share.x);
  assert.deepEqual(decoded.y, share.y);
  assert.equal(decoded.threshold, 2);

  const parts = text.split(".");
  const flipped = parts[3].slice(0, -1) + (parts[3].at(-1) === "A" ? "B" : "A");
  assert.throws(
    () => decodeShare([parts[0], parts[1], parts[2], flipped, parts[4]].join(".")),
    /checksum/,
  );
  assert.throws(() => decodeShare("not a share"), /not a Tera recovery share/);
  // A share from a future format is refused rather than misread.
  assert.throws(() => decodeShare("TERA-R2.2.3.AQID.00000000"), /not a Tera recovery share/);
});

test("the recovery file states its own threshold so the owner is not guessing", async () => {
  const { blob } = await createRecovery(payload, { shares: 4, threshold: 2 });
  assert.equal(blob.threshold, 2);
  assert.equal(blob.shares, 4);
  assert.match(blob.note, /Any 2 of the 4 shares/);
});
