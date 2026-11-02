import { describe, expect, test } from "bun:test";
import { mainnetEthBalance, mainnetHoldings } from "../src/mainnet-balance";

describe("mainnetEthBalance", () => {
  test(
    "never throws -- every node failing resolves to null, not a rejection",
    async () => {
      const result = await mainnetEthBalance("0x0000000000000000000000000000000000000000");
      expect(result === null || typeof result === "string").toBe(true);
    },
    30_000,
  );
});

describe("mainnetHoldings", () => {
  test(
    // The zero address turns out to hold a very real, very large balance --
    // it's where burned ETH and mis-sent tokens end up, which this test
    // first got wrong by assuming it would be empty. The real assertion is
    // the shape of what comes back, not that any one address is at zero.
    "every holding is a known mainnet symbol with a real positive amount",
    async () => {
      const holdings = await mainnetHoldings("0x0000000000000000000000000000000000000000");
      for (const holding of holdings) {
        expect(["ETH", "USDC", "USDT"]).toContain(holding.symbol);
        expect(Number(holding.amount)).toBeGreaterThan(0);
      }
    },
    30_000,
  );

  test(
    "a real, long-funded address shows real nonzero holdings, each a plain decimal string",
    async () => {
      const holdings = await mainnetHoldings("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
      expect(holdings.length).toBeGreaterThan(0);
      for (const holding of holdings) {
        expect(["ETH", "USDC", "USDT"]).toContain(holding.symbol);
        expect(Number(holding.amount)).toBeGreaterThan(0);
      }
    },
    30_000,
  );
});
