import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  FORMAT,
  CODE,
  DEVICE,
  SERVICE,
  ANSWERED_BY,
  CLAIMS,
  PASS,
  FAIL,
  UNVERIFIABLE,
  SKIPPED,
  EXPORT_WARNING,
  exportNotice,
  create,
  bundle,
  verify,
  shortRef,
  tally,
  FROM_PAGE,
  INDEPENDENT,
} from "../../public/tera/core/receipt.js";

globalThis.crypto ??= webcrypto;
globalThis.btoa ??= (binary) => Buffer.from(binary, "binary").toString("base64");

const TURN = { input: "what does the policy check do?", output: "It checks the signed bundle." };

const made = (overrides = {}) =>
  create({
    answeredBy: CODE,
    input: TURN.input,
    output: TURN.output,
    release: "r-d5b1ca767477",
    integrity: "verified",
    module: "checks.js",
    at: Date.UTC(2026, 8, 17, 12, 0, 0),
    ...overrides,
  });

const statusOf = (checks, id) => checks.find((entry) => entry.id === id)?.status;

test("a receipt commits to the exact text in and out", async () => {
  const receipt = await made();
  assert.equal(receipt.format, FORMAT);
  assert.equal(receipt.answeredBy, CODE);
  assert.equal(receipt.module, "checks.js");
  assert.match(receipt.inputHash, /^sha256-/);
  assert.match(receipt.outputHash, /^sha256-/);
  assert.equal(receipt.at, "2026-09-17T12:00:00.000Z");

  const result = await verify(bundle(receipt, TURN));
  assert.equal(statusOf(result.checks, "input_hash"), PASS);
  assert.equal(statusOf(result.checks, "output_hash"), PASS);
  assert.equal(result.ok, true);
});

test("one altered character in the reply fails the commitment", async () => {
  const receipt = await made();
  const tampered = bundle(receipt, { ...TURN, output: "It checks the signed bundle!" });
  const result = await verify(tampered);
  assert.equal(statusOf(result.checks, "output_hash"), FAIL);
  assert.equal(statusOf(result.checks, "input_hash"), PASS, "only the altered side fails");
  assert.equal(result.ok, false);
});

test("whether anything was sent is never reported as proven", async () => {
  // The claim an owner most wants, and the one a page cannot establish about
  // itself. If this ever passes, the receipt has started lying by construction.
  for (const answeredBy of [CODE, DEVICE, SERVICE]) {
    const receipt = await made({ answeredBy, model: answeredBy === DEVICE ? "SmolLM2" : "" });
    const result = await verify(bundle(receipt, TURN));
    assert.equal(statusOf(result.checks, "sent"), UNVERIFIABLE, answeredBy);
  }
});

test("a local answer records that nothing was sent, and says why that is not proof", async () => {
  const receipt = await made({ answeredBy: CODE });
  assert.equal(receipt.sent, false);
  const result = await verify(bundle(receipt, TURN));
  const sent = result.checks.find((entry) => entry.id === "sent");
  assert.match(sent.detail, /No page can prove that about itself/i);
  assert.match(sent.detail, /published source|network panel/i);
});

test("a service turn records that it was sent", async () => {
  const receipt = await made({ answeredBy: SERVICE, replaced: 3, module: "" });
  assert.equal(receipt.sent, true);
  assert.equal(receipt.minimised, true);
  assert.equal(receipt.replaced, 3);
});

test("the release and the model are reported, never verified", async () => {
  const receipt = await made({ answeredBy: DEVICE, model: "SmolLM2-135M-Instruct", module: "" });
  const result = await verify(bundle(receipt, TURN));
  assert.equal(statusOf(result.checks, "release"), UNVERIFIABLE);
  assert.equal(statusOf(result.checks, "model"), UNVERIFIABLE);
  assert.match(
    result.checks.find((entry) => entry.id === "release").detail,
    /No approved-build registry was available/i,
  );
});

test("the model check is skipped rather than dropped when no model ran", async () => {
  // Omitting it would leave a list of passes with the hard part invisible.
  const result = await verify(bundle(await made({ answeredBy: CODE }), TURN));
  assert.equal(statusOf(result.checks, "model"), SKIPPED);
});

test("a receipt written by a page that knew it was modified says so", async () => {
  const result = await verify(bundle(await made({ integrity: "modified" }), TURN));
  assert.equal(statusOf(result.checks, "integrity"), FAIL);
  assert.equal(result.ok, false, "a modified page invalidates the whole receipt");
});

test("a page that could not check itself reports that, not a pass", async () => {
  const result = await verify(bundle(await made({ integrity: "unavailable" }), TURN));
  assert.equal(statusOf(result.checks, "integrity"), SKIPPED);
});

