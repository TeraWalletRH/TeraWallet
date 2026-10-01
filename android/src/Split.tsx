// Split a bill: one total, one payment request per person, followed until paid.
// The sums are core/split.js; the requests are payment links (paylinks.ts).
// Used by the wallet and by Tera Business alike — each keeps its own splits
// in its own encrypted data.

import * as Clipboard from "expo-clipboard";
import React, { useCallback, useEffect, useState } from "react";
import { Image, Platform, Pressable, Share, TextInput, View } from "react-native";
import { spend, split as splitCore } from "./core";
import { cancelLink, createLink, myLinks, payLinksAvailable, type PayLink } from "./paylinks";
import { Button, Choices, colors, Field, Header, Icon, Row, Skeleton, styles as s, Text, Toggle } from "./ui";

type T = (en: string, zh: string) => string;
type Notice = { title: string; body: string; tone?: "success" | "error" };
export type SplitShare = { name: string; amount: string; linkId: string; link: string };
export type SplitRecord = {
  id: string;
  title: string;
  total: string;
  mine: string;
  createdAt: number;
  shares: SplitShare[];
};
export type SplitProps = {
  t: T;
  go: (page: string) => void;
  notify: (notice: Notice) => void;
  splits: SplitRecord[];
  save: (splits: SplitRecord[]) => Promise<void>;
  /** Names the owner already uses, offered as quick picks. */
  suggestions: string[];
};

const dollars = (units: bigint | string) => spend.formatDollars(BigInt(units));

