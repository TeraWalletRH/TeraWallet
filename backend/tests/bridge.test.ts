import { describe, it, expect } from "bun:test";
import { bridgeInput, validateQuote, validRecipient, USDG, DEPOSITORY, destinations } from "../src/bridge";

const owner = `0x${"1".repeat(40)}`;
const recipient = `0x${"2".repeat(40)}`;
const word = (s: string) => s.slice(2).padStart(64, "0");
const amount = "10000000";
const amountWord = BigInt(amount).toString(16).padStart(64, "0");
const input = bridgeInput({ ownerAddress: owner, recipient, amount, destinationChainId: 8453 });
function fixture() {
  return {
    requestId: `0x${"a".repeat(64)}`,
    details: { sender: owner, recipient, currencyIn: { currency: { chainId: 4663, address: USDG }, amount },
      currencyOut: { currency: { chainId: 8453, address: destinations[0].currency }, amount: "9945383", minimumAmount: "9895656" } },
    steps: [
      { id: "approve", kind: "transaction", items: [{ data: { from: owner, to: USDG, chainId: 4663, value: "0", data: `0x095ea7b3${word(DEPOSITORY)}${amountWord}` } }] },
      { id: "deposit", kind: "transaction", items: [{ data: { from: owner, to: DEPOSITORY, chainId: 4663, value: "0", data: `0xe8017952${word(owner)}${word(USDG)}${amountWord}${"a".repeat(64)}` } }] },
    ],
  };
}
describe("Relay bridge validation (no live provider)", () => {
  it("validates Base and exact 32-byte Solana addresses", () => {
    expect(validRecipient(8453, recipient)).toBe(true);
    expect(validRecipient(792703809, destinations[2].currency)).toBe(true);
    for (const invalid of [recipient, "1".repeat(31), "1".repeat(32), "z".repeat(44), "O".repeat(32)])
      expect(validRecipient(792703809, invalid)).toBe(false);
    expect(() => bridgeInput({ ...input, amount: "-1" })).toThrow();
    expect(() => bridgeInput({ ...input, destinationChainId: 1 })).toThrow();
  });
  it("accepts exact deposits and rounded 0.5% output floors", () => {
    const q = validateQuote(fixture(), input, 1000);
    expect(q.steps.length).toBe(2);
    expect(q.expiresAt).toBe(121000);
    expect(q.minimumAmountOut).toBe("9895656");
  });
  it("rejects altered recipient, amount, chain, spender, value and slippage", () => {
    const mutations = [
      (q: any) => q.details.recipient = owner,
      (q: any) => q.details.currencyIn.amount = "1",
      (q: any) => q.steps[1].items[0].data.chainId = 8453,
      (q: any) => q.steps[0].items[0].data.to = owner,
      (q: any) => q.steps[1].items[0].data.value = "1",
      (q: any) => q.details.currencyOut.minimumAmount = "1",
      (q: any) => q.steps[0].items[0].data.data = `0x095ea7b3${word(DEPOSITORY)}${"f".repeat(64)}`,
      (q: any) => q.steps[1].items[0].data.data = `0xe8017952${word(recipient)}${word(USDG)}${amountWord}${"a".repeat(64)}`,
      (q: any) => q.steps.pop(),
    ];
    for (const mutate of mutations) { const q = fixture(); mutate(q); expect(() => validateQuote(q, input, 0)).toThrow(); }
  });
  it("accepts Solana destination metadata without an EVM destination wallet", () => {
    const solInput = bridgeInput({ ...input, destinationChainId: 792703809, recipient: destinations[2].currency });
    const q = fixture();
    q.details.recipient = solInput.recipient;
    q.details.currencyOut.currency = { chainId: 792703809, address: destinations[2].currency };
    expect(validateQuote(q, solInput, 0).input.destinationChainId).toBe(792703809);
  });
  it("accepts Arc USDC as an EVM destination", () => {
    const arc = bridgeInput({ ...input, destinationChainId: 5042, destinationCurrency: "0x3600000000000000000000000000000000000000" });
    expect(arc.destination.name).toBe("Arc");
    expect(arc.destination.symbol).toBe("USDC");
  });
  it("preserves the exact native ETH value in the deposit step", () => {
    const ethInput = bridgeInput({ ...input, originCurrency: "0x0000000000000000000000000000000000000000", amount: "10000000000000000" });
    const q = fixture();
    q.details.currencyIn.currency.address = "0x0000000000000000000000000000000000000000";
    q.details.currencyIn.amount = ethInput.amount;
    q.details.currencyOut.currency = { chainId: 8453, address: destinations[0].currency };
    q.steps = [{ id: "deposit", kind: "transaction", items: [{ data: { from: owner, to: DEPOSITORY, chainId: 4663, value: ethInput.amount, data: `0x49290c1c${word(owner)}${"a".repeat(64)}` } }] }];
    const normalized = validateQuote(q, ethInput, 0);
    expect(normalized.steps[0].value).toBe("0x2386f26fc10000");
  });
});
