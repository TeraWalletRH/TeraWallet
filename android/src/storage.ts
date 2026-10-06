import * as Crypto from "expo-crypto";
import * as store from "./keystore";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import {
  dataKey,
  LEGACY_PASSWORD_ITERATIONS,
  MAX_ACCOUNT_INDEX,
  normalizePhrase,
  normalizePrivateKey,
  PASSWORD_ITERATIONS,
  open,
  passwordKey,
  phraseFromEntropy,
  seal,
  walletFromPhrase,
  walletFromSecret,
  type Box,
} from "./crypto";
import type { Asset } from "./config";
const WALLET = "tera.wallet.v1";
const BIOMETRIC = "tera.wallet.biometric.v1";
export const biometricsSupported = store.biometricsSupported;
/**
 * `accounts` and `selected` are optional, and their absence is what every wallet
 * created before this feature looks like. A missing list reads as `[0]` and a
 * missing selection as `0`, so an existing wallet unlocks to exactly the account
 * it always had. There is no migration step, nothing is rewritten on upgrade,
 * and a downgrade to an older build still finds the envelope it expects —
 * `address` remains the index-0 address and remains what `unlock` checks against.
 */
type Envelope = {
  v: 1;
  address: string;
  salt: string;
  box: Box;
  kdf?: number;
  pin?: true;
  accounts?: number[];
  selected?: number;
  /**
   * What the owner called each account, by index. Optional and usually sparse:
   * an account with no entry is shown as "Wallet 2" rather than being given a
   * stored name it never asked for.
   */
  names?: Record<string, string>;
};
export type LocalData = {
  drafts: any[];
  history: any[];
  token: string;
  retention: number;
  language: "en" | "zh";
  theme: "light" | "dark";
  /** Auto lock timer in minutes (0 for disabled/never, defaults to 15). */
  autoLockMinutes?: number;
  /** Whether transfers are restricted to saved contacts only. */
  trustedOnlyMode?: boolean;
  /** Preferred fiat display currency. */
  fiatCurrency?: "USD" | "EUR" | "GBP" | "JPY" | "CAD" | "AUD";
  /** Active price alerts set by the user. */
  priceAlerts?: any[];
  /**
   * Names the owner gave addresses they send to. Sealed with the rest of this
   * file and never sent anywhere; `core/contacts.js` cleans it on every read.
   * Not trimmed by the retention window — a name is not a record of activity.
   */
  contacts: { address: string; name: string; savedAt: number }[];
  /**
   * The owner's notes on transactions, by lowercase hash. Sealed with the rest
   * of this file and never sent anywhere; `core/notes.js` cleans them.
   */
  notes?: Record<string, string>;
  /**
   * Recurring payments the owner set up. Sealed with the rest of this file and
   * never sent anywhere; `core/schedules.js` cleans them on every read. Not
   * trimmed by the retention window — a schedule is a plan, not a record.
   */
  schedules?: any[];
  /**
   * Wallets the owner watches without a key. Sealed with the rest of this
   * file and never sent anywhere; `core/watched.js` cleans them on every read.
   */
  watched?: { address: string; name: string; tag: string; addedAt: number }[];
  /** Whether the spotlight walkthrough has run on this device already. */
  tourSeen: boolean;
  /**
   * What the screen shows and what it holds back. Display only — neither
   * setting changes a balance, a total, a report or anything that gets
   * signed. core/discretion.js holds the rules, including the one that keeps
   * privacy mode away from the figure an owner is authorising.
   */
  hideSmall?: boolean;
  /** In display currency. Absent means the module's default of one dollar. */
  hideSmallThreshold?: number;
  privacy?: boolean;
  /**
   * Tokens the owner added by contract address — the app checks a balance
   * for these on every refresh alongside the built-in and registry-known
   * assets, the same way MetaMask's "import tokens" does for anything it
   * doesn't already track.
   */
  customTokens: Asset[];
  /**
   * Spending limits, in USDG base units (dollars), or null for no cap. Checked
   * by core/limits.js before a payment is reviewed and again before it is
   * signed. Absent until the owner sets one.
   */
  limits?: { perPayment: string | null; daily: string | null; monthly: string | null };
  /**
   * Transaction notifications (core/notify.js). On unless `off`. `lastSeen` is
   * the newest activity already announced, so what arrived while the app was
   * closed is announced once when it opens, and nothing older.
   */
  alerts?: {
    off?: boolean;
    lastSeen?: number;
    /** Everything announced, newest first, kept on this device only (capped). */
    items?: { hash: string; direction: "send" | "receive"; title: string; body: string; at: number }[];
    /** When the notifications page was last opened; newer items count as unread. */
    readAt?: number;
  };
};
export const emptyData = (): LocalData => ({
  drafts: [],
  history: [],
  token: "",
  retention: 30,
  language: "en",
  theme: "dark",
  contacts: [],
  customTokens: [],
  tourSeen: false,
});
// The wallet's one secret while it is unlocked: a recovery phrase, or — for a
// wallet imported from a private key — that key. Named for the common case.
let phrase: string | null = null;
let epoch = 0;
let serial: Promise<void> = Promise.resolve();
/** Read once per unlock; see notePending below for what this holds and why. */
let pendingCache: PendingSend[] | null = null;
export let authenticating = false;
// The derivation indices this wallet has, and which one is active. Both are read
// from the envelope on unlock; the defaults here are what an envelope written
// before multiple accounts existed means.
let indices: number[] = [0];
let selected = 0;
let names: Record<string, string> = {};
export const sessionVersion = () => epoch;
export const isUnlocked = () => phrase !== null;
/**
 * Whether this wallet came from a recovery phrase. A wallet imported from a
 * private key has no phrase to show and no second account to derive.
 */
