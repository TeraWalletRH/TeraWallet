import { describe, expect, test } from "bun:test";
import { isEnsName } from "../src/ens";

describe("isEnsName", () => {
  test("accepts well-formed .eth names", () => {
    expect(isEnsName("vitalik.eth")).toBe(true);
    expect(isEnsName("Vitalik.ETH")).toBe(true);
    expect(isEnsName(" vitalik.eth ")).toBe(true);
    expect(isEnsName("sub.domain.eth")).toBe(true);
  });

  test("rejects everything a send screen could otherwise mistake for one", () => {
    expect(isEnsName("")).toBe(false);
    expect(isEnsName("@astra")).toBe(false);
    expect(isEnsName("pay@acme.com")).toBe(false);
    expect(isEnsName("0x5b2759f9620f54a5E1651A567Ebd8381F07f9f05")).toBe(false);
    expect(isEnsName("vitalik")).toBe(false);
    expect(isEnsName("vitalik.com")).toBe(false);
    expect(isEnsName(".eth")).toBe(false);
  });
});
