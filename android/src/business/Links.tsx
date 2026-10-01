// Payment links: ask for an exact dollar amount, send the link, and see it
// marked paid once the payment is on chain. Tera Business calls them payment
// links; the wallet calls the same thing "Request money" (`personal`), for
// asking a friend rather than invoicing a client.

import * as Clipboard from "expo-clipboard";
import React, { useCallback, useEffect, useState } from "react";
import { Image, Linking, Platform, Pressable, Share, TextInput, View } from "react-native";
import type { Address } from "viem";
import { spend } from "../core";
import { cancelLink, createLink, myLinks, payLinksAvailable, type PayLink } from "../paylinks";
import { Button, colors, Field, Header, Skeleton, styles as s, Text } from "../ui";
import { explorerTx, short } from "./data";
import { linkedEmail } from "./email";

type T = (en: string, zh: string) => string;
type Notice = { title: string; body: string; tone?: "success" | "error" };
export type LinksProps = {
  t: T;
  owner: Address;
  go: (page: string) => void;
  notify: (notice: Notice) => void;
  /** The wallet's "Request money": no business email, friendlier words, back to Home. */
  personal?: boolean;
};

function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  return (
    <View style={[s.panel, { borderRadius: 20, padding: 18, gap: 14 }, style]}>{children}</View>
  );
}