export function SplitScreen({ t, go, notify, splits, save, suggestions }: SplitProps) {
  const [view, setView] = useState<string>("list");
  const [links, setLinks] = useState<Record<string, PayLink> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  // The form.
  const [title, setTitle] = useState("");
  const [total, setTotal] = useState("");
  const [names, setNames] = useState<string[]>([]);
  const [typed, setTyped] = useState("");
  const [includeMe, setIncludeMe] = useState(true);
  const [mode, setMode] = useState<"even" | "custom">("even");
  const [custom, setCustom] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const mine = await myLinks();
      setLinks(Object.fromEntries(mine.map((l) => [l.id, l])));
    } catch (e) {
      setLinks((current) => current || {});
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    if (payLinksAvailable() && splits.length) void load();
  }, [load, splits.length]);

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

  const status = Object.fromEntries(Object.entries(links || {}).map(([id, l]) => [id, l.status]));

  const shareMessage = (split: SplitRecord, share: SplitShare) =>
    t(
      `Hi ${share.name}, your share of ${split.title} is ${dollars(share.amount)}. Pay here: ${share.link}`,
      `${share.name} 你好，「${split.title}」你的份额是 ${dollars(share.amount)}。付款链接：${share.link}`,
    );
  const copy = (text: string) =>
    void Clipboard.setStringAsync(text).then(() =>
      notify({ title: t("Copied", "已复制"), body: t("Ready to paste.", "已可粘贴。"), tone: "success" }),
    );
  const share = async (split: SplitRecord, entry: SplitShare) => {
    const message = shareMessage(split, entry);
    try {
      if (Platform.OS === "web" && !(globalThis as any).navigator?.share) throw new Error("no share sheet");
      await Share.share({ message });
    } catch {
      copy(message);
    }
  };

  const header = (title: string, back: () => void, backLabel: string) => (
    <Header title={title} onBack={back} backLabel={backLabel} />
  );

  if (!payLinksAvailable())
    return (
      <>
        {header(t("Split a bill", "分账"), () => go("home"), t("Home", "首页"))}
        <View style={[s.panel, { gap: 6 }]}>
          <Text style={s.label}>{t("Not switched on yet", "尚未开放")}</Text>
          <Text style={s.small}>
            {t(
              "Splitting needs payment requests, which are not available on this server yet.",
              "分账需要收款请求功能，此服务器尚未开放。",
            )}
          </Text>
        </View>
      </>
    );

  const errorBox = error ? (
    <View style={s.error}>
      <Text style={s.text}>{error}</Text>
    </View>
  ) : null;

  // --- New split --------------------------------------------------------------
  if (view === "new") {
    const totalUnits = spend.dollarsToUnits(total);
    const even = totalUnits ? splitCore.splitEvenly(totalUnits, names.length, includeMe) : null;
    const shares: bigint[] =
      mode === "even"
        ? even?.shares || []
        : names.map((_, i) => spend.dollarsToUnits(custom[i] || "") ?? 0n);
    const verdict = splitCore.check({ title, total: totalUnits ?? 0n, names, shares, includeMe });
    const problem = !verdict.ok
      ? ({
          title: t("Give it a name, like “Dinner at Nobu”.", "请填写名称，例如“周五晚餐”。"),
          total: t("Enter the total, to the cent.", "请输入总金额，精确到分。"),
          people: t("Add who's paying you back.", "请添加需要还款的人。"),
          "too-many": t(`At most ${splitCore.LIMITS.maxPeople} people.`, `最多 ${splitCore.LIMITS.maxPeople} 人。`),
          name: t("Every person needs a name.", "每个人都需要名字。"),
          "same-name": t(`${verdict.name} is on the list twice.`, `${verdict.name} 重复出现。`),
          share: t("Every share must be more than $0.", "每份金额都必须大于 $0。"),
          over: t("The shares add up to more than the total.", "各份合计超过总金额。"),
          short: t(
            `The shares are ${dollars(verdict.missing ?? 0n)} short of the total. Add it to someone, or turn on “I'm paying a share too”.`,
            `各份合计比总金额少 ${dollars(verdict.missing ?? 0n)}。请分配给某人，或开启“我也承担一份”。`,
          ),
        } as Record<string, string>)[verdict.reason ?? ""]
      : "";
    const addName = (name: string) => {
      const clean = splitCore.cleanText(name, splitCore.LIMITS.maxName);
      if (!clean || names.some((n) => n.toLowerCase() === clean.toLowerCase())) return;
      setNames((list) => [...list, clean]);
      setCustom((list) => [...list, ""]);
      setTyped("");
    };
    const removeName = (index: number) => {
      setNames((list) => list.filter((_, i) => i !== index));
      setCustom((list) => list.filter((_, i) => i !== index));
    };
    const picks = suggestions.filter((n) => !names.some((x) => x.toLowerCase() === n.toLowerCase())).slice(0, 8);
    return (
      <>
        {header(t("New split", "新建分账"), () => setView("list"), t("Splits", "分账"))}
        {errorBox}
        <Field
          label={t("What was it?", "这是什么费用？")}
          value={title}
          onChangeText={setTitle}
          maxLength={splitCore.LIMITS.maxTitle}
          autoCapitalize="sentences"
          placeholder={t("Dinner at Nobu", "周五晚餐")}
        />
        <View style={[s.panel, { gap: 6 }]}>
          <Text style={s.eyebrow}>{t("Total bill", "账单总额")}</Text>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={{ fontSize: 34, fontWeight: "700", color: colors.muted }}>$</Text>
            <TextInput
              value={total}
              onChangeText={(value) => setTotal(value.replace(",", "."))}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={colors.faint}
              accessibilityLabel={t("Total in dollars", "美元总额")}
              style={{
                flex: 1,
                color: total && !totalUnits ? colors.danger : colors.ink,
                fontWeight: "700",
                fontSize: 34,
                paddingHorizontal: 6,
              }}
            />
          </View>
        </View>
        <View style={[s.panel, { gap: 12 }]}>
          <Text style={s.eyebrow}>{t("Who's paying you back", "需要还款的人")}</Text>
          <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-end" }}>
            <View style={{ flex: 1 }}>
              <Field
                label={t("Name", "名字")}
                value={typed}
                onChangeText={setTyped}
                maxLength={splitCore.LIMITS.maxName}
                autoCapitalize="words"
                placeholder={t("Ada", "小明")}
                onSubmitEditing={() => addName(typed)}
                returnKeyType="done"
              />
            </View>
            <View style={{ paddingBottom: 2 }}>
              <Button onPress={() => addName(typed)} disabled={!typed.trim()}>
                {t("Add", "添加")}
              </Button>
            </View>
          </View>
          {picks.length ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {picks.map((name) => (
                <Pressable
                  key={name}
                  accessibilityRole="button"
                  onPress={() => addName(name)}
                  style={({ pressed }) => ({
                    paddingHorizontal: 12,
                    minHeight: 32,
                    justifyContent: "center",
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: colors.line,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={[s.small, { color: colors.ink, fontWeight: "600" }]}>{`+ ${name}`}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: includeMe }}
            onPress={() => setIncludeMe((on) => !on)}
            style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
          >
            <Text style={[s.text, { flex: 1 }]}>{t("I'm paying a share too", "我也承担一份")}</Text>
            <Toggle on={includeMe} small />
          </Pressable>
          {names.length ? (
            <Choices
              options={[t("Split evenly", "平均分摊"), t("Custom amounts", "自定义金额")]}
              value={mode === "even" ? t("Split evenly", "平均分摊") : t("Custom amounts", "自定义金额")}
              select={(o) => setMode(o === t("Split evenly", "平均分摊") ? "even" : "custom")}
            />
          ) : null}
          {names.map((name, i) => (
            <View
              key={name}
              style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.line }}
            >
              <Text style={[s.label, { flex: 1 }]} numberOfLines={1}>
                {name}
              </Text>
              {mode === "even" ? (
                <Text style={s.mono}>{even?.shares[i] !== undefined ? dollars(even.shares[i]) : "—"}</Text>
              ) : (
                <TextInput
                  value={custom[i] || ""}
                  onChangeText={(value) =>
                    setCustom((list) => list.map((v, j) => (j === i ? value.replace(",", ".") : v)))
                  }
                  keyboardType="decimal-pad"
                  placeholder="$0.00"
                  placeholderTextColor={colors.faint}
                  accessibilityLabel={t(`${name}'s share`, `${name} 的份额`)}
                  style={[
                    s.mono,
                    {
                      width: 100,
                      textAlign: "right",
                      paddingVertical: 6,
                      paddingHorizontal: 10,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: colors.line,
                      color: colors.ink,
                    },
                  ]}
                />
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t(`Remove ${name}`, `移除 ${name}`)}
                hitSlop={8}
                onPress={() => removeName(i)}
              >
                <Icon name="x" size={16} color={colors.muted} />
              </Pressable>
            </View>
          ))}
          {verdict.ok && includeMe ? (
            <Row label={t("Your share", "你的份额")} value={dollars(verdict.mine ?? 0n)} />
          ) : null}
        </View>
        {problem && (title || total || names.length) ? <Text style={[s.small, { color: colors.danger }]}>{problem}</Text> : null}
        <Button
          primary
          disabled={busy || !verdict.ok}
          onPress={() =>
            void work(async () => {
              const id = `${Date.now()}`;
              const made: SplitShare[] = [];
              const record = (): SplitRecord => ({
                id,
                title: splitCore.cleanText(title, splitCore.LIMITS.maxTitle),
                total: String(totalUnits),
                mine: String(verdict.mine ?? 0n),
                createdAt: Number(id),
                shares: made,
              });
              try {
                for (let i = 0; i < names.length; i++) {
                  const link = await createLink(shares[i], splitCore.requestNote(title, names[i]));
                  made.push({ name: names[i], amount: String(shares[i]), linkId: link.id, link: link.link });
                }
              } finally {
                // Whatever was made is real and kept, even if a later request failed.
                if (made.length) await save([record(), ...splits]);
              }
              setTitle("");
              setTotal("");
              setNames([]);
              setCustom([]);
              setMode("even");
              setView(id);
              void load();
            })
          }
        >
          {verdict.ok
            ? t(`Request from ${names.length} ${names.length === 1 ? "person" : "people"}`, `向 ${names.length} 人发起收款`)
            : t("Create requests", "创建收款请求")}
        </Button>
        <Text style={[s.small, { textAlign: "center" }]}>
          {t(
            "Each person gets their own payment link for their share, paid in USDG with Tera. Names stay on this device.",
            "每人都会收到自己份额的付款链接，用 Tera 以 USDG 支付。名字仅保存在本设备。",
          )}
        </Text>
      </>
    );
  }

  // --- One split --------------------------------------------------------------
  const open = splits.find((x) => x.id === view);
  if (open) {
    const p = splitCore.progress(open, status);
    return (
      <>
        {header(open.title, () => setView("list"), t("Splits", "分账"))}
        {errorBox}
        <View style={[s.panel, { gap: 6, alignItems: "center", paddingVertical: 20 }]}>
          <Text style={[s.label, { fontSize: 24 }]}>{`${dollars(p.collected)} / ${dollars(BigInt(open.total) - BigInt(open.mine))}`}</Text>
          <Text style={s.small}>
            {t(
              `${p.paid} of ${open.shares.length} paid · bill ${dollars(open.total)}${BigInt(open.mine) > 0n ? ` · your share ${dollars(open.mine)}` : ""}`,
              `${open.shares.length} 人中 ${p.paid} 人已付 · 账单 ${dollars(open.total)}${BigInt(open.mine) > 0n ? ` · 你的份额 ${dollars(open.mine)}` : ""}`,
            )}
          </Text>
        </View>
        {open.shares.map((entry) => {
          const link = links?.[entry.linkId];
          const state = link?.status || "open";
          return (
            <View key={entry.linkId} style={[s.panel, { gap: 10 }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Text style={[s.label, { flex: 1 }]} numberOfLines={1}>
                  {entry.name}
                </Text>
                <Text style={s.mono}>{dollars(entry.amount)}</Text>
                <Text
                  style={[
                    s.small,
                    {
                      fontWeight: "700",
                      color: state === "paid" ? colors.green : state === "cancelled" ? colors.muted : colors.copper,
                    },
                  ]}
                >
                  {!links
                    ? "…"
                    : state === "paid"
                      ? t("Paid", "已付款")
                      : state === "cancelled"
                        ? t("Cancelled", "已取消")
                        : t("Waiting", "待付款")}
                </Text>
              </View>
              {state === "paid" && link?.paidAt ? (
                <Text style={s.small}>
                  {t(`Paid ${new Date(link.paidAt).toLocaleString()}`, `付款于 ${new Date(link.paidAt).toLocaleString()}`)}
                </Text>
              ) : null}
              {state === "open" ? (
                <>
                  <View style={{ flexDirection: "row", gap: 18, flexWrap: "wrap" }}>
                    <Pressable accessibilityRole="button" hitSlop={6} onPress={() => void share(open, entry)}>
                      <Text style={[s.small, { color: colors.green, fontWeight: "700" }]}>{t("Send request", "发送请求")}</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" hitSlop={6} onPress={() => copy(entry.link)}>
                      <Text style={[s.small, { color: colors.green, fontWeight: "700" }]}>{t("Copy link", "复制链接")}</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      hitSlop={6}
                      onPress={() => setQr(qr === entry.linkId ? null : entry.linkId)}
                    >
                      <Text style={[s.small, { color: colors.green, fontWeight: "700" }]}>
                        {qr === entry.linkId ? t("Hide QR", "隐藏二维码") : t("Show QR", "显示二维码")}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      hitSlop={6}
                      onPress={() =>
                        void work(async () => {
                          const closed = await cancelLink(entry.linkId);
                          setLinks((current) => ({ ...(current || {}), [closed.id]: closed }));
                        })
                      }
                    >
                      <Text style={[s.small, { color: colors.danger, fontWeight: "700" }]}>{t("Cancel", "取消")}</Text>
                    </Pressable>
                  </View>
                  {qr === entry.linkId ? (
                    <View style={{ alignItems: "center" }}>
                      <View style={{ backgroundColor: "#ffffff", padding: 14, borderRadius: 18 }}>
                        <Image
                          accessibilityLabel={t(`${entry.name}'s payment QR code`, `${entry.name} 的付款二维码`)}
                          source={{
                            uri: `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(entry.link)}`,
                          }}
                          style={{ width: 200, height: 200 }}
                        />
                      </View>
                    </View>
                  ) : null}
                </>
              ) : null}
            </View>
          );
        })}
        <Button onPress={() => void work(load)} disabled={busy}>
          {t("Refresh", "刷新")}
        </Button>
        <Button
          danger
          disabled={busy}
          onPress={() =>
            void work(async () => {
              // Open requests are cancelled first, so a removed split leaves no live links behind.
              for (const entry of open.shares)
                if ((links?.[entry.linkId]?.status || "open") === "open")
                  await cancelLink(entry.linkId).catch(() => {});
              await save(splits.filter((x) => x.id !== open.id));
              setView("list");
            })
          }
        >
          {t("Delete split", "删除分账")}
        </Button>
      </>
    );
  }

  // --- All splits -------------------------------------------------------------
  return (
    <>
      {header(t("Split a bill", "分账"), () => go("home"), t("Home", "首页"))}
      {errorBox}
      <View style={[s.panel, { gap: 6 }]}>
        <Text style={s.small}>
          {t(
            "Paid for everyone? Enter the total and who was there. Each person gets a payment link for their share, and you'll see who has paid.",
            "替大家付了钱？输入总额和参与的人。每人都会收到自己份额的付款链接，你可以看到谁已付款。",
          )}
        </Text>
      </View>
      <Button primary onPress={() => setView("new")}>
        {t("New split", "新建分账")}
      </Button>
      {splits.length && !links ? <Skeleton width="100%" height={60} borderRadius={12} /> : null}
      {splits.map((x) => {
        const p = splitCore.progress(x, status);
        const done = p.open === 0;
        return (
          <Pressable
            key={x.id}
            accessibilityRole="button"
            onPress={() => setView(x.id)}
            style={({ pressed }) => [s.panel, { gap: 4, opacity: pressed ? 0.7 : 1 }]}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Text style={[s.label, { flex: 1 }]} numberOfLines={1}>
                {x.title}
              </Text>
              <Text style={[s.small, { fontWeight: "700", color: done ? colors.green : colors.copper }]}>
                {done ? t("Settled", "已结清") : t(`${p.paid}/${x.shares.length} paid`, `${p.paid}/${x.shares.length} 已付`)}
              </Text>
            </View>
            <Text style={s.small}>
              {t(
                `${dollars(x.total)} · ${new Date(x.createdAt).toLocaleDateString()} · ${dollars(p.collected)} collected`,
                `${dollars(x.total)} · ${new Date(x.createdAt).toLocaleDateString()} · 已收 ${dollars(p.collected)}`,
              )}
            </Text>
          </Pressable>
        );
      })}
    </>
  );
}
