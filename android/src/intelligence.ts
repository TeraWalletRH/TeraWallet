/** Facts shown before signing. These are local checks, never an AI verdict. */
export type ReviewIntelligence = {
  preview: string;
  risks: string[];
  safer: string[];
  route?: string;
  networkFee?: string;
};

export type IntelligenceInput = {
  language?: "en" | "zh";
  action: string;
  send?: string;
  recipient?: string;
  owner?: string;
  knownRecipient?: boolean;
  recipientHasCode?: boolean;
  recipientCodeUnavailable?: boolean;
  checkRecipientContract?: boolean;
  steps: number;
  simulation?: "checking" | "passed" | "needs-attention";
  quote?: { route: string; priceImpactPct: number; amountOut: string; minimumOut: string; slippage?: string; comparedRoutes?: Array<{ route: string; amountOut: string }> };
  estimatedFeeEth?: string;
  gasEstimateUnavailable?: boolean;
};

export function reviewIntelligence(input: IntelligenceInput): ReviewIntelligence {
  const zh = input.language === "zh";
  const risks: string[] = [];
  const safer: string[] = [];
  const target = input.recipient && input.recipient.toLowerCase() !== input.owner?.toLowerCase()
    ? ` to ${input.recipient.slice(0, 8)}…${input.recipient.slice(-4)}` : "";
  const preview = zh
    ? `即将进行：${input.action}${input.send ? ` ${input.send}` : ""}${target ? `，收款地址 ${target.trim().slice(3)}` : ""}。`
    : `You are about to ${input.action.toLowerCase()}${input.send ? ` ${input.send}` : ""}${target}.`;

  if (input.simulation === "needs-attention") {
    risks.push(zh ? "交易模拟失败或无法完成。" : "The transaction simulation failed or could not be completed.");
    safer.push(zh ? "签名前请稍后重试检查。" : "Wait and retry the check before signing.");
  }
  if (target && !input.knownRecipient) {
    risks.push(zh ? "此收款地址不在联系人或近期付款记录中。" : "This recipient is not in your saved contacts or recent payments.");
    safer.push(zh ? "请通过其他渠道与收款方核对完整地址。" : "Confirm the full address with the recipient using another channel.");
  }
  if (target && input.recipientHasCode) {
    risks.push(zh ? "收款地址是合约，可能无法按预期接收此资产。" : "The recipient is a contract. It may not handle this asset as expected.");
    safer.push(zh ? "发送前请核对合约及其充值说明。" : "Confirm the contract and its deposit instructions before sending.");
  }
  if (target && input.recipientCodeUnavailable) risks.push(zh ? "无法检查收款地址是否为合约。" : "Recipient contract status could not be checked.");
  if (input.quote && Number.isFinite(input.quote.priceImpactPct) && input.quote.priceImpactPct >= 2) {
    risks.push(zh ? `预计价格影响为 ${input.quote.priceImpactPct.toFixed(2)}%。` : `Estimated price impact is ${input.quote.priceImpactPct.toFixed(2)}%.`);
    safer.push(zh ? "可尝试减少交易金额并比较新报价。" : "Try a smaller trade and compare the new quote.");
  }
  if (input.quote && input.steps > 1) {
    risks.push(zh ? `兑换前还需签署 ${input.steps - 1} 步授权。` : `${input.steps - 1} approval step${input.steps === 2 ? "" : "s"} will be signed before the swap.`);
    safer.push(zh ? "请在交易详情中核对每笔授权的金额和支出方。" : "Review each approval amount and spender in transaction details.");
  }
  const route = input.quote
    ? zh
      ? `路线：${input.quote.route}；预计 ${input.quote.amountOut}，最低 ${input.quote.minimumOut}（滑点上限 ${input.quote.slippage || "1%"}）。${input.quote.comparedRoutes && input.quote.comparedRoutes.length > 1 ? `已比较：${input.quote.comparedRoutes.map((candidate) => `${candidate.route} ${candidate.amountOut}`).join(" / ")}。` : ""}网络费另计。`
      : `${input.quote.route}; expected ${input.quote.amountOut}, minimum ${input.quote.minimumOut} (${input.quote.slippage || "1%"} slippage limit).${input.quote.comparedRoutes && input.quote.comparedRoutes.length > 1 ? ` Compared: ${input.quote.comparedRoutes.map((candidate) => `${candidate.route} ${candidate.amountOut}`).join(" vs ")}.` : ""} Gas is separate.`
    : undefined;
  return { preview, risks, safer, route, networkFee: input.estimatedFeeEth
    ? zh ? `按当前 gas 价格估算网络费约 ${input.estimatedFeeEth} ETH；签名前会重新检查。` : `Estimated network fee ~${input.estimatedFeeEth} ETH at the current gas price; rechecked before signing.`
    : input.gasEstimateUnavailable ? zh ? "无法估算网络费；签名前会重新检查。" : "Network fee estimate unavailable; checked again before signing." : undefined };
}
