import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData, parseAbi } from "viem";
import * as nft from "../../public/tera/core/nft.js";

const owner = "0x1111111111111111111111111111111111111111";
const recipient = "0x2222222222222222222222222222222222222222";
const contract = "0x3333333333333333333333333333333333333333";
const cid = "QmYwAPJzv5CZsnAzt8auVTL5uA6tYw7MXV9Q8GpgZ5xFv3";

test("NFT discovery filters the owner's incoming ERC-721 and ERC-1155 logs", () => {
  const filters = nft.discoveryFilters(owner);
  assert.equal(filters.length, 3);
  assert.equal(filters[0].topics[2], nft.addressTopic(owner));
  assert.equal(filters[1].topics[3], nft.addressTopic(owner));
  assert.equal(filters[2].topics[3], nft.addressTopic(owner));
});

test("candidate logs identify newest ERC-721 and ERC-1155 token IDs", () => {
  const pad = (n) => BigInt(n).toString(16).padStart(64, "0");
  const token = { address: contract, blockNumber: "0x2", logIndex: "0x0" };
  const logs = [
    {
      ...token,
      topics: [nft.TRANSFER, nft.addressTopic(owner), nft.addressTopic(recipient), "0x" + pad(7)],
      data: "0x",
    },
    {
      ...token,
      topics: [
        nft.TRANSFER_SINGLE,
        "0x" + pad(1),
        nft.addressTopic(owner),
        nft.addressTopic(recipient),
      ],
      data: "0x" + pad(9) + pad(1) + pad(1),
    },
  ];
  assert.deepEqual(
    nft.candidatesFromLogs(logs).map((t) => [t.standard, t.tokenId]),
    [
      [nft.ERC721, "7"],
      [nft.ERC1155, "9"],
    ],
  );
});

test("IPFS and Arweave URLs resolve through their gateways; safe web URLs remain direct", () => {
  assert.equal(
    nft.mediaUrl("ipfs://" + cid + "/metadata.json"),
    nft.IPFS_GATEWAY + cid + "/metadata.json",
  );
  assert.equal(nft.mediaUrl("ar://" + "a".repeat(43)), "https://arweave.net/" + "a".repeat(43));
  assert.equal(nft.mediaUrl("https://nft.example/1.json"), "https://nft.example/1.json");
  assert.equal(nft.imageUrl("https://nft.example/a.png"), "https://nft.example/a.png");
  assert.equal(nft.imageUrl("http://nft.example/a.png"), "");
  assert.equal(nft.imageUrl("data:image/png;base64,AA=="), "data:image/png;base64,AA==");
  assert.equal(nft.imageUrl("javascript:alert(1)"), "");
});

test("metadata success, non-OK responses, network errors, and on-chain JSON", async () => {
  let calls = 0;
  const token = { standard: nft.ERC721, contract, tokenId: "7", uri: "https://nft.example/7.json" };
  assert.equal(
    (
      await nft.loadMetadata(token, async () => {
        calls++;
        return {
          ok: true,
          text: async () =>
            '{"name":"Seven","description":"Nice","image":"https://nft.example/7.png"}',
        };
      })
    ).name,
    "Seven",
  );
  assert.equal(await nft.loadMetadata(token, async () => ({ ok: false })), null);
  assert.equal(
    await nft.loadMetadata(token, async () => {
      throw new Error("offline");
    }),
    null,
  );
  const onchain = {
    ...token,
    uri: "data:application/json;base64," + nft.bytesToBase64(nft.utf8Bytes('{"name":"Local"}')),
  };
  assert.equal(
    (
      await nft.loadMetadata(onchain, async () => {
        calls++;
        throw Error("must not fetch");
      })
    ).name,
    "Local",
  );
  assert.equal(calls, 1);
});

test("721 and 1155 transfers match viem ABI encoding", () => {
  const abi721 = parseAbi(["function safeTransferFrom(address,address,uint256)"]);
  const abi1155 = parseAbi(["function safeTransferFrom(address,address,uint256,uint256,bytes)"]);
  const token721 = { standard: nft.ERC721, contract, tokenId: "7" };
  const token1155 = { standard: nft.ERC1155, contract, tokenId: "9" };
  assert.equal(
    nft.transferCall(token721, owner, recipient).data,
    encodeFunctionData({
      abi: abi721,
      functionName: "safeTransferFrom",
      args: [owner, recipient, 7n],
    }),
  );
  assert.equal(
    nft.transferCall(token1155, owner, recipient).data,
    encodeFunctionData({
      abi: abi1155,
      functionName: "safeTransferFrom",
      args: [owner, recipient, 9n, 1n, "0x"],
    }),
  );
});

test("transfer refuses invalid, zero, and self recipients", () => {
  const token = { standard: nft.ERC721, contract, tokenId: "7" };
  assert.throws(() => nft.transferCall(token, owner, "bad"), /recipient/i);
  assert.throws(
    () => nft.transferCall(token, owner, "0x0000000000000000000000000000000000000000"),
    /recipient/i,
  );
  assert.throws(() => nft.transferCall(token, owner, owner), /already/i);
});

test("review guard refuses changed contract, token, recipient, or value", () => {
  const token = { standard: nft.ERC721, contract, tokenId: "7" };
  const tx = nft.transferCall(token, owner, recipient);
  assert.doesNotThrow(() => nft.checkTransfer(tx, token, owner, recipient));
  for (const changed of [
    { ...tx, to: recipient },
    { ...tx, data: nft.transferCall({ ...token, tokenId: "8" }, owner, recipient).data },
    { ...tx, data: nft.transferCall(token, owner, owner.slice(0, -1) + "4").data },
    { ...tx, value: "1" },
  ])
    assert.throws(() => nft.checkTransfer(changed, token, owner, recipient), /does not match/i);
});
