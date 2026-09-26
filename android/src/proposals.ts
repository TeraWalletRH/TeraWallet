import {
  encodeFunctionData,
  encodeAbiParameters,
  encodePacked,
  erc20Abi,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { chain, USDG, type Tx } from "./config";
import { check, checkGates, positive, same, txCheck, verifyTransfer } from "./validation";
const ROUTER = "0xcaf681a66d020601342297493863e78c959e5cb2";
const UNIVERSAL = "0x8876789976decbfcbbbe364623c63652db8c0904";
const PERMIT = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const TERA = "0x3c12E57fa7817a86CE7C254dB9Ea5Fe639e233F8";
const TERA_HOOK = "0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044";
export const swapAbi = parseAbi([
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256)",
  "function exactInput((bytes path,address recipient,uint256 amountIn,uint256 amountOutMinimum) params) payable returns (uint256)",
  "function execute(bytes commands,bytes[] inputs,uint256 deadline) payable",
]);
const permitAbi = parseAbi([
  "function approve(address token,address spender,uint160 amount,uint48 expiration)",
]);
import { decodeFunctionData } from "viem";
export function verifyProposal(proposal: any, owner: string, now = Date.now()): Tx[] {
  const { intent } = checkGates(proposal, owner);
  const tx = proposal.preparedTransaction;
  txCheck(tx);
  if (intent.actionType === "TRANSFER") {
    check(!tx.approvals?.length);
    verifyTransfer(tx, intent.assetAddress, intent.recipient, intent.amount);
    return [tx];
  }
  check(["BUY", "SELL"].includes(intent.actionType));
  const teraTrade = same(intent.assetAddress, TERA);
  const q = tx.quote;
  check(
    q &&
      Number.isFinite(Date.parse(q.quotedAt)) &&
      now - Date.parse(q.quotedAt) < 120000 &&
      Date.parse(q.quotedAt) <= now + 30000 &&
      Date.parse(tx.expiresAt) > now,
    "Swap quote expired. Prepare again. / 兑换报价已过期，请重新准备。",
  );
  const amount = positive(intent.amount),
    minimum = (positive(q.amountOutWei) * 9900n) / 10000n;
  check(minimum > 0n);
  const tokenIn: Address = intent.actionType === "BUY" ? (teraTrade ? zeroAddress : USDG) : intent.assetAddress;
  const tokenOut: Address = intent.actionType === "BUY" ? intent.assetAddress : (teraTrade ? zeroAddress : USDG);
  check(BigInt(tx.value) === (tokenIn === zeroAddress ? amount : 0n));
  const routing = q.routing;
  let expected: Hex;
  let spender: Address = ROUTER;
  if (routing?.type === "direct") {
    check([100, 500, 3000, 10000].includes(routing.fee));
    expected = encodeFunctionData({
      abi: swapAbi,
      functionName: "exactInputSingle",
      args: [
        {
          tokenIn,
          tokenOut,
          fee: routing.fee,
          recipient: owner as Address,
          amountIn: amount,
          amountOutMinimum: minimum,
          sqrtPriceLimitX96: 0n,
        },
      ],
    });
    check(same(tx.to, ROUTER));
  } else if (routing?.type === "via-weth") {
    check(
      [100, 500, 3000, 10000].includes(routing.feeIn) &&
        [100, 500, 3000, 10000].includes(routing.feeOut),
    );
    expected = encodeFunctionData({
      abi: swapAbi,
      functionName: "exactInput",
      args: [
        {
          path: encodePacked(
            ["address", "uint24", "address", "uint24", "address"],
            [tokenIn, routing.feeIn, WETH, routing.feeOut, tokenOut],
          ),
          recipient: owner as Address,
          amountIn: amount,
          amountOutMinimum: minimum,
        },
      ],
    });
    check(same(tx.to, ROUTER));
  } else {
    check(routing?.type === "v4" && same(tx.to, UNIVERSAL));
    const p = routing.poolKey;
    check(
      p &&
        same(routing.zeroForOne ? p.currency0 : p.currency1, tokenIn) &&
        same(routing.zeroForOne ? p.currency1 : p.currency0, tokenOut),
    );
    check(
      teraTrade
        ? same(p.currency0, zeroAddress) && same(p.currency1, TERA) && p.fee === 0 && p.tickSpacing === 200 && same(p.hooks, TERA_HOOK)
        : same(p.hooks, zeroAddress),
      "This pool uses a hook not supported in the Android release. / 此池使用的钩子暂不受 Android 版本支持。",
    );
    const decoded = decodeFunctionData({ abi: swapAbi, data: tx.data });
    check(decoded.functionName === "execute");
    const deadline = decoded.args[2];
    check(
      deadline > BigInt(Math.floor(now / 1000)) &&
        deadline <= BigInt(Math.floor(now / 1000) + 1200),
    );
    const swap = encodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            {
              name: "poolKey",
              type: "tuple",
              components: [
                { name: "currency0", type: "address" },
                { name: "currency1", type: "address" },
                { name: "fee", type: "uint24" },
                { name: "tickSpacing", type: "int24" },
                { name: "hooks", type: "address" },
              ],
            },
            { name: "zeroForOne", type: "bool" },
            { name: "amountIn", type: "uint128" },
            { name: "amountOutMinimum", type: "uint128" },
            { name: "minHopPriceX36", type: "uint256" },
            { name: "hookData", type: "bytes" },
          ],
        },
      ],
      [
        {
          poolKey: p,
          zeroForOne: routing.zeroForOne,
          amountIn: amount,
          amountOutMinimum: minimum,
          minHopPriceX36: 0n,
          hookData: "0x",
        },
      ],
    );
    const settle = encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      [tokenIn, amount],
    );
    const take = encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      [tokenOut, minimum],
    );
    const input = encodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes[]" }],
      ["0x060c0f", [swap, settle, take]],
    );
    expected = encodeFunctionData({
      abi: swapAbi,
      functionName: "execute",
      args: ["0x10", [input], deadline],
    });
    spender = PERMIT;
  }
  check(tx.data.toLowerCase() === expected.toLowerCase());
  check(Array.isArray(tx.approvals) && tx.approvals.length <= (spender === PERMIT ? 2 : 1));
  if (tokenIn === zeroAddress) check(tx.approvals.length === 0);
  let seenToken = false,
    seenPermit = false;
  for (const approval of tx.approvals) {
    txCheck(approval);
    check(BigInt(approval.value) === 0n);
    if (same(approval.to, tokenIn)) {
      check(!seenToken && !seenPermit);
      seenToken = true;
      check(
        same(
          approval.data,
          encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }),
        ),
      );
    } else {
      check(spender === PERMIT && same(approval.to, PERMIT) && !seenPermit);
      seenPermit = true;
      const d = decodeFunctionData({ abi: permitAbi, data: approval.data });
      check(
        same(d.args[0], tokenIn) &&
          same(d.args[1], UNIVERSAL) &&
          d.args[2] === amount &&
          d.args[3] > now / 1000 &&
          d.args[3] <= now / 1000 + 1200,
      );
    }
  }
  return [...tx.approvals, tx];
}

/**
 * The five checks as verdicts, for the review sheet.
 *
 * Separate from `verifyProposal` so the sheet can say what actually happened
 * without that function changing shape. It is pure and cheap, so running the
 * read twice costs nothing and keeps the signing path untouched.
 */
export function proposalVerdicts(proposal: any, owner: string) {
  const { verdicts, summary } = checkGates(proposal, owner);
  return { verdicts, summary };
}
