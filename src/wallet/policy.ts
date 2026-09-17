import { recoverMessageAddress } from "viem";

export async function verifyPolicyBundle(
  bundle: {
    version?: number;
    issuedAt?: string;
    expiresAt?: string;
    rulesHash?: `0x${string}`;
    signature?: `0x${string}`;
    signer?: `0x${string}`;
  },
  expectedSigner: `0x${string}`,
) {
  if (
    !bundle.signature ||
    !bundle.signer ||
    !bundle.rulesHash ||
    !bundle.issuedAt ||
    !bundle.expiresAt
  )
    return false;
  const message = `${bundle.version}:${bundle.issuedAt}:${bundle.expiresAt}:${bundle.rulesHash}`;
  const recovered = await recoverMessageAddress({ message, signature: bundle.signature });
  return (
    recovered.toLowerCase() === expectedSigner.toLowerCase() &&
    recovered.toLowerCase() === bundle.signer.toLowerCase()
  );
}

/**
 * Verify a published build manifest. The expected signer must be supplied: a
 * manifest that merely carries a self-consistent signature proves only that
 * somebody signed it, which is not what the badge claims.
 */
export async function verifyBuildManifest(
  manifest: {
    release?: string;
    builtAt?: string;
    filesHash?: string;
    signer?: `0x${string}`;
    signature?: `0x${string}`;
  },
  expectedSigner: `0x${string}`,
) {
  if (!manifest?.signature || !manifest?.signer || !manifest?.filesHash || !expectedSigner)
    return false;
  const message = `Tera build manifest v1:${manifest.release}:${manifest.builtAt}:${manifest.filesHash}`;
  const recovered = await recoverMessageAddress({ message, signature: manifest.signature });
  return (
    recovered.toLowerCase() === manifest.signer.toLowerCase() &&
    recovered.toLowerCase() === expectedSigner.toLowerCase()
  );
}

/**
 * Recover the address that signed a receipt.
 *
 * Deliberately just a recovery, with no expected signer and no opinion: the
 * receipt names the address it claims, and `receipt.js` is where that claim is
 * compared and reported. Splitting it this way keeps the wallet module free of
 * any dependency and keeps this file free of any judgement.
 */
export async function recoverReceiptSigner(message: string, signature: `0x${string}`) {
  return recoverMessageAddress({ message, signature });
}
