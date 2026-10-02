import { describe, expect, test } from "bun:test";
import { generateActivityCsv } from "../src/share";

describe("generateActivityCsv function", () => {
  test("generates valid CSV with header and data rows", () => {
    const history = [
      {
        createdAt: "2026-10-02T12:00:00Z",
        txHash: "0x1234567890abcdef1234567890abcdef12345678",
        action: "TRANSFER",
        payee: "0x1111111111111111111111111111111111111111",
        status: "confirmed",
        chainId: 4663,
      },
    ];

    const csv = generateActivityCsv(history);
    const lines = csv.split("\n");

    expect(lines.length).toBe(2);
    expect(lines[0]).toBe('"Date","TxHash","Action","Payee","Status","ChainID"');
    expect(lines[1]).toContain('"2026-10-02T12:00:00Z"');
    expect(lines[1]).toContain('"0x1234567890abcdef1234567890abcdef12345678"');
    expect(lines[1]).toContain('"TRANSFER"');
  });

  test("handles empty history array gracefully", () => {
    const csv = generateActivityCsv([]);
    expect(csv).toBe('"Date","TxHash","Action","Payee","Status","ChainID"');
  });
});