test("claiming to be unmodified is never a pass, but admitting it is a failure", async () => {
  // Asymmetric on purpose. "I did not match my published release" is an
  // admission against interest and nobody forges one, so it fails the receipt.
  // "I did match" is the claim a modified page would also make, so it is only
  // ever reported.
  const claimed = await verify(bundle(await made({ integrity: "verified" }), TURN));
  assert.equal(statusOf(claimed.checks, "integrity"), UNVERIFIABLE);
  assert.equal(claimed.ok, true, "a self-report must not fail an otherwise sound receipt");

  const admitted = await verify(bundle(await made({ integrity: "modified" }), TURN));
  assert.equal(statusOf(admitted.checks, "integrity"), FAIL);
  assert.equal(admitted.ok, false);
});

test("a receipt without its transcript skips the commitments instead of passing them", async () => {
  // The dangerous shape: a file with hashes and nothing to check them against.
  const receipt = await made();
  const result = await verify(receipt);
  assert.equal(statusOf(result.checks, "input_hash"), SKIPPED);
  assert.equal(statusOf(result.checks, "output_hash"), SKIPPED);
  assert.equal(result.ok, true, "nothing failed, but nothing was proven either");
  const counts = tally(result.checks);
  assert.equal(counts.pass < counts.skipped + counts.unverifiable, true);
});

test("the short reference is derived from the reply hash", async () => {
  const receipt = await made();
  assert.equal(receipt.shortRef.length, 8);
  assert.match(receipt.shortRef, /^[a-z0-9]{8}$/);
  assert.equal(receipt.shortRef, shortRef(receipt.outputHash));

  const forged = bundle({ ...receipt, shortRef: "deadbeef" }, TURN);
  assert.equal(statusOf((await verify(forged)).checks, "short_ref"), FAIL);
});

test("junk and unknown formats are rejected rather than half-read", async () => {
  assert.equal((await verify("not json at all")).ok, false);
  assert.equal((await verify(null)).ok, false);
  const wrong = await verify({ ...(await made()), format: "some-other/9" });
  assert.equal(statusOf(wrong.checks, "format"), FAIL);
});

test("a receipt can be read back from its exported text", async () => {
  const exported = JSON.stringify(bundle(await made(), TURN));
  const result = await verify(exported);
  assert.equal(result.ok, true);
  assert.equal(statusOf(result.checks, "output_hash"), PASS);
});

test("the claims list leads with what cannot be proven", () => {
  const cannot = CLAIMS.cannot.join(" ").toLowerCase();
  assert.ok(cannot.includes("that nothing was sent"), "the headline limit must be first and plain");
  assert.equal(
    CLAIMS.cannot[0].startsWith("That nothing was sent"),
    true,
    "it must be the first thing in the list, not buried",
  );
  assert.ok(
    cannot.includes("when it is unsigned"),
    "an unsigned receipt proving nothing must be stated, not implied",
  );
  assert.ok(CLAIMS.proves.length > 0 && CLAIMS.cannot.length > CLAIMS.proves.length - 1);
});

test("exporting is described as sending, because that is what it is", () => {
  // For a turn answered on this device, the export is the first time the text
  // leaves. An owner should read that before they click, not after.
  assert.match(EXPORT_WARNING, /has not left this browser until now/i);
  assert.match(EXPORT_WARNING, /exporting it is you sending it/i);
});

test("every engine has a label and a detail, and only the service sends", () => {
  for (const entry of Object.values(ANSWERED_BY)) {
    assert.ok(entry.label.length > 0, entry.id);
    assert.ok(entry.detail.length > 0, entry.id);
  }
  assert.match(ANSWERED_BY[CODE].detail, /no request was made/i);
  assert.match(ANSWERED_BY[DEVICE].detail, /no request was made/i);
  assert.match(ANSWERED_BY[SERVICE].detail, /sent/i);
});

test("a receipt must say which engine answered", async () => {
  await assert.rejects(() => create({ input: "a", output: "b" }));
  await assert.rejects(() => create({ answeredBy: "something else", input: "a", output: "b" }));
});

test("two identical turns produce the same commitments", async () => {
  // The hashes are over the text and nothing else, so a receipt is comparable
  // across devices. Only the timestamp may differ.
  const one = await made({ at: 1 });
  const two = await made({ at: 2 });
  assert.equal(one.inputHash, two.inputHash);
  assert.equal(one.outputHash, two.outputHash);
  assert.notEqual(one.at, two.at);
});

// ---------------------------------------------------------------- signing

import {
  DOMAIN,
  canonical,
  digestOf,
  signingMessage,
  sign,
} from "../../public/tera/core/receipt.js";
import { unlockMessage } from "../../public/tera/wallet/vault.js";