export const hasPhrase = () => phrase !== null && normalizePrivateKey(phrase) === null;
export const currentAccount = () => {
  if (!phrase) throw new Error("Wallet locked. / 钱包已锁定。");
  return walletFromSecret(phrase, selected);
};
export function exportPrivateKey(index: number) {
  if (!phrase) throw new Error("Wallet locked. / 钱包已锁定。");
  if (!indices.includes(index)) throw new Error("Unknown account. / 未知账户。");
  const imported = normalizePrivateKey(phrase);
  if (imported) return { address: walletFromSecret(imported).address, privateKey: imported };
  const account = walletFromPhrase(phrase, index);
  const key = account.getHdKey().privateKey;
  if (!key) throw new Error("Private key unavailable. / 私钥不可用。");
  try {
    return { address: account.address, privateKey: `0x${bytesToHex(key)}` };
  } finally {
    key.fill(0);
  }
}
export function lock() {
  phrase = null;
  indices = [0];
  selected = 0;
  names = {};
  pendingCache = null;
  epoch++;
}

/** Clean, ascending, unique, and always containing 0. What a stored list means. */
const cleanIndices = (list: unknown): number[] => {
  const found = Array.isArray(list)
    ? list.filter(
        (value): value is number =>
          Number.isInteger(value) &&
          (value as number) >= 0 &&
          (value as number) <= MAX_ACCOUNT_INDEX,
      )
    : [];
  return [...new Set([0, ...found])].sort((a, b) => a - b);
};

export const accountIndices = () => [...indices];
export const selectedIndex = () => selected;

/**
 * Every account on this wallet, derived now rather than stored.
 *
 * Addresses are not kept in the envelope. They are a pure function of the phrase
 * and the index, so storing them would add a second copy that can disagree with
 * the first — and it would put a plaintext list of the owner's accounts in
 * SecureStore, which is the record `core/linkage.js` exists to warn them other
 * people are building.
 */
export function listAccounts() {
  if (!phrase) throw new Error("Wallet locked. / 钱包已锁定。");
  const held = phrase;
  return indices.map((index) => ({
    index,
    address: walletFromSecret(held, index).address,
    name: names[String(index)] || "",
    active: index === selected,
  }));
}

/** The longest name this will store, so the switcher stays a list of names. */
export const MAX_NAME = 40;

/**
 * Name an account, or clear the name by passing an empty string.
 *
 * Stored beside the indices rather than in the per-account data file, because
 * the switcher has to show every account's name while only one account's data
 * file is open.
 */
export async function renameAccount(index: number, name: string) {
  if (!phrase) throw new Error("Wallet locked. / 钱包已锁定。");
  if (!indices.includes(index)) throw new Error("Unknown account. / 未知账户。");
  const trimmed = name.trim().slice(0, MAX_NAME);
  const previous = names;
  const next = { ...names };
  if (trimmed) next[String(index)] = trimmed;
  else delete next[String(index)];
  names = next;
  try {
    await writeSettings({ names });
  } catch (error) {
    names = previous;
    throw error;
  }
}

/**
 * Rewrite the envelope's account fields, leaving the sealed phrase untouched.
 *
 * Which accounts exist and which is selected are not secrets about the phrase,
 * so changing them does not need the password and must not re-encrypt the box.
 * Re-sealing on every switch would mean an owner could lose their wallet to a
 * process kill in the middle of tapping an account.
 */
