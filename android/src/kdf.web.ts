// PBKDF2 in the browser, through WebCrypto.
//
// A phone keeps the sealed wallet in the OS keychain, which a copied file does
// not unlock. A browser has no such thing: the sealed wallet sits in this
// site's storage, and anyone who copies it can guess PINs offline for as long
// as they like. The round count is the only thing that slows that down, so the
// web gets OWASP's figure for PBKDF2-SHA256 rather than the phone's. WebCrypto
// runs it natively, so unlocking still takes a fraction of a second.
//
// A stored wallet records its own count (`kdf` on the envelope), so this number
// only decides what new wallets get.
export const PASSWORD_ITERATIONS = 600000;

export const passwordKey = async (
  password: string,
  salt: Uint8Array,
  iterations = PASSWORD_ITERATIONS,
) => {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password.normalize("NFKD")),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    material,
    256,
  );
  return new Uint8Array(bits);
};
