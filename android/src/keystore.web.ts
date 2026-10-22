// Where the sealed wallet and its data file live in a browser.
//
// This site's own storage, on this device. Nothing here is sent anywhere, and
// nothing here is readable without the PIN: the wallet is sealed before it
// reaches this file, exactly as on a phone. What a browser lacks is a keychain
// guarding that sealed copy, which is why kdf.web.ts spends more rounds.
//
// Passkeys stand in for the phone's biometrics (update 9). A browser has no
// keychain that releases a key after Face ID, but a passkey with the PRF
// extension gives a secret only that passkey can produce, after the owner's
// face, fingerprint or device PIN. That secret seals what the phone would put
// behind biometrics (the PIN-derived key), so the copy in this site's storage
// is useless without the passkey, exactly as the phone's is without the owner.
// A passkey or password manager without PRF can't do this, and the PIN stays
// the only way in: there is no fallback that merely asks "is it you?".

// Two vaults can live side by side: the personal wallet, and a Tera Business
// wallet with its own secret, PIN and data. Only one is open at a time, and
// which one was last used is remembered so a reload opens the same door.
// Personal keeps the original prefix, so a wallet created before business
// mode existed is exactly where it always was.
export type VaultKind = "personal" | "business";
const MODE = "tera.web.mode";
const prefixes: Record<VaultKind, string> = {
  personal: "tera.web.",
  business: "tera.web.business.",
};
let kind: VaultKind = "personal";
try {
  if (localStorage.getItem(MODE) === "business") kind = "business";
} catch {
  // Storage blocked: open the personal vault, as before business mode existed.
}
let PREFIX = prefixes[kind];

export const vaultKind = () => kind;

/** Point every read and write below at the other vault. Lock the wallet first. */
export function useVault(next: VaultKind) {
  kind = next;
  PREFIX = prefixes[next];
  try {
    localStorage.setItem(MODE, next);
  } catch {
    // Not remembered across a reload, which only means the next visit opens personal.
  }
}

// Ask once for storage the browser will not clear to make room. An installed
// app usually gets it; a tab may not, and the recovery phrase is the answer then.
try {
  void navigator.storage?.persist?.();
} catch {}

/** Whether this browser can make passkeys at all; biometricsReady says whether this device can. */
export const biometricsSupported =
  typeof window !== "undefined" &&
  window.isSecureContext === true &&
  typeof window.PublicKeyCredential === "function" &&
  !!navigator.credentials;

export async function biometricsReady() {
  if (!biometricsSupported) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

// What a passkey-sealed value looks like in storage.
type Bytes = Uint8Array<ArrayBuffer>;
type Sealed = { passkey: 1; id: string; salt: string; iv: string; box: string };
const INFO = new TextEncoder().encode("tera.web.passkey.v1");
const b64 = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes as ArrayBuffer)));
const unb64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const sealedFrom = (raw: string | null): Sealed | null => {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.passkey === 1 ? parsed : null;
  } catch {
    return null;
  }
};

/** The AES key a passkey's PRF output opens, never stored. */
async function keyFrom(prf: ArrayBuffer) {
  const base = await crypto.subtle.importKey("raw", prf, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: INFO },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

const NO_PRF =
  "This browser or password manager can't keep a key with a passkey, so the PIN stays the way in. Chrome, Edge and Safari 18 with this device's own passkeys can. / 此浏览器或密码管理器无法用通行密钥保管密钥，请继续使用 PIN。";
const CANCELLED =
  "The passkey was cancelled, or isn't on this device. Use your PIN instead. / 通行密钥已取消或不在此设备上，请改用 PIN。";

/** The owner's passkey, asked for the PRF secret of `salt`. */
async function prfFor(id: Bytes, salt: Bytes) {
  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: "public-key", id }],
        userVerification: "required",
        timeout: 120_000,
        extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
  } catch (e) {
    throw new Error(e instanceof DOMException && e.name === "NotAllowedError" ? CANCELLED : NO_PRF);
  }
  const first = (credential?.getClientExtensionResults() as any)?.prf?.results?.first;
  if (!first) throw new Error(NO_PRF);
  return first as ArrayBuffer;
}

// A passkey made but not yet used to seal anything: Safari won't run a second
// passkey prompt without a fresh tap, so the next secureSet picks it up
// instead of making another.
let made: { key: string; id: Bytes } | null = null;

/** Make a passkey for this wallet and return its id and, when given at creation, its PRF secret. */
async function makePasskey(salt: Bytes) {
  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.create({
      publicKey: {
        rp: { name: "Tera Wallet" },
        user: {
          id: crypto.getRandomValues(new Uint8Array(16)),
          name: kind === "business" ? "Tera Wallet (business)" : "Tera Wallet",
          displayName: kind === "business" ? "Tera Wallet (business)" : "Tera Wallet",
        },
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
        timeout: 120_000,
        extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
  } catch (e) {
    throw new Error(e instanceof DOMException && e.name === "NotAllowedError" ? CANCELLED : NO_PRF);
  }
  if (!credential) throw new Error(CANCELLED);
  const prf = (credential.getClientExtensionResults() as any)?.prf;
  if (!prf?.enabled && !prf?.results?.first) throw new Error(NO_PRF);
  return {
    id: new Uint8Array(credential.rawId),
    first: prf.results?.first as ArrayBuffer | undefined,
  };
}

/** `prompt` means behind a passkey: the read and the write each ask for it. */
export async function secureGet(key: string, prompt?: string) {
  const raw = localStorage.getItem(PREFIX + key);
  if (!prompt) return raw;
  const sealed = sealedFrom(raw);
  if (!sealed) return null;
  const prf = await prfFor(unb64(sealed.id), unb64(sealed.salt));
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(sealed.iv) },
    await keyFrom(prf),
    unb64(sealed.box),
  );
  return new TextDecoder().decode(plain);
}

export async function secureSet(key: string, value: string, prompt?: string) {
  if (!prompt) {
    localStorage.setItem(PREFIX + key, value);
    return;
  }
  if (!biometricsSupported) throw new Error(NO_PRF);
  const salt = crypto.getRandomValues(new Uint8Array(32));
  let id: Bytes;
  let prf: ArrayBuffer | undefined;
  if (made?.key === PREFIX + key) id = made.id;
  else {
    const created = await makePasskey(salt);
    id = created.id;
    prf = created.first;
    made = { key: PREFIX + key, id };
  }
  if (!prf) {
    try {
      prf = await prfFor(id, salt);
    } catch (e) {
      if (e instanceof Error && e.message === CANCELLED)
        throw new Error(
          "Your passkey is made. Tap once more to finish. / 通行密钥已创建，请再点一次完成。",
        );
      throw e;
    }
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const box = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await keyFrom(prf),
    new TextEncoder().encode(value),
  );
  const sealed: Sealed = { passkey: 1, id: b64(id), salt: b64(salt), iv: b64(iv), box: b64(box) };
  localStorage.setItem(PREFIX + key, JSON.stringify(sealed));
  made = null;
}

/** Whether `key` holds a value behind a passkey on this device. */
export async function hasProtected(key: string) {
  return !!sealedFrom(localStorage.getItem(PREFIX + key));
}

export async function secureDelete(key: string) {
  localStorage.removeItem(PREFIX + key);
}

export async function readFile(name: string) {
  return localStorage.getItem(`${PREFIX}file.${name}`);
}

export async function writeFile(name: string, text: string) {
  localStorage.setItem(`${PREFIX}file.${name}`, text);
}

export async function deleteFile(name: string) {
  localStorage.removeItem(`${PREFIX}file.${name}`);
}
