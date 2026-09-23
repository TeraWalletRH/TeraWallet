import { describe, expect, it } from "bun:test";
import { nft } from "../src/core";

const owner = "0x1111111111111111111111111111111111111111";
const to = "0x2222222222222222222222222222222222222222";
const token = {
  standard: nft.ERC721,
  contract: "0x3333333333333333333333333333333333333333",
  tokenId: "1",
};

describe("Android NFT transfer guard", () => {
  it("builds the reviewed transfer and rejects changes", () => {
    const tx = nft.transferCall(token, owner, to);
    expect(() => nft.checkTransfer(tx, token, owner, to)).not.toThrow();
    expect(() => nft.checkTransfer({ ...tx, value: "1" }, token, owner, to)).toThrow();
  });
});
