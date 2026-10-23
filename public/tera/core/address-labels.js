// Tera's built-in address labels. Display metadata, never identity proofs,
// contact trust, token validation, or permission to send. Entries are scoped to
// one chain and sourced from the contracts this repository already uses.
import { KNOWN_SPENDERS } from "./approvals.js";
const ADDRESS = /^0x[\da-f]{40}$/i;
const row = (address, name, zh, category, source) => Object.freeze({
  chainId: 4663, address: address.toLowerCase(), name, zh, category, source,
});
export const KNOWN_ADDRESSES = Object.freeze([
  ...Object.entries(KNOWN_SPENDERS).map(([address, names]) =>
    row(address, names[0], names[1], address === "0x4cd00e387622c35bddb9b4c962c136462338bc31" ? "bridge" : "protocol", "public/tera/core/approvals.js")),
  row("0x5fc5360d0400a0fd4f2af552add042d716f1d168", "USDG token", "USDG 代币合约", "token", "backend/src/data/assets.ts"),
  row("0x3c12e57fa7817a86ce7c254db9ea5fe639e233f8", "TERA token", "TERA 代币合约", "token", "backend/src/data/assets.ts"),
  row("0x0bd7d308f8e1639fab988df18a8011f41eacad73", "Wrapped ETH", "封装 ETH 合约", "token", "backend/src/data/assets.ts"),
  row("0x8dc178efb8111bb0973dd9d722ebeff267c98f94", "Uniswap V4 Quoter", "Uniswap V4 报价合约", "protocol", "backend/src/chain/swapQuoteV4.ts"),
  row("0xf3334192d15450cdd385c8b70e03f9a6bd9e673b", "Uniswap V4 State View", "Uniswap V4 状态查询", "protocol", "backend/src/chain/swapQuoteV4.ts"),
]);
export const LABEL_NOTE = "Built-in Tera label, not proof of ownership or deposit support. Check the full address.";

export function knownAddress(address, chainId = 4663) {
  if (typeof address !== "string" || !ADDRESS.test(address) || !Number.isSafeInteger(chainId)) return null;
  return KNOWN_ADDRESSES.find(entry => entry.chainId === chainId && entry.address === address.toLowerCase()) ?? null;
}
export function knownName(address, chainId = 4663, language = "en") {
  const entry = knownAddress(address, chainId);
  return entry ? (language === "zh" ? entry.zh : entry.name) : "";
}
// Local contact names remain distinct, so naming a router "Mum" never removes
// its built-in identity from a review or a search.
export function addressName(address, { contact = "", chainId = 4663, language = "en" } = {}) {
  return [...new Set([contact, knownName(address, chainId, language)].filter(Boolean))].join(" · ");
}
// Shared foundation for the exchange-deposit warning. No exchange hot wallet
// is assumed to accept deposits on Robinhood Chain. Only add an exchange entry
// with a chain-specific source; an Ethereum label must not be copied here.
export function depositWarning(address, chainId = 4663, language = "en") {
  const entry = knownAddress(address, chainId);
  if (!entry) return "";
  return warningFor(entry, language);
}
export function warningFor(entry, language = "en") {
  if (entry?.category === "exchange") return language === "zh"
    ? "交易所地址：请在交易所内确认充值地址、资产及 Robinhood Chain 网络支持，发送到热钱包可能无法入账。"
    : "Exchange address: confirm the deposit address, asset and Robinhood Chain support inside the exchange. Sending to a hot wallet may not credit your account.";
  if (entry?.category === "token") return language === "zh"
    ? "这是代币合约地址。直接向其发送资产可能造成永久损失。"
    : "This is a token contract. Sending assets directly to it may permanently lose them.";
  if (entry?.category === "bridge" || entry?.category === "protocol") return language === "zh"
    ? "这是协议合约。直接转账不会自动执行兑换或跨链。"
    : "This is a protocol contract. A direct transfer does not execute a swap or bridge.";
  return "";
}
