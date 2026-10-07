import { describe, expect, it } from "bun:test";
import { nextNonce, recoveryFor } from "../src/staking-executor";

describe("staking payout nonces", () => {
  it("never reuses the nonce of a payout already signed or sent", () => {
    // The node has not yet seen the payout signed a moment ago at 17.
    expect(nextNonce(17, [17])).toBe(18);
    expect(nextNonce(17, [17, 18])).toBe(19);
    expect(nextNonce(17, [])).toBe(17);
    // A node ahead of the outstanding list wins.
    expect(nextNonce(21, [17, 18])).toBe(21);
  });
});

describe("recovering a sent payout with no receipt", () => {
  it("waits while the node still knows the transaction", () => {
    expect(recoveryFor({ txKnown: true, latestNonce: 20, txNonce: 17 })).toBe("wait");
  });
  it("sends the same bytes again when it was dropped and its nonce is free", () => {
    expect(recoveryFor({ txKnown: false, latestNonce: 17, txNonce: 17 })).toBe("rebroadcast");
    expect(recoveryFor({ txKnown: false, latestNonce: 16, txNonce: 17 })).toBe("rebroadcast");
  });
  it("re-signs when another transaction took its nonce, as these bytes can never be mined", () => {
    expect(recoveryFor({ txKnown: false, latestNonce: 18, txNonce: 17 })).toBe("resign");
  });
});
