import { describe, expect, it } from "bun:test";
import { redactForLog, requestIdMiddleware } from "../src/logging";

describe("privacy-preserving application logs", () => {
  it("hashes sensitive proposal fields while retaining non-sensitive event metadata", () => {
    const record = redactForLog({
      requestId: "request-123",
      ownerAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      amount: "1000000000000000000",
      prompt: "send $100 to the portfolio",
      calldata: "0xa9059cbb00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8",
      event: "intent.prepare_failed",
    }) as Record<string, unknown>;

    expect(record.requestId).toBe("request-123");
    expect(record.event).toBe("intent.prepare_failed");
    expect(record.ownerAddress).toStartWith("sha256:");
    expect(record.amount).toStartWith("sha256:");
    expect(record.prompt).toStartWith("sha256:");
    expect(record.calldata).toStartWith("sha256:");
    expect(JSON.stringify(record)).not.toContain("70997970C51812dc3A010C7d01b50e0d17dc79C8");
    expect(JSON.stringify(record)).not.toContain("send $100");
  });

  it("redacts addresses and numbers embedded in error messages", () => {
    const record = redactForLog(new Error("transfer 100 to 0x70997970C51812dc3A010C7d01b50e0d17dc79C8")) as { message: string };
    expect(record.message).not.toContain("100");
    expect(record.message).not.toContain("0x70997970");
    expect(record.message).toContain("sha256:");
  });

  it("assigns a request ID and exposes it for support tracing", () => {
    const request = {} as any;
    let header: string | undefined;
    let called = false;
    requestIdMiddleware(request, { setHeader: (_name: string, value: string) => { header = value; } } as any, () => { called = true; });
    expect(request.requestId).toBeString();
    expect(request.requestId).toBe(header);
    expect(called).toBe(true);
  });
});