async function writeSettings(next: Partial<Pick<Envelope, "accounts" | "selected" | "names">>) {
  const saved = await envelope();
  await store.secureSet(WALLET, JSON.stringify({ ...saved, ...next } satisfies Envelope));
}

/** Switch to an account this wallet already has. */
export async function selectAccount(index: number) {
  if (!phrase) throw new Error("Wallet locked. / 钱包已锁定。");
  if (!indices.includes(index)) throw new Error("Unknown account. / 未知账户。");
  if (index === selected) return currentAccount().address;
  const previous = selected;
  selected = index;
  try {
    await writeSettings({ accounts: indices, selected });
  } catch (error) {
    // The switch is only real once it is stored. Leaving memory ahead of the
    // envelope would put the app on one account and the next unlock on another.
    selected = previous;
    throw error;
  }
  return currentAccount().address;
}

/**
 * Add the next account, at the lowest index not already in use.
 *
 * Lowest free rather than one past the highest, so an owner who adds accounts
 * over time gets a list any other wallet's default scan finds. A gap would leave
 * an account recoverable only by someone who knew to look past it.
 */
export async function addAccount() {
  if (!phrase) throw new Error("Wallet locked. / 钱包已锁定。");
  if (!hasPhrase())
    throw new Error(
      "A wallet imported from a private key has one account. / 由私钥导入的钱包只有一个账户。",
    );
  let next = 0;
  while (indices.includes(next)) next += 1;
  if (next > MAX_ACCOUNT_INDEX) throw new Error("This wallet is full. / 此钱包账户已满。");
  const previous = indices;
  indices = [...indices, next].sort((a, b) => a - b);
  const previousSelected = selected;
  selected = next;
  try {
    await writeSettings({ accounts: indices, selected });
  } catch (error) {
    indices = previous;
    selected = previousSelected;
    throw error;
  }
  return currentAccount().address;
}
const random = (n: number) => Crypto.getRandomValues(new Uint8Array(n));
export const newPhrase = () => phraseFromEntropy(random(16));
export async function hasWallet() {
  return !!(await store.secureGet(WALLET));
}
export async function usesPin() {
  try {
    return (await envelope()).pin === true;
  } catch {
    return false;
  }
}
const assertPin = (pin: string) => {
  if (!/^\d{6}$/.test(pin)) throw new Error("Use a six-digit PIN. / 请输入六码 PIN。");
};
/** Takes a recovery phrase or a private key; the text itself says which. */
export async function createWallet(secret: string, password: string) {
  if (await hasWallet()) throw new Error("A wallet already exists. / 钱包已存在。");
  assertPin(password);
  const version = epoch;
  const normalized = normalizePrivateKey(secret) ?? normalizePhrase(secret);
  const account = walletFromSecret(normalized);
  const salt = random(16);
  const key = await passwordKey(password, salt);
  try {
    if (version !== epoch) throw new Error("Setup interrupted. / 设置已中断。");
    const envelope: Envelope = {
      v: 1,
      address: account.address,
      salt: bytesToHex(salt),
      box: seal(key, normalized, random(12)),
      kdf: PASSWORD_ITERATIONS,
      pin: true,
    };
    await store.secureSet(WALLET, JSON.stringify(envelope));
    if (version !== epoch) throw new Error("Unlock your saved wallet. / 请解锁已保存的钱包。");
    phrase = normalized;
    indices = [0];
    selected = 0;
    names = {};
    return account.address;
  } finally {
    key.fill(0);
  }
}
async function envelope(): Promise<Envelope> {
  const raw = await store.secureGet(WALLET);
  if (!raw) throw new Error("Wallet unavailable. / 钱包不可用。");
  return JSON.parse(raw);
}
async function upgradeLegacyEnvelope(
  password: string,
  saved: Envelope,
  recovered: string,
  version: number,
) {
  // Let the home screen paint before the one-time migration competes for CPU.
  await new Promise((resolve) => setTimeout(resolve, 500));
  const key = await passwordKey(password, hexToBytes(saved.salt), PASSWORD_ITERATIONS);
  try {
    if (version !== epoch || phrase !== recovered) return;
    // Re-read rather than spreading the envelope captured half a second ago. An
    // owner can add or switch an account inside that delay, and those writes
    // land on the stored envelope — spreading the stale copy would quietly undo
    // them. The salt is checked because a changed one means the password this
    // key was derived from is no longer the wallet's, and writing the box then
    // would lock the owner out of their own phrase.
    const current = await envelope();
    if (current.salt !== saved.salt || current.kdf) return;
    await store.secureSet(
      WALLET,
      JSON.stringify({
        ...current,
        kdf: PASSWORD_ITERATIONS,
        box: seal(key, recovered, random(12)),
      }),
    );
  } finally {
    key.fill(0);
  }
}
export async function unlock(password: string | null) {
  const version = epoch;
  const saved = await envelope();
  let key: Uint8Array | undefined;
  try {
    if (password === null) {
      authenticating = true;
      const value = await store.secureGet(BIOMETRIC, "Unlock Tera Wallet / 解锁 Tera 钱包");
      if (!value) throw new Error("Use your wallet password. / 请使用钱包密码。");
      key = hexToBytes(value);
    } else {
      if (saved.pin) assertPin(password);
      key = await passwordKey(
        password,
        hexToBytes(saved.salt),
        saved.kdf ?? LEGACY_PASSWORD_ITERATIONS,
      );
    }
    const recovered = open(key, saved.box);
    // Checked at index 0 whatever account is selected. `saved.address` is the
    // first account and always has been, so it stays the fixed point that says
    // this envelope still holds the phrase it claims to.
    const account = walletFromSecret(recovered);
    if (account.address !== saved.address || version !== epoch)
      throw new Error("Wallet changed. / 钱包已更改。");
    phrase = recovered;
    indices = cleanIndices(saved.accounts);
    // A selection naming an account that is not in the list is not a reason to
    // refuse the unlock — it is a reason to open on the first account, which is
    // the one that certainly exists.
    selected = indices.includes(saved.selected as number) ? (saved.selected as number) : 0;
    names =
      saved.names && typeof saved.names === "object" ? (saved.names as Record<string, string>) : {};
    if (password !== null && !saved.kdf)
      void upgradeLegacyEnvelope(password, saved, recovered, version).catch(() => {});
    // The account the owner was last on, not index 0. Opening somewhere other
    // than where they left off would be its own kind of surprise, and on a
    // wallet with one account these are the same address anyway.
    return currentAccount().address;
  } catch {
    throw new Error(
      "Could not unlock. Check your password or use phrase recovery. / 无法解锁，请检查密码或使用助记词恢复。",
    );
  } finally {
    key?.fill(0);
    authenticating = false;
  }
}
export async function migrateToPin(currentPassword: string, pin: string) {
  assertPin(pin);
  await unlock(currentPassword);
  const recovered = phrase!;
  const salt = random(16);
  const key = await passwordKey(pin, salt, PASSWORD_ITERATIONS);
  try {
    await store.secureSet(
      WALLET,
      JSON.stringify({
        v: 1,
        // Index 0, not the selected account. This field is what `unlock` checks
        // the decrypted phrase against, so writing the active account's address
        // here would make the wallet refuse to open the moment an owner migrated
        // to a PIN while on their second account.
        address: walletFromSecret(recovered).address,
        salt: bytesToHex(salt),
        box: seal(key, recovered, random(12)),
        kdf: PASSWORD_ITERATIONS,
        pin: true,
        // Carried across explicitly. This envelope is built from scratch rather
        // than spread from the saved one, so anything not named here is dropped
        // — and dropping these would silently take an owner's accounts away.
        accounts: indices,
        selected,
        names,
      } satisfies Envelope),
    );
  } finally {
    key.fill(0);
  }
}
export async function enableBiometrics(password: string) {
  if (!(await store.biometricsReady()))
    throw new Error("Set up device biometrics first. / 请先设置设备生物识别。");
  await unlock(password);
  const saved = await envelope();
  const key = await passwordKey(password, hexToBytes(saved.salt));
  try {
    authenticating = true;
    await store.secureSet(
      BIOMETRIC,
      bytesToHex(key),
      "Enable Tera biometric unlock / 启用生物识别解锁",
    );
  } finally {
    key.fill(0);
    authenticating = false;
  }
}
export const revealPhrase = () => {
  currentAccount();
  if (!hasPhrase())
    throw new Error(
      "This wallet was imported from a private key and has no recovery phrase. / 此钱包由私钥导入，没有助记词。",
    );
  return phrase!;
};
const dataFile = (address: string) => `tera-${address.toLowerCase()}.json`;
export async function loadData(): Promise<LocalData> {
  const address = currentAccount().address;
  const key = dataKey(phrase!);
  try {
    const raw = await store.readFile(dataFile(address));
    // A wallet with nothing saved yet still reaches the end of this function,
    // because the first send is precisely when there is no file — and it is
    // the send most worth recovering.
    const saved = raw === null ? {} : JSON.parse(open(key, JSON.parse(raw)));
    const data: LocalData = { ...emptyData(), ...saved };
    const cutoff = Date.now() - data.retention * 86400000;
    data.drafts = data.drafts.filter((d) => d.createdAt > cutoff);
    data.history = data.history.filter(
      (d) =>
        d.createdAt > cutoff ||
        !["confirmed", "success", "refund", "reverted", "failure"].includes(d.status),
    );
    // A send that was interrupted between the broadcast and the write of its
    // history row left its hash in the pending file and nothing else. Put it
    // back, so the owner sees a transaction they may well have made rather
    // than nothing at all. It carries no title or amount because the wallet
    // genuinely does not know them any more, and inventing either would be
    // describing a payment it cannot actually account for.
    for (const row of await pendingSends()) {
      if (row.owner.toLowerCase() !== address.toLowerCase()) continue;
      if (data.history.some((entry) => entry.hash === row.hash)) continue;
      data.history = [
        {
          hash: row.hash,
          status: "broadcasting",
          step: row.step,
          totalSteps: row.totalSteps,
          createdAt: row.createdAt,
          recovered: true,
        },
        ...data.history,
      ];
    }
    return data;
  } finally {
    key.fill(0);
  }
}
export function saveData(data: LocalData) {
  const address = currentAccount().address;
  const version = epoch;
  const key = dataKey(phrase!);
  const snapshot = JSON.stringify(seal(key, JSON.stringify(data), random(12)));
  key.fill(0);
  const work = serial
    .catch(() => {})
    .then(async () => {
      if (version !== epoch) throw new Error("Wallet locked before saving. / 保存前钱包已锁定。");
      await store.writeFile(dataFile(address), snapshot);
    });
  serial = work;
  return work;
}
/**
 * A small named record sealed with this wallet's data key, shared by all its
 * accounts rather than kept per account. Tera Business keeps its watch-only
 * addresses, account groups and report labels here — lists of addresses that
 * are nobody else's business, so they are sealed like everything else.
 */
