// One control that destroys every local artefact this site has stored.
//
// It works from a prefix scan rather than from the connected account, for two
// reasons. A wipe has to work when the vault is locked and no wallet is
// connected — that is when it is most likely to be needed. And it has to cover
// every account this browser has held, not only the one on screen, or switching
// accounts afterwards would reveal a vault the owner believed was gone.
//
// Nothing here makes a network call, and nothing here reports a value. The
// summary counts artefacts and never repeats an address.

export const PREFIX = "tera-";

const ACCOUNT_KEY = /^tera-wallet-v1:/;
const SUFFIXED = /:(encrypted|keyinfo|recovery|retention)$/;

export const CATEGORIES = [
  {
    id: "vault",
    label: "Encrypted vault",
    detail: "Drafts, device-side records, bridge tracking, presets and version history.",
    match: (key) => ACCOUNT_KEY.test(key) && key.endsWith(":encrypted"),
  },
  {
    id: "keyinfo",
    label: "Vault key parameters",
    detail: "The epoch and salt the vault key is derived from.",
    match: (key) => ACCOUNT_KEY.test(key) && key.endsWith(":keyinfo"),
  },
  {
    id: "recovery",
    label: "Recovery file",
    detail: "The copy that recovery shares open. The shares themselves are not here.",
    match: (key) => ACCOUNT_KEY.test(key) && key.endsWith(":recovery"),
  },
  {
    id: "retention",
    label: "Retention setting",
    detail: "How long this browser was told to keep encrypted data.",
    match: (key) => ACCOUNT_KEY.test(key) && key.endsWith(":retention"),
  },
  {
    id: "legacy",
    label: "Older plaintext record store",
    detail: "Written by versions of this wallet from before the vault was encrypted.",
    match: (key) => ACCOUNT_KEY.test(key) && !SUFFIXED.test(key),
  },
  {
    id: "engine",
    label: "On-device model check",
    detail:
      "The record that this browser already verified the model files. The weights themselves are in cache storage and are removed with them.",
    match: (key) => key === "tera-engine-verified-v1",
  },
  {
    id: "demo",
    label: "Demo dashboard state",
    detail: "Sample data from the public demo dashboard.",
    match: (key) => key === "tera-demo-v1",
  },
  {
    id: "site",
    label: "Site preferences",
    detail: "Language choice and the intro screen flag.",
    match: (key) => key === "tera-locale" || key === "tera-preloader-v1",
  },
];

const OTHER = {
  id: "other",
  label: "Other Tera storage",
  detail: "A key this site wrote that this list does not describe. It is removed too.",
};

export function categoryFor(key) {
  return CATEGORIES.find((category) => category.match(key)) || OTHER;
}

/** Every key this site owns, across the storages given. */
export function findArtefacts(storages) {
  const found = [];
  for (const [index, storage] of storages.entries()) {
    let keys;
    try {
      keys = Object.keys(storage);
    } catch {
      continue;
    }
    for (const key of keys) if (key.startsWith(PREFIX)) found.push({ storage: index, key });
  }
  return found;
}

/** Distinct accounts represented, counted without keeping any address. */
export function accountsIn(artefacts) {
  const seen = new Set();
  for (const { key } of artefacts) {
    const address = key.match(/0x[\da-f]{40}/i);
    if (address) seen.add(address[0].toLowerCase());
  }
  return seen.size;
}

/**
 * What a wipe would remove. Safe to show: counts and labels only, no key names
 * and no addresses, because a key name carries the owner's address.
 */
export function plan(storages) {
  const artefacts = findArtefacts(storages);
  const counts = new Map();
  for (const { key } of artefacts) {
    const category = categoryFor(key);
    const entry = counts.get(category.id) || { ...category, count: 0 };
    entry.count += 1;
    counts.set(category.id, entry);
  }
  return {
    total: artefacts.length,
    accounts: accountsIn(artefacts),
    categories: [...counts.values()].map(({ id, label, detail, count }) => ({
      id,
      label,
      detail,
      count,
    })),
  };
}

/**
 * Remove everything, then look again and report what is left. The second scan
 * is the point: the control claims the browser is clear, so it checks rather
 * than assuming the removals worked.
 */
export function wipe(storages) {
  const before = plan(storages);
  for (const { storage, key } of findArtefacts(storages)) {
    try {
      storages[storage].removeItem(key);
    } catch {
      /* A storage that refuses removal is reported by the rescan below. */
    }
  }
  const after = findArtefacts(storages);
  return { removed: before.total - after.length, remaining: after.length, plan: before };
}

/**
 * Cache storage this site owns. The on-device model's weights live here rather
 * than in `localStorage`, so the prefix scan above cannot see them and a wipe
 * that ignored them would leave 168MB of this site's data on the disk while
 * reporting the browser clear.
 *
 * transformers.js names its cache; the second entry is this wallet's own, kept
 * so a future cache added here is removed without anyone having to remember to
 * come back and update this list.
 */
export const CACHES = ["transformers-cache", "tera-model-v1"];

/**
 * Remove the cached model. Separate from `wipe` because the Cache API is async
 * and `wipe` is not: making the whole control async to reach one extra store
 * would have slowed the path that matters most when it is used in a hurry.
 */
export async function wipeCaches(cacheStorage) {
  if (!cacheStorage) return { removed: 0, remaining: 0 };
  let removed = 0;
  for (const name of CACHES) {
    try {
      if (await cacheStorage.delete(name)) removed += 1;
    } catch {
      /* Counted as remaining by the rescan below. */
    }
  }
  let remaining = 0;
  try {
    const left = await cacheStorage.keys();
    remaining = left.filter((name) => CACHES.includes(name)).length;
  } catch {
    /* A storage that will not list is reported as nothing remaining, which the
       caller shows alongside the localStorage rescan rather than on its own. */
  }
  return { removed, remaining };
}

// What a wipe cannot reach. Shown next to the control, because a wipe that
// implies more than it does is worse than no wipe at all.
export const LIMITS = [
  "Records Tera already holds. Deleting those is a separate control, it needs a wallet signature, and it makes a network call.",
  "Your wallet extension, its accounts and its own history.",
  "Files you downloaded: vault exports, recovery files, exported logs and shared proposals.",
  "Recovery shares you gave to other people. They still hold them.",
  "Anything already on the chain, which is public and permanent.",
  "The fact that a wipe happened. This does not disguise itself.",
  "Deleted browser storage can sometimes still be recovered from the disk. This clears the browser's copy, not the drive.",
];
