import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findArtefacts,
  accountsIn,
  categoryFor,
  plan,
  wipe,
  CATEGORIES,
  LIMITS,
  PREFIX,
} from "../../public/tera/wallet/wipe.js";

// A stand-in for Web Storage: plain own properties, plus removeItem.
function storage(entries = {}) {
  const store = { ...entries };
  Object.defineProperty(store, "removeItem", {
    value: (key) => delete store[key],
    enumerable: false,
  });
  return store;
}

const first = `0x${"1".repeat(40)}`;
const second = `0x${"2".repeat(40)}`;
const base = (owner) => `tera-wallet-v1:https://api.terawallet.app:4663:${owner}`;

function populated() {
  return storage({
    [base(first)]: "legacy",
    [`${base(first)}:encrypted`]: "cipher",
    [`${base(first)}:keyinfo`]: "params",
    [`${base(first)}:recovery`]: "blob",
    [`${base(first)}:retention`]: "30",
    [`${base(second)}:encrypted`]: "cipher",
    [`${base(second)}:keyinfo`]: "params",
    "tera-demo-v1": "demo",
    "tera-locale": "en",
    "unrelated-app": "keep me",
    "wallet-of-another-product": "keep me too",
  });
}

test("every artefact this site writes is found, and nothing else is", () => {
  const local = populated();
  const found = findArtefacts([local]);
  assert.equal(found.length, 9);
  assert.equal(
    found.every((entry) => entry.key.startsWith(PREFIX)),
    true,
  );
  assert.equal(
    found.some((entry) => entry.key.includes("unrelated")),
    false,
  );
});

test("a locked vault and a disconnected wallet are wiped just the same", () => {
  // Nothing in the scan depends on a connected account: that is the case the
  // control exists for.
  const local = populated();
  const result = wipe([local]);
  assert.equal(result.removed, 9);
  assert.equal(result.remaining, 0);
  assert.equal(Object.keys(local).length, 2);
  assert.equal(local["unrelated-app"], "keep me");
});

test("artefacts of every account are wiped, not only the one on screen", () => {
  const local = populated();
  assert.equal(plan([local]).accounts, 2);
  wipe([local]);
  assert.equal(findArtefacts([local]).length, 0);
});

test("session storage is covered as well as local storage", () => {
  const local = storage({ [`${base(first)}:encrypted`]: "cipher" });
  const session = storage({ "tera-preloader-v1": "1", other: "keep" });
  const result = wipe([local, session]);
  assert.equal(result.removed, 2);
  assert.equal(findArtefacts([local, session]).length, 0);
  assert.equal(session.other, "keep");
});

test("the plan counts artefacts and never repeats an address", () => {
  const summary = plan([populated()]);
  assert.equal(summary.total, 9);
  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes(first), false);
  assert.equal(serialized.includes(second), false);
  assert.equal(serialized.includes("tera-wallet-v1"), false);
  for (const entry of summary.categories) {
    assert.ok(entry.count >= 1);
    assert.ok(entry.label && entry.detail);
  }
});

test("each key is described by the right category", () => {
  assert.equal(categoryFor(`${base(first)}:encrypted`).id, "vault");
  assert.equal(categoryFor(`${base(first)}:keyinfo`).id, "keyinfo");
  assert.equal(categoryFor(`${base(first)}:recovery`).id, "recovery");
  assert.equal(categoryFor(`${base(first)}:retention`).id, "retention");
  assert.equal(categoryFor(base(first)).id, "legacy");
  assert.equal(categoryFor("tera-demo-v1").id, "demo");
  assert.equal(categoryFor("tera-locale").id, "site");
  assert.equal(categoryFor("tera-preloader-v1").id, "site");
  // A key added later is still wiped, and still described.
  const unknown = categoryFor("tera-something-new");
  assert.equal(unknown.id, "other");
  assert.ok(unknown.label);
});

test("an artefact added by a future version is still removed", () => {
  const local = storage({ "tera-future-feature": "data", keep: "yes" });
  assert.equal(wipe([local]).removed, 1);
  assert.equal(local.keep, "yes");
});

test("a storage that refuses removal is reported rather than assumed clean", () => {
  const stubborn = { "tera-locale": "en" };
  Object.defineProperty(stubborn, "removeItem", {
    value: () => {
      throw new Error("denied");
    },
    enumerable: false,
  });
  const result = wipe([stubborn]);
  assert.equal(result.remaining, 1);
  assert.equal(result.removed, 0);
});

test("a storage that cannot be read does not stop the others being wiped", () => {
  const blocked = new Proxy(
    {},
    {
      ownKeys() {
        throw new Error("blocked");
      },
    },
  );
  const local = storage({ "tera-locale": "en" });
  assert.equal(wipe([blocked, local]).removed, 1);
});

test("wiping an already empty browser is a no-op that says so", () => {
  const local = storage({ unrelated: "keep" });
  const result = wipe([local]);
  assert.equal(result.removed, 0);
  assert.equal(result.remaining, 0);
  assert.equal(result.plan.total, 0);
  assert.equal(result.plan.accounts, 0);
});

test("accounts are counted, whatever case the address was stored in", () => {
  const artefacts = [
    { storage: 0, key: `${base(first)}:encrypted` },
    { storage: 0, key: `${base(first.toUpperCase().replace("0X", "0x"))}:keyinfo` },
    { storage: 0, key: `${base(second)}:encrypted` },
  ];
  assert.equal(accountsIn(artefacts), 2);
});

test("the limits are stated, including the ones that are uncomfortable", () => {
  assert.ok(LIMITS.length >= 5);
  const text = LIMITS.join(" ").toLowerCase();
  // A wipe that implied any of these were covered would be dangerous.
  assert.match(text, /tera already holds/);
  assert.match(text, /wallet extension/);
  assert.match(text, /recovery shares/);
  assert.match(text, /chain/);
  assert.match(text, /does not disguise itself/);
  assert.match(text, /recovered from the disk/);
});

test("every category carries a label and an explanation", () => {
  for (const category of CATEGORIES) {
    assert.ok(category.label, `${category.id} has no label`);
    assert.ok(category.detail, `${category.id} explains nothing`);
    assert.equal(typeof category.match, "function");
  }
});
