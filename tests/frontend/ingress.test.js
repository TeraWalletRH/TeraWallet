import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KINDS,
  LIMITS,
  MNEMONIC_RUN,
  inspect,
  longestRun,
  notice,
} from "../../public/tera/wallet/ingress.js";
import { indexOf, isWord, COUNT } from "../../public/tera/wallet/wordlist.js";

// A real BIP-39 phrase. It is the standard test vector, published in the spec
// and in every wallet's test suite, and controls nothing.
const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

test("every word in the list resolves to its own index", () => {
  // The packed table stores four-character prefixes. An earlier version scanned
  // the packed string with indexOf and returned the first hit, which for
  // "banana" was a fragment spanning "abandon" and "ability" — so the word was
  // reported as absent. Only a boundary counts.
  assert.equal(COUNT, 2048);
  assert.equal(indexOf("abandon"), 0);
  assert.equal(indexOf("ability"), 1);
  assert.equal(indexOf("banana"), 145);
  assert.equal(indexOf("zoo"), 2047);
  assert.equal(isWord("xyzzy"), false);
  assert.equal(indexOf(""), -1);
});

test("a recovery phrase is refused", () => {
  const verdict = inspect(PHRASE);
  assert.equal(verdict.safe, false);
  assert.equal(verdict.kind, "mnemonic");
  assert.equal(verdict.run, 12);
});

test("a phrase is still refused when it is wrapped in a sentence", () => {
  // How it actually happens: someone explains what they are pasting.
  const verdict = inspect(`hi, I think my wallet is broken, my phrase is ${PHRASE} please help`);
  assert.equal(verdict.safe, false);
  assert.equal(verdict.kind, "mnemonic");
});

test("a 24-word phrase is refused", () => {
  assert.equal(inspect(`${PHRASE} ${PHRASE}`).kind, "mnemonic");
});

test("ordinary English is not mistaken for a recovery phrase", () => {
  // Around a third of common English words are in the BIP-39 list, by design.
  // Counting matches anywhere would make this gate fire constantly; only a run
  // of twelve counts, and prose does not produce one.
  for (const message of [
    "what is the policy check and how does it work with this asset",
    "I want to buy about ten of these and then sell half of them later that day",
    "can you explain what happens when I approve a transfer to my other account",
    "the risk check said my amount was fine but I would like to know why",
    "please show me the receipts for the actions I approved above this week",
  ]) {
    const verdict = inspect(message);
    assert.equal(verdict.safe, true, `${message} → ${verdict.kind} (run ${longestRun(message)})`);
  }
});

test("eleven words in a row is not enough, twelve is", () => {
  // The boundary is the whole design. It must be exact in both directions.
  const words = PHRASE.split(" ");
  const eleven = words.slice(0, 11).join(" ");
  assert.equal(longestRun(eleven), 11);
  assert.equal(inspect(eleven).safe, true, "a partial run must not refuse");

  const twelve = words.slice(0, 12).join(" ");
  assert.equal(longestRun(twelve), MNEMONIC_RUN);
  assert.equal(inspect(twelve).safe, false);
});

test("a run broken by a word outside the list is counted as two runs", () => {
  const words = PHRASE.split(" ");
  const broken = [...words.slice(0, 6), "xyzzy", ...words.slice(6)].join(" ");
  assert.equal(longestRun(broken), 6, "the run restarts after a word not in the list");
  assert.equal(inspect(broken).safe, true);
});

test("a bare private key is refused", () => {
  const key = "4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318";
  assert.equal(inspect(key).kind, "privateKey");
  assert.equal(inspect(`my key is ${key}, is that a problem?`).kind, "privateKey");
});

test("a transaction reference keeps working, and the trade-off is written down", () => {
  // A 0x-prefixed 64-hex string is a transaction hash, which owners paste here
  // legitimately. It is also the shape of a prefixed private key, and the two
  // are the same 32 bytes. Refusing both would break ordinary lookups; the
  // choice is stated in LIMITS rather than discovered.
  const hash = "0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318";
  assert.equal(inspect(hash).safe, true);
  assert.equal(inspect(`what happened in ${hash}`).safe, true);
  assert.ok(
    LIMITS.some((limit) => /0x prefix/i.test(limit) && /indistinguishable/i.test(limit)),
    "the undecidable case must be stated as a limit",
  );
});

test("an address is not mistaken for a key", () => {
  // 40 hex characters, not 64. This box has to stay usable.
  assert.equal(inspect("send it to 0x8ba1f109551bd432803012645ac136ddd64dba72").safe, true);
});

test("extended keys are refused, public ones too", () => {
  const xprv =
    "xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi";
  const xpub =
    "xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8";
  assert.equal(inspect(xprv).kind, "extendedKey");
  // An xpub cannot spend, but it hands over every address the owner will use.
  assert.equal(inspect(xpub).kind, "extendedKey");
  assert.match(KINDS.extendedKey.detail, /cannot spend/i);
});