const sealedFile = (name: string) =>
  `tera-${walletFromSecret(phrase!).address.toLowerCase()}.${name}.json`;
export async function loadSealed<T>(name: string): Promise<T | null> {
  currentAccount();
  const key = dataKey(phrase!);
  try {
    const raw = await store.readFile(sealedFile(name));
    return raw === null ? null : (JSON.parse(open(key, JSON.parse(raw))) as T);
  } finally {
    key.fill(0);
  }
}
export async function saveSealed(name: string, value: unknown) {
  currentAccount();
  const key = dataKey(phrase!);
  try {
    await store.writeFile(
      sealedFile(name),
      JSON.stringify(seal(key, JSON.stringify(value), random(12))),
    );
  } finally {
    key.fill(0);
  }
}
/**
 * Hashes that have been signed and are about to be broadcast.
 *
 * This is the one fact that has to reach disk before a transaction is sent. A
 * signed transaction that a node may already have accepted, whose hash the
 * wallet has forgotten, is a payment its owner cannot see, chase or account
 * for. It is kept in a small file of its own rather than in the history,
 * because writing the history means re-encrypting every transaction the wallet
 * has ever made, and that cost grows for as long as somebody keeps using the
 * app — so the longer they have used Tera, the longer they wait to send.
 *
 * Nothing deletes an entry on the way out. loadData() folds anything still
 * here into the history, and the next send drops whatever is over a day old,
 * so the crash-safe path costs one small write and never a second one.
 */
export type PendingSend = {
  hash: string;
  owner: string;
  step: number;
  totalSteps: number;
  createdAt: number;
};
const PENDING = "pending-sends";
const PENDING_KEPT_FOR = 86400000;
async function pendingSends(): Promise<PendingSend[]> {
  if (!pendingCache) pendingCache = (await loadSealed<PendingSend[]>(PENDING)) ?? [];
  return pendingCache;
}
export async function notePending(entry: PendingSend) {
  const kept = (await pendingSends()).filter(
    (row) => row.hash !== entry.hash && entry.createdAt - row.createdAt < PENDING_KEPT_FOR,
  );
  pendingCache = [entry, ...kept];
  await saveSealed(PENDING, pendingCache);
}
export async function eraseWallet() {
  const saved = await envelope();
  lock();
  await serial.catch(() => {});
  await store.deleteFile(dataFile(saved.address));
  await store.secureDelete(BIOMETRIC);
  await store.secureDelete(WALLET);
}
