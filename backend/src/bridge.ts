import { isAddress } from "viem";
import { env } from "./env";

export const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
export const DEPOSITORY = "0x4cd00e387622c35bddb9b4c962c136462338bc31";
export const NATIVE = "0x0000000000000000000000000000000000000000";
export const sourceAssets = [
  { currency: USDG, symbol: "USDG", decimals: 6, native: false },
  { currency: NATIVE, symbol: "ETH", decimals: 18, native: true },
];
export const destinations = [
  { id: 8453, name: "Base", currency: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", tokens: [{ currency: NATIVE, symbol: "ETH", decimals: 18, native: true }, { currency: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", decimals: 6, native: false }] },
  { id: 5042, name: "Arc", currency: "0x3600000000000000000000000000000000000000", tokens: [{ currency: "0x3600000000000000000000000000000000000000", symbol: "USDC", decimals: 6, native: false }] },
  { id: 792703809, name: "Solana", currency: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", tokens: [{ currency: "11111111111111111111111111111111", symbol: "SOL", decimals: 9, native: true }, { currency: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6, native: false }, { currency: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", symbol: "USDT", decimals: 6, native: false }] },
];
export function validRecipient(chain: number, address: unknown): address is string {
  if (typeof address !== "string") return false;
  if (chain === 8453 || chain === 5042) return isAddress(address, { strict: false }) && !/^0x0{40}$/i.test(address);
  if (chain !== 792703809 || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return false;
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const c of address) n = n * 58n + BigInt(alphabet.indexOf(c));
  const bytes = n ? Math.ceil(n.toString(16).length / 2) : 0;
  return bytes + (address.match(/^1*/)?.[0].length ?? 0) === 32 && n !== 0n;
}
export function bridgeInput(body: any) {
  const destination = destinations.find(d => d.id === body?.destinationChainId);
  const source = sourceAssets.find(a => same(a.currency, body?.originCurrency ?? USDG));
  const token = destination?.tokens.find(t => same(t.currency, body?.destinationCurrency ?? destination.currency));
  if (!destination || !token || !validRecipient(destination.id, body.recipient)) throw new Error("Enter a valid destination token and wallet address.");
  if (!source) throw new Error("Unsupported source asset.");
  if (!isAddress(body.ownerAddress ?? "", { strict: false })) throw new Error("Connect a valid Robinhood Chain wallet.");
  if (typeof body.amount !== "string" || !/^[0-9]{1,24}$/.test(body.amount) || BigInt(body.amount) <= 0n)
    throw new Error("Enter a positive USDG amount in base units.");
  return { ownerAddress: body.ownerAddress as string, recipient: body.recipient as string, amount: body.amount as string, originCurrency: source.currency, source, destinationChainId: destination.id, destination: { ...token, chainId: destination.id, name: destination.name } };
}
export async function relay(path: string, body?: unknown) {
  const response = await fetch(`https://api.relay.link${path}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", ...(env.relayApiKey ? { "x-api-key": env.relayApiKey } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(18000),
  });
  if (!response.ok) throw new Error("Relay cannot provide this route right now. Try another amount or retry later.");
  return response.json() as Promise<any>;
}
const same = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();
// Only support direct USDG deposits, with exact approvals. Unknown Relay flows
// must be reviewed and implemented explicitly instead of passed through to wallets.
export function validateQuote(raw: any, input: ReturnType<typeof bridgeInput>, startedAt: number) {
  const d = raw.details;
  if (!/^0x[\da-f]{64}$/i.test(raw.requestId ?? "") || !d ||
      !same(d.sender, input.ownerAddress) || !(input.destinationChainId === 8453 ? same(d.recipient, input.recipient) : d.recipient === input.recipient) ||
      d.currencyIn?.currency?.chainId !== 4663 || !same(d.currencyIn.currency.address, input.originCurrency) ||
      d.currencyIn.amount !== input.amount || d.currencyOut?.currency?.chainId !== input.destinationChainId ||
      !same(d.currencyOut.currency.address, input.destination.currency))
    throw new Error("Relay quote does not match the requested bridge.");
  const out = d.currencyOut;
  if (!/^[0-9]+$/.test(out.amount) || !/^[0-9]+$/.test(out.minimumAmount) ||
      BigInt(out.minimumAmount) <= 0n || BigInt(out.amount) < BigInt(out.minimumAmount) ||
      BigInt(out.minimumAmount) < BigInt(out.amount) * 9950n / 10000n)
    throw new Error("Relay quote exceeds the 0.5% slippage limit.");
  const steps: { id: string; to: string; data: string; value: string; chainId: number }[] = [];
  for (const step of raw.steps ?? []) {
    if (step.kind !== "transaction" || !["approve", "deposit"].includes(step.id) || step.items?.length !== 1)
      throw new Error("This Relay signing flow is not supported yet.");
    const tx = step.items[0].data;
    if (!tx || tx.chainId !== 4663 || !same(tx.from, input.ownerAddress))
      throw new Error("Unexpected Relay transaction network, sender, or value.");
    const data = String(tx.data).toLowerCase();
    const addressWord = (s: string) => s.slice(2).toLowerCase().padStart(64, "0");
    const amountWord = BigInt(input.amount).toString(16).padStart(64, "0");
    if (step.id === "approve") {
      if (input.source.native || BigInt(tx.value) !== 0n || !same(tx.to, input.originCurrency) || data !== `0x095ea7b3${addressWord(DEPOSITORY)}${amountWord}`)
        throw new Error("Relay approval does not match the exact USDG amount and deposit contract.");
    } else {
      const nativeData = `0x49290c1c${addressWord(input.ownerAddress)}`;
      const tokenData = `0xe8017952${addressWord(input.ownerAddress)}${addressWord(input.originCurrency)}${amountWord}`;
      if (!same(tx.to, DEPOSITORY) || (input.source.native ? (!/^0x49290c1c[\da-f]{128}$/.test(data) || data.slice(0, 74) !== nativeData || BigInt(tx.value) !== BigInt(input.amount)) : (BigInt(tx.value) !== 0n || data.slice(0, 202) !== tokenData)))
        throw new Error("Relay deposit does not match the reviewed USDG input.");
    }
    steps.push({ id: step.id, to: tx.to, data, value: "0x0", chainId: 4663 });
  }
  if (steps.map(s => s.id).join(",") !== "approve,deposit" && steps.map(s => s.id).join(",") !== "deposit")
    throw new Error("Relay returned an incomplete deposit flow.");
  return { requestId: raw.requestId, input, amountOut: out.amount, minimumAmountOut: out.minimumAmount,
    fees: raw.fees, timeEstimate: d.timeEstimate, steps, expiresAt: startedAt + 120000 };
}