test("a keystore file is refused, and one stray field is not", () => {
  const keystore = `{"version":3,"crypto":{"ciphertext":"abc","cipherparams":{"iv":"def"},"kdfparams":{"n":262144}}}`;
  assert.equal(inspect(keystore).kind, "keystore");
  // A message that merely mentions one of the words is not a keystore.
  assert.equal(inspect('what does "ciphertext": mean in this context?').safe, true);
});

test("PEM blocks and credentials are refused", () => {
  assert.equal(inspect("-----BEGIN EC PRIVATE KEY-----\nMHQCAQE...").kind, "pem");
  assert.equal(inspect("-----BEGIN PRIVATE KEY-----\nMIIE...").kind, "pem");
  assert.equal(inspect("api_key=EXAMPLE0000NOT0000REAL0000TOKEN").kind, "credential");
  assert.equal(
    inspect("Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9").kind,
    "credential",
  );
  // A sentence about keys is not a key.
  assert.equal(inspect("where do I put my api key?").safe, true);
});

test("the verdict carries no part of the message", () => {
  // The point of the whole module: the text is the secret, so a record of it is
  // a record of the secret.
  //
  // Searching the verdict for words from the input cannot prove that. The
  // static copy says "nothing about the message was recorded", and "about" is
  // itself a list word, so that search fails on text that carries no
  // information at all. The real property is that two different secrets of the
  // same kind produce a byte-identical verdict, and it holds whatever the copy
  // happens to say.
  const one = inspect(PHRASE);
  const two = inspect(
    "legal winner thank year wave sausage worth useful legal winner thank yellow",
  );
  assert.equal(one.kind, "mnemonic");
  assert.equal(two.kind, "mnemonic");
  assert.equal(
    JSON.stringify(one),
    JSON.stringify(two),
    "two different phrases must be indistinguishable from their verdicts",
  );

  // The shape is fixed too, so nothing input-derived can be added by accident.
  for (const key of Object.keys(one))
    assert.ok(
      ["safe", "kind", "label", "detail", "run"].includes(key),
      `unexpected field on a verdict: ${key}`,
    );
  // `run` is the one number that varies, and it distinguishes a 24-word phrase
  // from a 12-word one. That is the most any verdict can ever reveal.
  assert.equal(one.run, 12);
});

test("the notice tells the owner what to do and repeats nothing", () => {
  const line = notice(inspect(PHRASE));
  assert.match(line, /Nothing was sent/);
  assert.match(line, /Clear the box/);
  assert.ok(!line.includes("abandon"));
  assert.equal(notice(inspect("what are the five checks?")), "");
  assert.equal(notice(null), "");
});

test("empty and whitespace messages pass", () => {
  assert.equal(inspect("").safe, true);
  assert.equal(inspect("   \n  ").safe, true);
  assert.equal(inspect(null).safe, true);
  assert.equal(inspect(undefined).safe, true);
});

test("the limits refuse to imply the gate is complete", () => {
  const text = LIMITS.join(" ").toLowerCase();
  assert.ok(text.includes("cannot see what you paste anywhere else"));
  assert.ok(text.includes("another language"), "non-English phrases are not covered");
  assert.ok(
    text.includes("not protection against a page pretending to be this one"),
    "the guard must not be read as anti-phishing",
  );
});

test("every kind says the message was not recorded", () => {
  // An owner who has just pasted a seed phrase needs to know it did not end up
  // in a log. Every message they can land on has to say so.
  for (const kind of Object.values(KINDS))
    assert.match(kind.detail, /not recorded|nothing about the message/i, kind.id);
});

test("real prose leaves a wide margin under the threshold", () => {
  // The threshold is only safe if ordinary wallet talk stays well below it.
  // Measured rather than assumed: if a future change to the run rule eats the
  // margin, this fails while there is still room, not once owners are seeing
  // their questions refused.
  const prose = [
    "I would like to buy about ten units of this asset and then sell half of them",
    "can you explain what the risk check does when the amount is above my limit",
    "the wallet said my action was blocked at the policy check so what do I do now",
    "please open the receipts page and show me what I approved on the first of the month",
    "why does the eligibility preflight need the recipient address before it can pass",
    "I want to add a second endpoint so that no single operator sees all my accounts",
  ];
  const worst = Math.max(...prose.map(longestRun));
  assert.ok(worst < MNEMONIC_RUN, `prose reached a run of ${worst}`);
  assert.ok(
    MNEMONIC_RUN - worst >= 5,
    `only ${MNEMONIC_RUN - worst} words of margin left; the threshold is too close to real language`,
  );
  for (const line of prose) assert.equal(inspect(line).safe, true, line);
});

test("a secret is refused whatever else the message would have done", () => {
  // Ingress runs before the parser and before either engine, so a phrase
  // wrapped in a question that parse.js would answer is still refused, and so
  // is one in a message that was on its way to being a proposal.
  const carrier = `what are the five checks? ${PHRASE}`;
  assert.equal(inspect(carrier).kind, "mnemonic");
  assert.equal(
    inspect(`send 50 USDG to 0x8ba1f109551bd432803012645ac136ddd64dba72 ${PHRASE}`).kind,
    "mnemonic",
  );
});
