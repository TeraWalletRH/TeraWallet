import { describe, expect, test } from "bun:test";
import { floorAlertContract, floorAlertSymbol } from "../src/nft-prices";

describe("floorAlertSymbol and floorAlertContract", () => {
  test("round-trips a contract address through the alert symbol", () => {
    const contract = "0x539CDD042C2F3D93EBC5BE7DFFF0C79F3B4FABF0";
    const symbol = floorAlertSymbol(contract);
    expect(symbol).toBe("nft:0x539cdd042c2f3d93ebc5be7dfff0c79f3b4fabf0");
    expect(floorAlertContract(symbol)).toBe("0x539cdd042c2f3d93ebc5be7dfff0c79f3b4fabf0");
  });

  test("floorAlertContract is null for a token symbol, not an NFT one", () => {
    expect(floorAlertContract("ETH")).toBeNull();
    expect(floorAlertContract("USDG")).toBeNull();
    expect(floorAlertContract("")).toBeNull();
  });
});
