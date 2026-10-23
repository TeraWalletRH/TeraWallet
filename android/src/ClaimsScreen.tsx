import React, { useState } from "react";
import { View } from "react-native";
import { formatUnits } from "viem";
import { Button, Field, Header, Text, styles as s } from "./ui";
import { parseClaim, type Gift } from "./claims";

export function ClaimsScreen({ gifts, incoming, busy, t, back, create, open, claim, share }: {
  gifts: Gift[]; incoming: string | null; busy: boolean;
  t: (en: string, zh: string) => string; back: () => void;
  create: (amount: string) => void; open: (key: string) => void;
  claim: (key: string) => void; share: (gift: Gift) => void;
}) {
  const [amount, setAmount] = useState("");
  const [pasted, setPasted] = useState("");
  const parsed = parseClaim(pasted);
  return <>
    <Header title={t("Claim links", "领取链接")} onBack={back} backLabel={t("Back", "返回")} />
    <View style={[s.panel, { gap: 10 }]}>
      <Text style={s.text}>{t("Send ETH with a link. Your friend can create a wallet and claim on Robinhood Chain.", "通过链接发送 ETH。朋友可创建钱包并在 Robinhood Chain 领取。")}</Text>
      <Text style={s.small}>{t("Anyone with the link can take its funds, including the sender. Share privately. The claim fee comes from the gift; a small fee reserve stays behind. Keep the link to recover it. Links do not expire. Recovery of sent links requires this device's encrypted data or a saved link, as well as your wallet.", "任何持有链接的人（包括发送者）都可领取，请私下分享。领取手续费从礼物中扣除，少量预留余额会留下。保留链接以取回余额。链接不会过期。恢复已发送链接需要此设备的加密数据或保存的链接以及你的钱包。")}</Text>
    </View>
    {incoming ? <View style={[s.panel, { gap: 10 }]}>
      <Text style={s.label}>{t("A gift for your wallet", "给你钱包的礼物")}</Text>
      <Text style={s.small}>{t("Check its balance and review the exact ETH you will receive. No ETH is needed in your wallet.", "检查余额并审核实际收到的 ETH。你的钱包无需预存 ETH。")}</Text>
      <Button primary disabled={busy} onPress={() => claim(incoming)}>{t("Review claim", "审核领取")}</Button>
    </View> : null}
    <Field label={t("Gift amount in ETH", "礼物金额（ETH）")} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.001" />
    <Button disabled={busy || !amount.trim()} onPress={() => create(amount)}>{t("Create and fund a link", "创建并注资链接")}</Button>
    <Field label={t("Open a claim link", "打开领取链接")} value={pasted} onChangeText={setPasted} autoCapitalize="none" secureTextEntry placeholder="https://terawallet.app/app/#claim=…" />
    {pasted && !parsed ? <Text style={s.small}>{t("Enter a valid Tera claim link for Robinhood Chain.", "请输入有效的 Robinhood Chain Tera 领取链接。")}</Text> : null}
    <Button disabled={!parsed || busy} onPress={() => { if (parsed) { open(parsed); setPasted(""); } }}>{t("Open link", "打开链接")}</Button>
    <Text style={s.label}>{t("Your sent links", "已发送链接")}</Text>
    {!gifts.length ? <Text style={s.small}>{t("No links created yet.", "尚未创建链接。")}</Text> : null}
    {gifts.map(gift => <View key={gift.address} style={[s.panel, { gap: 8 }]}>
      <Text style={s.text}>{formatUnits(BigInt(gift.amount), 18)} ETH</Text>
      <Text style={s.small}>{new Date(gift.createdAt).toLocaleString()}</Text>
      <Text selectable style={s.mono}>{gift.address}</Text>
      <Text style={s.small}>{gift.fundingHash ? t("Funding submitted. Check Activity for confirmation before sharing.", "注资已提交，分享前请在记录中确认。") : t("Saved draft. Check Activity: funding may be pending or not yet sent.", "已保存草稿。请检查记录，注资可能尚未发送或正在处理中。")}</Text>
      <Button disabled={busy} onPress={() => share(gift)}>{t("Share funded link", "分享已注资链接")}</Button>
      <Button disabled={busy} onPress={() => claim(gift.key)}>{t("Check balance / reclaim", "检查余额／取回")}</Button>
    </View>)}
  </>;
}
