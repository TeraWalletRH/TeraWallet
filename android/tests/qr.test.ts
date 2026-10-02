import { describe, expect, it } from "bun:test";
import { parseQrAddress } from "../src/validation";

describe("parseQrAddress", () => {
  it("extracts EVM address from raw hex string", () => {
    const input = "0x9A6e20556c4d7f5AEE3a676E469C31E0Ac8bC4D9";
    const parsed = parseQrAddress(input);
    expect(parsed).toBe("0x9A6e20556c4d7f5aEE3a676E469c31E0ac8Bc4D9");
  });

  it("extracts EVM address from EIP-681 ethereum: URI", () => {
    const uri = "ethereum:0x9A6e20556c4d7f5AEE3a676E469C31E0Ac8bC4D9?value=1e18";
    const parsed = parseQrAddress(uri);
    expect(parsed).toBe("0x9A6e20556c4d7f5aEE3a676E469c31E0ac8Bc4D9");
  });

  it("returns null for invalid inputs", () => {
    expect(parseQrAddress("not_an_address")).toBeNull();
    expect(parseQrAddress("")).toBeNull();
  });
});
