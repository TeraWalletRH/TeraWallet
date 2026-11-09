import { describe, expect, it } from "bun:test";
import { getAddress } from "viem";
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

  it("an EIP-681 ERC-20 transfer URI resolves to the address= recipient, not the token contract", () => {
    const token = "0x3c12E57fa7817a86CE7C254dB9Ea5Fe639e233F8";
    const recipient = "0x9A6e20556c4d7f5AEE3a676E469C31E0Ac8bC4D9";
    const uri = `ethereum:${token}/transfer?address=${recipient}&uint256=1000000`;
    expect(parseQrAddress(uri)).toBe(getAddress(recipient));
    expect(parseQrAddress(uri)).not.toBe(getAddress(token));
  });

  it("an ERC-20 transfer URI with address= before uint256= still resolves correctly", () => {
    const token = "0x3c12E57fa7817a86CE7C254dB9Ea5Fe639e233F8";
    const recipient = "0x9A6e20556c4d7f5AEE3a676E469C31E0Ac8bC4D9";
    const uri = `ethereum:${token}/transfer?uint256=1000000&address=${recipient}`;
    expect(parseQrAddress(uri)).toBe(getAddress(recipient));
  });

  it("an ERC-20 transfer URI missing address= is refused rather than guessed", () => {
    const token = "0x3c12E57fa7817a86CE7C254dB9Ea5Fe639e233F8";
    expect(parseQrAddress(`ethereum:${token}/transfer?uint256=1000000`)).toBeNull();
  });

  it("text naming two different addresses is refused rather than picking the first", () => {
    const a = "0x9A6e20556c4d7f5AEE3a676E469C31E0Ac8bC4D9";
    const b = "0x3c12E57fa7817a86CE7C254dB9Ea5Fe639e233F8";
    expect(parseQrAddress(`from ${a} to ${b}`)).toBeNull();
  });

  it("a longer hex blob (a tx hash) is not truncated into a fake address", () => {
    const hash = "0x" + "a".repeat(64);
    expect(parseQrAddress(hash)).toBeNull();
  });
});