function Action({
  label,
  onPress,
  danger = false,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={6}>
      <Text style={[s.small, { color: danger ? colors.danger : colors.green, fontWeight: "600" }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const STATUS: Record<PayLink["status"], [string, string]> = {
  open: ["Waiting", "待付款"],
  paid: ["Paid", "已付款"],
  cancelled: ["Cancelled", "已取消"],
};

export function LinksScreen({ t, owner, go, notify, personal = false }: LinksProps) {
  const [links, setLinks] = useState<PayLink[] | null>(null);
  // The link whose QR code is open: the one just made, or one picked from the list.
  const [shown, setShown] = useState<PayLink | null>(null);
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      setLinks(await myLinks());
    } catch (e) {
      setLinks([]);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (!payLinksAvailable()) return;
    void load();
    if (personal) return;
    void linkedEmail(owner)
      .then((found) => setEmail(found?.email ?? null))
      .catch(() => setEmail(null));
  }, [load, owner, personal]);

  async function work(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const copy = (link: PayLink) =>
    void Clipboard.setStringAsync(link.link).then(() =>
      notify({
        title: t("Link copied", "链接已复制"),
        body: t(
          `Send it to whoever is paying ${spend.formatDollars(BigInt(link.amount))}.`,
          `发送给需支付 ${spend.formatDollars(BigInt(link.amount))} 的人。`,
        ),
        tone: "success",
      }),
    );

  // The phone's share sheet, or the browser's where it has one; a copy otherwise.
  const share = async (link: PayLink) => {
    const message = link.note
      ? t(
          `Please pay me ${spend.formatDollars(BigInt(link.amount))} for ${link.note}: ${link.link}`,
          `请为「${link.note}」向我支付 ${spend.formatDollars(BigInt(link.amount))}：${link.link}`,
        )
      : t(
          `Please pay me ${spend.formatDollars(BigInt(link.amount))}: ${link.link}`,
          `请向我支付 ${spend.formatDollars(BigInt(link.amount))}：${link.link}`,
        );
    try {
      if (Platform.OS === "web" && !(globalThis as any).navigator?.share) throw new Error("no share sheet");
      await Share.share({ message });
    } catch {
      copy(link);
    }
  };

  const header = (
    <Header
      title={personal ? t("Request money", "收款请求") : t("Payment links", "收款链接")}
      onBack={() => go("home")}
      backLabel={personal ? t("Home", "首页") : t("Dashboard", "概览")}
    />
  );

  if (!payLinksAvailable())
    return (
      <>
        {header}
        <Card>
          <Text style={s.label}>{t("Not switched on yet", "尚未开放")}</Text>
          <Text style={s.small}>
            {personal
              ? t("Requests are not available on this server yet.", "此服务器尚未开放收款请求。")
              : t("Payment links are not available on this server yet.", "此服务器尚未开放收款链接。")}
          </Text>
        </Card>
      </>
    );

  const units = spend.dollarsToUnits(amount);

  return (
    <>
      {header}
      {error ? (
        <View style={s.error}>
          <Text style={s.text}>{error}</Text>
        </View>
      ) : null}
      <Card>
        <Text style={s.label}>{t("Ask to be paid", "发起收款")}</Text>
        <Text style={s.small}>
          {personal
            ? t(
                "Ask a friend for an exact amount. They open the link or scan the code in Tera and pay you in USDG — it shows here as paid once it's on chain.",
                "向朋友请求一个确切金额。对方在 Tera 中打开链接或扫码，用 USDG 向你付款，付款上链后此处显示为已付款。",
              )
            : t(
                "Set an amount in dollars and a note. Whoever opens the link pays exactly that in USDG, to this wallet, from their own Tera — and it shows here as paid once the payment is on chain.",
                "设置美元金额和备注。打开链接的人会用自己的 Tera 向此钱包支付等额 USDG，付款上链后此处显示为已付款。",
              )}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={{ fontSize: 34, fontWeight: "700", color: colors.muted }}>$</Text>
          <TextInput
            value={amount}
            onChangeText={(value) => setAmount(value.replace(",", "."))}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={colors.faint}
            accessibilityLabel={t("Amount in dollars", "美元金额")}
            style={{
              flex: 1,
              color: amount && !units ? colors.danger : colors.ink,
              fontWeight: "700",
              fontSize: 34,
              paddingHorizontal: 6,
            }}
          />
        </View>
        <Field
          label={
            personal
              ? t("What's it for? (they see this)", "用途（对方可见）")
              : t("Note (payers see this)", "备注（付款人可见）")
          }
          value={note}
          onChangeText={setNote}
          maxLength={140}
          autoCapitalize="sentences"
          placeholder={
            personal
              ? t("Pizza on Friday", "周五的披萨")
              : t("Invoice #104 · Logo design", "发票 #104 · 标志设计")
          }
        />
        {!personal && email === null && (
          <Text style={s.small}>
            {t(
              'Payers will see this wallet\'s address and "Unverified merchant". Link your business email so they see it instead.',
              "付款人将看到此钱包地址和“未验证商家”。关联商业邮箱后，他们会看到你的邮箱。",
            )}{" "}
            <Text
              style={[s.small, { color: colors.green, fontWeight: "600" }]}
              onPress={() => go("biz-email")}
            >
              {t("Link email", "关联邮箱")}
            </Text>
          </Text>
        )}
        <Button
          primary
          disabled={busy || !units}
          onPress={() =>
            void work(async () => {
              const made = await createLink(units!, note);
              setAmount("");
              setNote("");
              setLinks((current) => [made, ...(current || [])]);
              setShown(made);
              if (!personal) copy(made);
            })
          }
        >
          {units
            ? personal
              ? t(`Request ${spend.formatDollars(units)}`, `请求 ${spend.formatDollars(units)}`)
              : t(
                  `Create link for ${spend.formatDollars(units)}`,
                  `创建 ${spend.formatDollars(units)} 收款链接`,
                )
            : personal
              ? t("Request", "请求")
              : t("Create link", "创建链接")}
        </Button>
      </Card>
      {shown && shown.status === "open" ? (
        <Card style={{ alignItems: "center" }}>
          <Text style={s.label}>
            {t(
              `Ask for ${spend.formatDollars(BigInt(shown.amount))}`,
              `请求 ${spend.formatDollars(BigInt(shown.amount))}`,
            )}
          </Text>
          {shown.note ? <Text style={[s.small, { textAlign: "center" }]}>{shown.note}</Text> : null}
          {/* White behind the code whatever the theme: a scanner needs the contrast. */}
          <View style={{ backgroundColor: "#ffffff", padding: 14, borderRadius: 18 }}>
            <Image
              accessibilityLabel={t("Payment request QR code", "收款请求二维码")}
              source={{
                uri: `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(shown.link)}`,
              }}
              style={{ width: 200, height: 200 }}
            />
          </View>
          <Text selectable style={[s.small, { textAlign: "center" }]}>
            {shown.link}
          </Text>
          <View style={{ flexDirection: "row", gap: 10, alignSelf: "stretch" }}>
            <View style={{ flex: 1 }}>
              <Button onPress={() => copy(shown)}>{t("Copy link", "复制链接")}</Button>
            </View>
            <View style={{ flex: 1 }}>
              <Button primary onPress={() => void share(shown)}>
                {t("Share", "分享")}
              </Button>
            </View>
          </View>
          <Text style={[s.small, { textAlign: "center" }]}>
            {t(
              "They need Tera to pay it. You'll see it marked paid below.",
              "对方需要使用 Tera 付款。付款后会在下方显示为已付款。",
            )}
          </Text>
        </Card>
      ) : null}
      <Card>
        <View
          style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
        >
          <Text style={s.label}>
            {personal ? t("Your requests", "你的请求") : t("Your links", "你的链接")}
          </Text>
          <Action label={t("Refresh", "刷新")} onPress={() => void work(load)} />
        </View>
        {!links ? (
          <Skeleton width="100%" height={60} borderRadius={12} />
        ) : !links.length ? (
          <Text style={s.small}>
            {personal ? t("No requests yet.", "暂无请求。") : t("No links yet.", "暂无链接。")}
          </Text>
        ) : (
          links.map((link) => (
            <View
              key={link.id}
              style={{ gap: 6, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.line }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
                <Text style={[s.text, { fontWeight: "700" }]}>
                  {spend.formatDollars(BigInt(link.amount))}
                </Text>
                <Text
                  style={[
                    s.small,
                    {
                      fontWeight: "700",
                      color:
                        link.status === "paid"
                          ? colors.green
                          : link.status === "cancelled"
                            ? colors.muted
                            : colors.copper,
                    },
                  ]}
                >
                  {t(...STATUS[link.status])}
                </Text>
              </View>
              {link.note ? <Text style={s.small}>{link.note}</Text> : null}
              <Text style={s.small}>
                {link.status === "paid" && link.payer
                  ? t(
                      `Paid by ${short(link.payer)} · ${new Date(link.paidAt || link.createdAt).toLocaleString()}`,
                      `付款方 ${short(link.payer)} · ${new Date(link.paidAt || link.createdAt).toLocaleString()}`,
                    )
                  : t(
                      `Created ${new Date(link.createdAt).toLocaleString()}`,
                      `创建于 ${new Date(link.createdAt).toLocaleString()}`,
                    )}
              </Text>
              <View style={{ flexDirection: "row", gap: 18, flexWrap: "wrap" }}>
                {link.status === "open" && (
                  <>
                    <Action label={t("Copy link", "复制链接")} onPress={() => copy(link)} />
                    <Action label={t("Show QR", "显示二维码")} onPress={() => setShown(link)} />
                    <Action
                      danger
                      label={t("Cancel", "取消")}
                      onPress={() =>
                        void work(async () => {
                          const closed = await cancelLink(link.id);
                          setLinks((current) =>
                            (current || []).map((entry) =>
                              entry.id === closed.id ? closed : entry,
                            ),
                          );
                          if (shown?.id === closed.id) setShown(null);
                        })
                      }
                    />
                  </>
                )}
                {link.paidTx && (
                  <Action
                    label={t("View payment", "查看付款")}
                    onPress={() => void Linking.openURL(explorerTx(link.paidTx!))}
                  />
                )}
              </View>
            </View>
          ))
        )}
      </Card>
    </>
  );
}
