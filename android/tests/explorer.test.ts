import { expect, test } from "bun:test";
import { fetchChainHistory } from "../src/explorer";

test("chain history keeps sent and received transfers distinct", async () => {
  const address = "0x1111111111111111111111111111111111111111" as const;
  const other = "0x2222222222222222222222222222222222222222";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => ({
    ok: true,
    json: async () => String(url).includes("token-transfers") ? { items: [
      { transaction_hash: "0xsend", from: { hash: address }, to: { hash: other }, total: { value: "2500000" }, token: { decimals: 6, symbol: "USDG" }, timestamp: "2026-09-26T10:00:00Z" },
      { transaction_hash: "0xreceive", from: { hash: other }, to: { hash: address }, total: { value: "4000000" }, token: { decimals: 6, symbol: "USDG" }, timestamp: "2026-09-26T11:00:00Z" },
    ] } : { items: [] },
  })) as typeof fetch;
  try {
    const history = await fetchChainHistory(address, (en) => en);
    expect(history.map((entry) => entry.direction)).toEqual(["receive", "send"]);
    expect(history[0].title).toContain("Received 4 USDG");
    expect(history[1].title).toContain("Sent 2.5 USDG");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
