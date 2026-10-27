// Handing a new wallet from the web wallet to Tera for Chrome.
//
// The extension's welcome tab makes a one-time key pair and opens the web
// wallet at
//
//   /app/#tera-extension=<extension id>.<public key>.<session>
//
// The owner creates a wallet there and backs it up as usual. The web wallet
// then seals the recovery phrase to that public key and gives it to the
// extension with chrome.runtime.sendMessage, which Chrome only allows from
// the sites the extension lists (externally_connectable: terawallet.app).
// Only the welcome tab that made the key holds its private half, never
// extractable, and only for as long as the tab is open, so the phrase can
// be opened by nothing else: not the site, not another tab, not Tera's
// servers, which never see any of this.
//
// The sealing is ECDH on P-256 with a fresh key on the web side, HKDF-SHA256
// salted with the session, and AES-256-GCM over the phrase, with both public
// keys as additional data. All WebCrypto, which every browser that can run
// the extension has.

const INFO = new TextEncoder().encode("Tera extension handoff v1");
export const HASH_KEY = "tera-extension";
const EXTENSION_ID = /^[a-p]{32}$/;
const SESSION_BYTES = 16;

/** Bytes on a plain ArrayBuffer, as WebCrypto takes them. */
type Bytes = Uint8Array<ArrayBuffer>;

export type Invite = { extension: string; publicKey: Bytes; session: Bytes };
export type Sealed = { v: 1; session: string; epk: string; nonce: string; data: string };

const b64url = (bytes: Bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

function unb64url(text: string) {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("Not base64url.");
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")), (c) =>
    c.charCodeAt(0),
  );
}

const subtle = () => globalThis.crypto.subtle;
const P256 = { name: "ECDH", namedCurve: "P-256" } as const;

/** A P-256 public key as WebCrypto exports it: 65 bytes, starting 0x04. */
const isPoint = (bytes: Bytes) => bytes.length === 65 && bytes[0] === 4;

/** The invite in a URL fragment, checked; null when there isn't one or it's malformed. */
export function parseInvite(hash: string | null | undefined): Invite | null {
  const match = String(hash ?? "").match(new RegExp(`^#?${HASH_KEY}=([^&]+)$`));
  if (!match) return null;
  const [extension, publicKey, session] = match[1].split(".");
  if (!EXTENSION_ID.test(extension ?? "")) return null;
  try {
    const point = unb64url(publicKey ?? "");
    const id = unb64url(session ?? "");
    if (!isPoint(point) || id.length !== SESSION_BYTES) return null;
    return { extension, publicKey: point, session: id };
  } catch {
    return null;
  }
}

/** The fragment for an invite: what the extension appends to the web wallet's address. */
export const inviteHash = (invite: Invite) =>
  `#${HASH_KEY}=${invite.extension}.${b64url(invite.publicKey)}.${b64url(invite.session)}`;

/** The extension's side: a fresh key pair and session. The private key can't be exported. */
export async function makeInvite(extension: string) {
  const pair = (await subtle().generateKey(P256, false, ["deriveBits"])) as CryptoKeyPair;
  const publicKey = new Uint8Array(await subtle().exportKey("raw", pair.publicKey));
  const session = crypto.getRandomValues(new Uint8Array(SESSION_BYTES));
  return { invite: { extension, publicKey, session } as Invite, privateKey: pair.privateKey };
}

async function sharedKey(privateKey: CryptoKey, peer: Bytes, session: Bytes) {
  const theirs = await subtle().importKey("raw", peer, P256, false, []);
  const bits = await subtle().deriveBits({ name: "ECDH", public: theirs }, privateKey, 256);
  const material = await subtle().importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: session, info: INFO },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

const joined = (a: Bytes, b: Bytes): Bytes => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
};

/** The web wallet's side: the phrase, sealed so only the invite's holder can open it. */
export async function sealFor(invite: Invite, secret: string): Promise<Sealed> {
  const pair = (await subtle().generateKey(P256, true, ["deriveBits"])) as CryptoKeyPair;
  const epk = new Uint8Array(await subtle().exportKey("raw", pair.publicKey));
  const key = await sharedKey(pair.privateKey, invite.publicKey, invite.session);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const data = await subtle().encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: joined(epk, invite.publicKey) },
    key,
    new TextEncoder().encode(secret),
  );
  return {
    v: 1,
    session: b64url(invite.session),
    epk: b64url(epk),
    nonce: b64url(nonce),
    data: b64url(new Uint8Array(data)),
  };
}

/** Whether a message has the shape of a sealed handoff (the background worker checks before keeping one). */
export function isSealed(value: unknown): value is Sealed {
  const v = value as Sealed;
  return (
    !!v &&
    v.v === 1 &&
    [v.session, v.epk, v.nonce, v.data].every(
      (part) => typeof part === "string" && /^[A-Za-z0-9_-]+$/.test(part),
    ) &&
    v.data.length <= 4096
  );
}

/** The extension's side again: the secret, or a thrown error if anything doesn't match. */
export async function openSealed(sealed: Sealed, invite: Invite, privateKey: CryptoKey) {
  if (!isSealed(sealed) || sealed.session !== b64url(invite.session))
    throw new Error("This wallet was meant for another setup. Start again.");
  const epk = unb64url(sealed.epk);
  if (!isPoint(epk)) throw new Error("This wallet couldn't be opened. Start again.");
  const key = await sharedKey(privateKey, epk, invite.session);
  try {
    const plain = await subtle().decrypt(
      {
        name: "AES-GCM",
        iv: unb64url(sealed.nonce),
        additionalData: joined(epk, invite.publicKey),
      },
      key,
      unb64url(sealed.data),
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error("This wallet couldn't be opened. Start again.");
  }
}

/** The session's text form, as the background worker matches it. */
export const sessionId = (invite: Invite) => b64url(invite.session);