// A stub signer: records what it was asked to sign and returns a fixed value.
function stubSigner(address = "0x8ba1f109551bd432803012645ac136ddd64dba72") {
  const seen = [];
  return {
    address,
    seen,
    sign: async (message) => {
      seen.push(message);
      return `0xsig:${message.length}`;
    },
    // Recovers only if handed back the exact message that was signed.
    recover: async (message, signature) =>
      signature === `0xsig:${message.length}` && seen.includes(message) ? address : "0xdead",
  };
}

test("a signed receipt recovers to the address that signed it", async () => {
  const wallet = stubSigner();
  const signed = await sign(await made(), { signer: wallet.address, sign: wallet.sign });
  assert.equal(signed.signer, wallet.address);
  assert.match(signed.digest, /^sha256-/);

  const result = await verify(bundle(signed, TURN), { recover: wallet.recover });
  assert.equal(statusOf(result.checks, "signature"), PASS);
  assert.equal(statusOf(result.checks, "digest"), PASS);
  assert.equal(result.ok, true);
});

test("editing any field after signing breaks the digest", async () => {
  // The point of signing: an unsigned receipt can be edited without trace.
  const wallet = stubSigner();
  const signed = await sign(await made({ answeredBy: CODE }), {
    signer: wallet.address,
    sign: wallet.sign,
  });
  // The most tempting edit there is: turn "sent" into "not sent".
  const forged = bundle({ ...signed, sent: true }, TURN);
  const result = await verify(forged, { recover: wallet.recover });
  assert.equal(statusOf(result.checks, "digest"), FAIL);
  assert.equal(result.ok, false);
});

test("an unsigned receipt says outright that it can be edited without trace", async () => {
  const result = await verify(bundle(await made(), TURN));
  assert.equal(statusOf(result.checks, "digest"), SKIPPED);
  assert.equal(statusOf(result.checks, "signature"), SKIPPED);
  assert.match(
    result.checks.find((entry) => entry.id === "digest").detail,
    /edited without trace/i,
  );
});

test("a signature nobody can check is unproven, not passed", async () => {
  const wallet = stubSigner();
  const signed = await sign(await made(), { signer: wallet.address, sign: wallet.sign });
  const result = await verify(bundle(signed, TURN));
  assert.equal(statusOf(result.checks, "signature"), UNVERIFIABLE);
});

test("a signature from the wrong address fails", async () => {
  const wallet = stubSigner();
  const signed = await sign(await made(), { signer: wallet.address, sign: wallet.sign });
  const wrong = bundle({ ...signed, signer: "0x0000000000000000000000000000000000000001" }, TURN);
  const result = await verify(wrong, { recover: wallet.recover });
  // Changing the signer also changes the digest, so both checks catch it.
  assert.equal(statusOf(result.checks, "signature"), FAIL);
  assert.equal(result.ok, false);
});

test("the signed payload is readable text, never raw digest bytes", async () => {
  // A wallet shows an owner what they are signing. Handing it 32 bytes shows
  // them nothing they can check, and the point of a receipt is checkability.
  const wallet = stubSigner();
  await sign(await made(), { signer: wallet.address, sign: wallet.sign });
  const message = wallet.seen[0];
  assert.equal(message.startsWith(DOMAIN), true, "the domain must be the first line");
  assert.match(message, /moves nothing, approves nothing/i);
  assert.match(message, /cannot authorise a transaction/i);
  assert.match(message, /No request was made/);
  assert.match(message, /Digest: sha256-/);
});

test("the receipt domain cannot be confused with anything else this wallet signs", () => {
  // A key does not know what it is signing for. Every payload this wallet asks
  // an owner to sign must be unusable as any other, and the first line is what
  // guarantees that.
  const others = [
    unlockMessage("tera-wallet-v1:x:4663:0xabc", 2),
    "Tera Wallet data deletion\nWallet: 0xabc\nTimestamp: 1",
    "Tera build manifest v1:r-1:2026-01-01:sha256-x",
  ];
  for (const other of others) {
    assert.ok(!other.startsWith(DOMAIN), `${other.split("\n")[0]} must not start with the domain`);
    assert.ok(
      !DOMAIN.startsWith(other.split("\n")[0]),
      "no other domain may be a prefix of the receipt domain",
    );
  }
});

test("the canonical form is deterministic and leaves out the signature", async () => {
  const receipt = await made();
  const shuffled = Object.fromEntries(Object.entries(receipt).reverse());
  assert.equal(canonical(receipt), canonical(shuffled), "key order must not matter");

  const wallet = stubSigner();
  const signed = await sign(receipt, { signer: wallet.address, sign: wallet.sign });
  assert.equal(
    await digestOf(signed),
    await digestOf(receipt),
    "adding the signature must not change what the signature covers",
  );
  const text = canonical(signed);
  assert.ok(!text.includes("signature="), "the signature cannot be inside its own digest");
  assert.ok(!text.includes("transcript="), "the transcript is committed to by its hashes");
});

