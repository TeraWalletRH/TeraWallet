import { blockingReason, gateVerdicts, summarise } from "./core";
import {
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  isAddress,
  zeroAddress,
  type Address,
} from "viem";
import { chain, DEPOSITORY, destinations, sources, USDG, type Tx } from "./config";
export const same = (a: unknown, b: unknown) =>
  typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
export function check(
  ok: unknown,
  why = "Transaction does not match your review. / 交易与审核内容不符。",
): asserts ok {
  if (!ok) throw new Error(why);
}
export function positive(s: string) {
  check(typeof s === "string" && /^\d+$/.test(s) && BigInt(s) > 0n && BigInt(s) < 2n ** 256n);
  return BigInt(s);
}
export function txCheck(tx: Tx) {
  check(
    tx?.chainId === chain.id &&
      isAddress(tx.to) &&
      tx.to !== zeroAddress &&
      /^0x([\da-f]{2})*$/i.test(tx.data) &&
      BigInt(tx.value) >= 0n,
  );
}
export function transferTx(token: Address, recipient: Address, amount: string): Tx {
  check(isAddress(recipient) && recipient !== zeroAddress && isAddress(token));
  const units = positive(amount);
  return token === zeroAddress
    ? { to: recipient, data: "0x", value: units.toString(), chainId: chain.id }
    : {
        to: token,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "transfer",
          args: [recipient, units],
        }),
        value: "0",
        chainId: chain.id,
      };
}
export function verifyTransfer(tx: Tx, token: Address, recipient: Address, amount: string) {
  txCheck(tx);
  const expected = transferTx(token, recipient, amount);
  check(
    same(tx.to, expected.to) &&
      same(tx.data, expected.data) &&
      BigInt(tx.value) === BigInt(expected.value),
  );
}
export function verifyBridge(quote: any, input: any, now = Date.now()): Tx[] {
  check(
    quote &&
      /^0x[\da-f]{64}$/i.test(quote.requestId) &&
      Number.isFinite(quote.expiresAt) &&
      now < quote.expiresAt &&
      quote.expiresAt <= now + 120000,
    "Bridge quote expired or invalid. / 跨链报价已过期或无效。",
  );
  const source = sources.find((s) => same(s.address, input.originCurrency));
  const dest = destinations.find((d) => d.id === input.destinationChainId);
  const out = dest?.tokens.find((t) => t.address === input.destinationCurrency);
  check(source && dest && out);
  const quoted = quote.input;
  check(
    quoted &&
      same(quoted.ownerAddress, input.ownerAddress) &&
      quoted.amount === input.amount &&
      quoted.destinationChainId === input.destinationChainId &&
      same(quoted.originCurrency, source.address),
  );
  check(
    dest.id === 792703809
      ? quoted.recipient === input.recipient
      : same(quoted.recipient, input.recipient),
  );
  check(
    dest.id === 792703809
      ? quoted.destination?.currency === out.address
      : same(quoted.destination?.currency, out.address),
  );
  check(quoted.destination?.decimals === out.decimals);
  const minimum = positive(quote.minimumAmountOut),
    output = positive(quote.amountOut),
    amount = positive(input.amount);
  check(minimum <= output && minimum >= (output * 9950n) / 10000n);
  check(Array.isArray(quote.steps));
  const native = source.address === zeroAddress;
  check(
    (native ? ["deposit"] : ["approve,deposit", "deposit"]).includes(
      quote.steps.map((s: any) => s.id).join(","),
    ),
  );
  const word = (s: string) => s.slice(2).toLowerCase().padStart(64, "0");
  for (const tx of quote.steps) {
    txCheck(tx);
    if (tx.id === "approve") {
      check(!native && same(tx.to, USDG) && BigInt(tx.value) === 0n);
      const decoded = decodeFunctionData({ abi: erc20Abi, data: tx.data });
      check(
        decoded.functionName === "approve" &&
          same(decoded.args[0], DEPOSITORY) &&
          decoded.args[1] === amount,
      );
    } else {
      check(same(tx.to, DEPOSITORY));
      const prefix = native
        ? `0x49290c1c${word(input.ownerAddress)}`
        : `0xe8017952${word(input.ownerAddress)}${word(source.address)}${amount.toString(16).padStart(64, "0")}`;
      check(
        tx.data.toLowerCase().startsWith(prefix) &&
          tx.data.length === prefix.length + 64 &&
          BigInt(tx.value) === (native ? amount : 0n),
      );
    }
  }
  return quote.steps;
}
export const GATES = [
  "asset_registry",
  "eligibility_preflight",
  "policy_vault",
  "risk_engine",
  "approval_controller",
];

/**
 * Read the five service checks.
 *
 * This used to be `.every(g => g.passed)` — one boolean, and a review sheet
 * that said "Five service checks passed" whatever had happened. The service
 * can report a pass it did not establish: an eligibility check that fell back
 * to the registry entry because the chain was unreachable sets `passed: true`
 * and `details.rpcFallback`, and the old test read that as a clean pass.
 *
 * A blocked check still stops the proposal here. An unproven one does not —
 * the service did say pass — but it is carried out so the owner reads it
 * before approving, which is the whole reason for the distinction.
 */
export function checkGates(proposal: any, owner: string) {
  const i = proposal.intent || proposal.preparedTransaction?.intent;
  check(i && same(i.ownerAddress, owner) && same(i.accountAddress || owner, owner));
  const verdicts = gateVerdicts(proposal.gates, GATES);
  const stopped = blockingReason(verdicts);
  check(!stopped, stopped ? `${stopped} / 服务检查未通过，未准备任何交易。` : "");
  return { intent: i, verdicts, summary: summarise(verdicts) };
}
