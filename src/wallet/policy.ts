import { recoverMessageAddress } from "viem";

export async function verifyPolicyBundle(bundle: {
  version?: number;
  issuedAt?: string;
  expiresAt?: string;
  rulesHash?: `0x${string}`;
  signature?: `0x${string}`;
  signer?: `0x${string}`;
}, expectedSigner: `0x${string}`) {
  if (!bundle.signature || !bundle.signer || !bundle.rulesHash || !bundle.issuedAt || !bundle.expiresAt)
    return false;
  const message = `${bundle.version}:${bundle.issuedAt}:${bundle.expiresAt}:${bundle.rulesHash}`;
  const recovered = await recoverMessageAddress({ message, signature: bundle.signature });
  return recovered.toLowerCase() === expectedSigner.toLowerCase() && recovered.toLowerCase() === bundle.signer.toLowerCase();
}
