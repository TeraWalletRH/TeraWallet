import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NATIVE,
  TERA,
  USDG,
  payoutMessage,
  stakingSignature,
  stepLabel,
  swapPair,
  swapReview,
  tradable,
  unlockMessage,
} from "../../public/tera/core/wallet-swap.js";

const WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
const ME = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const eth = { symbol: "ETH", address: NATIVE, decimals: 18 };
const usdg = { symbol: "USDG", address: USDG, decimals: 6 };
const weth = { symbol: "WETH", address: WETH, decimals: 18 };
const tera = { symbol: "TERA", address: TERA, decimals: 18 };
const assets = [usdg, eth, weth, tera];
const pad = (hex) => hex.replace(/^0x/, "").padStart(64, "0");

test("swaps trade an asset against USDG; TERA against ETH; ETH and USDG aren't the asset", () => {
  assert.deepEqual(
    tradable(assets).map((a) => a.symbol),
    ["WETH", "TERA"],
  );
  assert.deepEqual(swapPair(weth, "BUY", assets), { pay: usdg, receive: weth });
  assert.deepEqual(swapPair(weth, "SELL", assets), { pay: weth, receive: usdg });
  assert.deepEqual(swapPair(tera, "BUY", assets), { pay: eth, receive: tera });
  assert.deepEqual(swapPair(tera, "SELL", assets), { pay: tera, receive: eth });
  assert.equal(swapPair(weth, "SWAP", assets), null);
  assert.equal(swapPair(weth, "BUY", [weth]), null);
});

const quote = (over = {}) => ({
  amountOutWei: "851558267044354",
  priceImpactPct: 0.0012,
  route: "v4 direct (0.3% fee)",
  ...over,
});

test("the review says what's paid, expected, and the least that can come back", () => {
  const r = swapReview({
    units: 2000000n,
    quote: quote(),
    pay: usdg,
    receive: weth,
    slippageBps: 50,
    payUsd: 2,
  });
  assert.equal(r.title, "Swap 2 USDG for WETH");
  assert.deepEqual(r.rows.slice(0, 4), [
    ["You pay", "2 USDG"],
    ["You receive", "≈ 0.000851 WETH"],
    ["At least", "0.000847 WETH"],
    ["Slippage limit", "0.5%"],
  ]);
  assert.equal(r.impact.level, "low");
  assert.equal(r.blocked, undefined);
  assert.equal(r.consent, undefined);
});

test("price impact: warned past 1%, ticked past 5%, refused past 15%", () => {
  const at = (pct) =>
    swapReview({
      units: 2000000n,
      quote: quote({ priceImpactPct: pct }),
      pay: usdg,
      receive: weth,
      slippageBps: 100,
      payUsd: 1000,
    });
  assert.match(at(2).warnings[0], /moves the price about 2\.0%/);
  assert.equal(at(6).consent, true);
  assert.match(at(6).warnings[0], /High price impact/);
  assert.match(at(20).blocked, /too thin/);
  assert.equal(at(Number.NaN).impact.level, "unknown");
});

test("every step is named, with the exact amount", () => {
  const approve = {
    to: USDG,
    data:
      "0x095ea7b3" + pad("0x000000000022d473030f116ddee9f6b43ac78ba3") + pad(2000000n.toString(16)),
    value: "0",
  };
  assert.equal(stepLabel(approve, { pay: usdg }), "Approve Permit2 to take exactly 2 USDG");
  const router = {
    ...approve,
    data:
      "0x095ea7b3" + pad("0xcaf681a66d020601342297493863e78c959e5cb2") + pad(2000000n.toString(16)),
  };
  assert.equal(
    stepLabel(router, {
      pay: usdg,
      spenders: { "0xcaf681a66d020601342297493863e78c959e5cb2": "Tera swap router" },
    }),
    "Approve Tera swap router to take exactly 2 USDG",
  );
  const expiry = Math.floor(Date.now() / 1000) + 20 * 60;
  const permit = {
    to: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    data:
      "0x87517c45" +
      pad(USDG) +
      pad("0x8876789976decbfcbbbe364623c63652db8c0904") +
      pad(2000000n.toString(16)) +
      pad(expiry.toString(16)),
    value: "0",
  };
  assert.equal(
    stepLabel(permit, { pay: usdg }),
    "Let the swap use exactly 2 USDG through Permit2, for 20 min",
  );
  assert.equal(
    stepLabel(
      { to: "0x8876789976decbfcbbbe364623c63652db8c0904", data: "0x3593564c", value: "0" },
      { pay: usdg },
    ),
    "Swap",
  );
});

test("staking requests are signed only as the exact text Tera expects", () => {
  // The backend's own format (backend/src/staking-outbox.ts).
  assert.equal(
    payoutMessage("claim", ME, "epoch-1", "0", "key-1"),
    `Tera staking claim\nWallet: ${ME.toLowerCase()}\nEpoch: epoch-1\nAmount: 0\nRequest: key-1`,
  );
  assert.equal(
    unlockMessage(ME, "lock-1", "1500", "key-2"),
    `Tera fixed staking unlock\nWallet: ${ME.toLowerCase()}\nLock: lock-1\nAmount: 1500\nRequest: key-2`,
  );
  const request = { wallet: ME, epochId: "epoch-1", amount: "100", key: "key-3" };
  const good = payoutMessage("unstake", ME, "epoch-1", "100", "key-3");
  assert.deepEqual(stakingSignature("unstake", request, good), { message: good });
  // A service that swaps in another wallet, amount or action gets nothing signed.
  for (const tampered of [
    payoutMessage(
      "unstake",
      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      "epoch-1",
      "100",
      "key-3",
    ),
    payoutMessage("unstake", ME, "epoch-1", "1", "key-3"),
    payoutMessage("claim", ME, "epoch-1", "100", "key-3"),
    `${good}\nAlso: transfer everything`,
  ])
    assert.match(stakingSignature("unstake", request, tampered).error, /nothing was signed/);
  const lock = { wallet: ME, lockId: "lock-1", amount: "1500", key: "key-4" };
  assert.ok(stakingSignature("unlock", lock, unlockMessage(ME, "lock-1", "1500", "key-4")).message);
});
