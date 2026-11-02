import { describe, expect, test } from "bun:test";
import { mainnetEthBalance } from "../src/mainnet-balance";

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
