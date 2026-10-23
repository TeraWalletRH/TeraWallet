// Bearer links: the fragment is spending authority. Never send it to an API,
// analytics, a remote QR renderer, or include it in an Activity snapshot.
export const CHAIN_ID = 4663;
const ORDER = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
export function claimKey(input) {
  if (typeof input !== "string" || !/^0x[\da-f]{64}$/i.test(input)) return null;
  const value = BigInt(input);
  return value > 0n && value < ORDER ? input.toLowerCase() : null;
}
export function claimUrl(key) {
  const valid = claimKey(key);
  if (!valid) throw new Error("Invalid claim link.");
  return `https://terawallet.app/app/#claim=1:${CHAIN_ID}:${valid.slice(2)}`;
}
export function parseClaim(input) {
  try {
    const url = new URL(String(input));
    const web = url.protocol === "https:" && url.hostname === "terawallet.app" && /^\/app\/?$/.test(url.pathname) && !url.port;
    const native = url.protocol === "terawallet:" && url.hostname === "claim";
    if ((!web && !native) || url.username || url.password || url.search) return null;
    const match = /^#claim=1:4663:([\da-f]{64})$/i.exec(url.hash);
    return match ? claimKey(`0x${match[1]}`) : null;
  } catch { return null; }
}
// A reserve above today's estimate covers fee changes between review and sign.
// Execution still simulates and enforces the wallet's per-step fee ceiling.
export function claimAmount(balance, gas, maxFeePerGas) {
  const reserve = BigInt(gas) * BigInt(maxFeePerGas) * 2n;
  if (BigInt(gas) <= 0n || BigInt(maxFeePerGas) <= 0n || reserve > 1000000000000000n)
    throw new Error("Claim fee exceeds the 0.001 ETH limit.");
  const amount = BigInt(balance) - reserve;
  if (amount <= 0n) throw new Error("This link has no claimable ETH. It may be unfunded, already claimed, or too small to cover the fee.");
  return { amount, reserve };
}
export function checkClaimTx(steps, recipient) {
  const tx = steps?.[0];
  if (steps?.length !== 1 || tx?.chainId !== CHAIN_ID || tx.data !== "0x" ||
      !/^0x[\da-f]{40}$/i.test(recipient) || /^0x0{40}$/i.test(recipient) ||
      tx.to?.toLowerCase() !== recipient.toLowerCase() || !/^\d+$/.test(String(tx.value)) || BigInt(tx.value) <= 0n)
    throw new Error("Claim does not match the receiving wallet.");
}