test("signing refuses without an address or a way to sign", async () => {
  const receipt = await made();
  await assert.rejects(() => sign(receipt, { signer: "0xabc" }));
  await assert.rejects(() => sign(receipt, { sign: async () => "0x" }));
});

test("a signature is never claimed to prove the negative", async () => {
  // Signing binds a record to an address. It does not make "nothing was sent"
  // provable, and a receipt that started implying otherwise would be worse
  // than the unsigned one.
  const wallet = stubSigner();
  const signed = await sign(await made({ answeredBy: CODE }), {
    signer: wallet.address,
    sign: wallet.sign,
  });
  const result = await verify(bundle(signed, TURN), { recover: wallet.recover });
  assert.equal(statusOf(result.checks, "sent"), UNVERIFIABLE);
  assert.ok(CLAIMS.cannot.some((line) => /Tera agreed/i.test(line)));
});

test("the signing prompt keeps the line that says it does nothing separate", async () => {
  // In the wallet's own window an owner reads top-down and stops early. The
  // blank line is what keeps "this moves nothing" from running into the facts.
  const wallet = stubSigner();
  await sign(await made(), { signer: wallet.address, sign: wallet.sign });
  const lines = wallet.seen[0].split("\n");
  assert.equal(lines[0], DOMAIN);
  assert.equal(lines[3], "", "a blank line must separate the preamble from the fields");
  assert.match(lines[4], /^Answered by:/);
});

test("the export notice says the text has never left, only when that is true", async () => {
  // The file is identical either way. What differs is whether saving it is the
  // moment the text leaves the device, and that is the whole decision.
  const local = exportNotice(await made({ answeredBy: DEVICE }));
  assert.equal(local.firstSend, true);
  assert.match(local.headline, /never left your browser/i);
  assert.match(local.detail, /first time/i);

  const remote = exportNotice(await made({ answeredBy: SERVICE, sent: true }));
  assert.equal(remote.firstSend, false);
  assert.doesNotMatch(remote.headline, /never left/i);
  assert.match(remote.detail, /nowhere new/i);
});

test("the export notice always states what the reader of the file can see", async () => {
  for (const receipt of [
    await made({ answeredBy: CODE }),
    await made({ answeredBy: SERVICE, sent: true }),
  ]) {
    const notice = exportNotice(receipt);
    assert.match(notice.consequence, /read both in full/i);
    const labels = notice.contents.map((part) => part.label);
    assert.ok(labels.includes("Your message"));
    assert.ok(labels.includes("The reply"));
  }
});

test("the export notice lists a signature only when the receipt carries one", async () => {
  const unsigned = exportNotice(await made());
  assert.ok(!unsigned.contents.some((part) => /signature/i.test(part.label)));

  const wallet = stubSigner();
  const signed = await sign(await made(), { signer: wallet.address, sign: wallet.sign });
  const notice = exportNotice(signed);
  assert.ok(notice.contents.some((part) => /signature/i.test(part.label)));
});

test("a registry can settle the release check, and only from outside the page", async () => {
  // Build 8. The release name used to be unprovable in every reading. Given a
  // signed list the reader fetched themselves, a match is a pass and a miss is
  // evidence — but the same list fetched by the page proves nothing.
  const signed = await made({ release: "r-ffd0e45a1b2c" });
  const registry = {
    registry: "Tera approved builds",
    version: 1,
    algorithm: "sha256",
    builds: [{ release: "r-ffd0e45a1b2c", filesHash: "sha256-AAAA", publishedAt: "2026-09-18" }],
  };
  const read = async (options) =>
    (await verify(bundle(signed, TURN), options)).checks.find((entry) => entry.id === "release");

  assert.equal(
    (await read({ registry, registryOrigin: INDEPENDENT, registryAuthentic: true })).status,
    PASS,
  );
  assert.equal(
    (await read({ registry, registryOrigin: FROM_PAGE, registryAuthentic: true })).status,
    UNVERIFIABLE,
  );
  assert.equal((await read({ registry, registryOrigin: INDEPENDENT })).status, UNVERIFIABLE);
  assert.equal((await read({})).status, UNVERIFIABLE);

  // A release that was never published is a failure, not an absence.
  const forged = await made({ release: "r-000000000000" });
  const miss = (
    await verify(bundle(forged, TURN), {
      registry,
      registryOrigin: INDEPENDENT,
      registryAuthentic: true,
    })
  ).checks.find((entry) => entry.id === "release");
  assert.equal(miss.status, FAIL);
});
