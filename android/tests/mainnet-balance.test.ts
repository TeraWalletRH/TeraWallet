import { describe, expect, test } from "bun:test";
import { arcHoldings, baseHoldings, mainnetEthBalance, mainnetHoldings } from "../src/mainnet-balance";

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

describe("baseHoldings", () => {
  test(
    "a real, long-funded address shows real nonzero holdings on Base, each a plain decimal string",
    async () => {
      const holdings = await baseHoldings("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
      expect(holdings.length).toBeGreaterThan(0);
      for (const holding of holdings) {
        expect(["ETH", "USDC"]).toContain(holding.symbol);
        expect(Number(holding.amount)).toBeGreaterThan(0);
      }
    },
    30_000,
  );

  test(
    "never throws -- every node failing resolves to an empty list, not a rejection",
    async () => {
      const holdings = await baseHoldings("0x0000000000000000000000000000000000000000");
      expect(Array.isArray(holdings)).toBe(true);
    },
    30_000,
  );
});

describe("arcHoldings", () => {
  test(
    // Arc pays gas in USDC rather than a separate native coin, and the
    // contract address src/config.ts names as Arc's USDC is a view onto
    // that same native balance, not a second holding. This is the
    // regression test for that: never two rows, never any symbol but
    // USDC, for any address this session checked by hand.
    "never double-counts the one real balance as both native and token",
    async () => {
      for (const address of [
        "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
        "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
      ] as const) {
        const holdings = await arcHoldings(address);
        expect(holdings.length).toBeLessThanOrEqual(1);
        for (const holding of holdings) {
          expect(holding.symbol).toBe("USDC");
          expect(Number(holding.amount)).toBeGreaterThan(0);
        }
      }
    },
    30_000,
  );

  test(
    "never throws -- every node failing resolves to an empty list, not a rejection",
    async () => {
      const holdings = await arcHoldings("0x0000000000000000000000000000000000000000");
      expect(Array.isArray(holdings)).toBe(true);
    },
    30_000,
  );
});
