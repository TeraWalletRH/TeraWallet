// Tera Business, on the web.
//
// A business wallet is a second wallet on this device, not a view of the
// personal one: its own secret, its own PIN, its own sealed data (see the
// vault switch in keystore.web.ts). Business money and personal money should
// not share an address — a customer paying the business would otherwise see
// the owner's personal history, and a report would have to filter it out.
//
// Everything the wallet already does — send, receive, swap, lock — runs
// unchanged on the business vault. This file adds what a business needs on
// top: a treasury dashboard across every account, watch-only addresses and
// groups, exportable reports, and getting paid at an email.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Image, Pressable, View } from "react-native";
import { getAddress, isAddress, type Address } from "viem";
import type { Asset } from "./config";
import * as discretion from "../../public/tera/core/discretion.js";
// Named in full: this file only runs on the web, and it needs the web vault's
// switch. Metro resolves both spellings to the same module there.
import * as store from "./keystore.web";
import * as vault from "./storage";
import { notes as notesCore } from "./core";
import {
  amountText,
  CATEGORIES,
  download,
  emptyBook,
  explorerTx,
  loadBook,
  priceAt,
  priceNow,
  printReport,
  readHistory,
  readHoldings,
  saveBook,
  short,
  toCsv,
  usd,
  type Book,
  type Holding,
  type Movement,
  type PriceSource,
} from "./business/data";
import { confirmCode, emailAvailable, linkedEmail, sendCode, unlinkEmail } from "./business/email";
import { LinksScreen } from "./business/Links";
import { TeamScreen } from "./business/Team";
import { inbox, myTeams, teamsAvailable, type Inbox } from "./business/teams";
import {
  Button,
  Choices,
  colors,
  Field,
  Group,
  Header,
  Icon,
  ListRow,
  Skeleton,
  styles as s,
  TeraSpinner,
  Text,
  Toggle,
} from "./ui";

export { loadTeamsConfig, teamsAvailable } from "./business/teams";
export {
  emailAvailable,
  isEmail,
  linkedEmail,
  loadEmailConfig,
  resolveEmail,
} from "./business/email";

export type Mode = store.VaultKind;
export const available = true;
export const mode = (): Mode => store.vaultKind();
/** Lock the open wallet before calling this: the next read comes from the other vault. */
export const setMode = (next: Mode) => store.useVault(next);

// Notes on transactions. In Business they are the notes the Reports screen
// keeps beside each category, so Activity and Reports show the same words.
export const sharesNotesWithReports = true;
export async function loadNotes(): Promise<Record<string, string>> {
  const book = await loadBook();
  return notesCore.cleanNotes(
    Object.fromEntries(Object.entries(book.labels).map(([hash, label]) => [hash, label?.note || ""])),
  );
}
export async function saveNote(hash: string, text: string) {
  const book = await loadBook();
  const key = notesCore.keyFor(hash);
  if (!key) return;
  // Reports may have kept the label under the hash as the explorer wrote it.
  const existing = Object.keys(book.labels).find((h) => h.toLowerCase() === key) || key;
  const current = book.labels[existing] || { category: "", note: "" };
  const note = notesCore.cleanNote(text);
  const labels = { ...book.labels };
  if (!note && !current.category) delete labels[existing];
  else labels[existing] = { ...current, note };
  await saveBook({ ...book, labels });
}

const logoMark = require("../assets/logo-mark.png");

// --- Splash --------------------------------------------------------------------

/** The door into Tera Business: the mark, the name under it, then the wallet. */
export function Splash({ onDone }: { onDone: () => void }) {
  const shown = useRef(new Animated.Value(0)).current;
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const run = Animated.sequence([
      Animated.timing(shown, {
        toValue: 1,
        duration: 520,
        easing: Easing.bezier(0.16, 1, 0.3, 1),
        useNativeDriver: true,
      }),
      Animated.delay(1100),
      Animated.timing(shown, {
        toValue: 2,
        duration: 360,
        easing: Easing.bezier(0.4, 0, 0.7, 0.2),
        useNativeDriver: true,
      }),
    ]);
    run.start(() => done.current());
    return () => run.stop();
  }, [shown]);
  const opacity = shown.interpolate({ inputRange: [0, 1, 2], outputRange: [0, 1, 0] });
  const scale = shown.interpolate({ inputRange: [0, 1, 2], outputRange: [0.86, 1, 1.04] });
  return (
    <View
      accessibilityRole="alert"
      accessibilityLabel="Tera Business"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 50,
        backgroundColor: colors.bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Animated.View style={{ alignItems: "center", gap: 18, opacity, transform: [{ scale }] }}>
        <View
          style={{
            width: 176,
            height: 176,
            borderRadius: 88,
            backgroundColor: colors.tint,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Image source={logoMark} resizeMode="contain" style={{ width: 112, height: 112 }} />
        </View>
        <View style={{ alignItems: "center", gap: 4 }}>
          <Text style={{ color: colors.ink, fontSize: 30, fontWeight: "800", letterSpacing: -0.6 }}>
            Tera
          </Text>
          <Text
            style={{
              color: colors.lime,
              fontSize: 13,
              fontWeight: "700",
              letterSpacing: 4,
              textTransform: "uppercase",
            }}
          >
            Business
          </Text>
        </View>
      </Animated.View>
    </View>
  );
}

// --- Screens -------------------------------------------------------------------

type Account = { index: number; address: string; name: string; active: boolean };
type Notice = { title: string; body: string; tone?: "success" | "error" };
type T = (en: string, zh: string) => string;

export type ScreensProps = {
  page: string;
  go: (page: string) => void;
  t: T;
  wide: boolean;
  owner: Address;
  accounts: Account[];
  assets: Asset[];
  prices: Record<string, number>;
  onFlow: (flow: string) => void;
  onSwitch: (index: number) => Promise<unknown>;
  onAdopt: (address: Address) => Promise<unknown>;
  onAccountsChanged: () => void;
  notify: (notice: Notice) => void;
  /**
   * The wallet's own display settings, passed in rather than read here, so
   * Business and the wallet are one setting seen from two places. A business
   * that hid its figures and then found them showing again on the next screen
   * would have been told something untrue about what is covered.
   */
  privacy: boolean;
  hideSmall: boolean;
  hideSmallThreshold?: number;
  onTogglePrivacy: () => void;
};

export function Screens(props: ScreensProps) {
  if (props.page === "biz-accounts") return <Accounts {...props} />;
  if (props.page === "biz-reports") return <Reports {...props} />;
  if (props.page === "biz-email") return <Email {...props} />;
  if (props.page === "biz-team") return <TeamScreen {...props} />;
  if (props.page === "biz-links") return <LinksScreen {...props} />;
  return <Dashboard {...props} />;
}

const accountName = (t: T, entry: { index: number; name: string }) =>
  entry.name || t(`Account ${entry.index + 1}`, `账户 ${entry.index + 1}`);

/** The book, loaded once per screen and written back on every change. */
function useBook() {
  const [book, setBook] = useState<Book | null>(null);
  useEffect(() => {
    let live = true;
    void loadBook().then((loaded) => live && setBook(loaded));
    return () => {
      live = false;
    };
  }, []);
  async function update(change: (book: Book) => Book) {
    const next = change(book || emptyBook());
    setBook(next);
    await saveBook(next);
    return next;
  }
  return [book, update] as const;
}

function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  return (
    <View style={[s.panel, { borderRadius: 20, padding: 18, gap: 14 }, style]}>{children}</View>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: on ? colors.green : colors.line,
        backgroundColor: on ? colors.tint : "transparent",
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={[s.small, { color: on ? colors.green : colors.muted, fontWeight: "600" }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** The same tile colours as the token list, so a token reads alike everywhere. */
const TILE = [
  colors.green,
  colors.lime,
  colors.copper,
  "#6f8fa8",
  "#a07cc0",
  "#5fa38a",
  colors.muted,
];

// --- Dashboard ---------------------------------------------------------------------

function Dashboard({
  t,
  wide,
  owner,
  accounts,
  assets,
  prices,
  go,
  onFlow,
  onSwitch,
  notify,
  privacy,
  hideSmall,
  hideSmallThreshold,
  onTogglePrivacy,
}: ScreensProps) {
  const [book, updateBook] = useBook();
  const [holdings, setHoldings] = useState<Holding[] | null>(null);
  // Revealing the small ones is for the look being taken now, so it is not
  // stored the way the setting itself is.
  const [showSmall, setShowSmall] = useState(false);
  const [moves, setMoves] = useState<Movement[] | null>(null);
  const [group, setGroup] = useState("");
  const [email, setEmail] = useState<{ email: string; name: string } | null>(null);
  const [reload, setReload] = useState(0);
  const [waiting, setWaiting] = useState<Inbox | null>(null);

  // What the team queues need from this account, across every team.
  useEffect(() => {
    if (!teamsAvailable()) return;
    let live = true;
    void inbox()
      .then((found) => live && setWaiting(found))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [owner, reload]);
  const key = accounts.map((a) => a.address).join() + "|" + assets.map((a) => a.symbol).join();

  useEffect(() => {
    if (!book) return;
    let live = true;
    const owned = accounts.map((a) => ({
      address: a.address as Address,
      name: accountName(t, a),
      group: book.groups[a.address.toLowerCase()] || "",
      watched: false,
    }));
    const watched = book.watch.map((w) => ({ ...w, watched: true }));
    setHoldings(null);
    // Team treasuries this account belongs to count as holdings too. They are
    // read-only here: spending from one goes through the Team screen's approvals.
    const teams = teamsAvailable()
      ? myTeams()
          .then((list) =>
            list
              .filter((team) => team.status === "active")
              .map((team) => ({
                address: team.safe,
                name: team.name || t("Team treasury", "团队资金库"),
                group: t("Team", "团队"),
                watched: false,
                team: true,
              })),
          )
          .catch(() => [])
      : Promise.resolve([]);
    void teams
      .then((treasuries) => readHoldings([...owned, ...watched, ...treasuries], assets, prices))
      .then((found) => live && setHoldings(found));
    const since = Date.now() - 30 * 86_400_000;
    void Promise.all(owned.map((a) => readHistory(a.address, since, 2).catch(() => [])))
      .then((lists) => live && setMoves(lists.flat().sort((a, b) => b.timestamp - a.timestamp)))
      .catch(() => live && setMoves([]));
    return () => {
      live = false;
    };
    // Prices are applied at render, so a price refresh does not re-read the chain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, book?.watch.length, reload, !!book]);

  useEffect(() => {
    if (!emailAvailable()) return;
    let live = true;
    void linkedEmail(owner)
      .then((found) => live && setEmail(found))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [owner]);

  const groups = useMemo(
    () => [...new Set((holdings || []).map((h) => h.group).filter(Boolean))].sort(),
    [holdings],
  );
  const shown = (holdings || []).filter(
    (h) => (!group || h.group === group) && (book?.includeWatched !== false || !h.watched),
  );
  const valueOf = (h: Holding) =>
    Object.entries(h.tokens).reduce(
      (sum, [symbol, amount]) => sum + amount * priceNow(symbol, prices),
      0,
    );
  const total = shown.reduce((sum, h) => sum + valueOf(h), 0);
  const byToken = new Map<string, { amount: number; value: number }>();
  for (const h of shown)
    for (const [symbol, amount] of Object.entries(h.tokens)) {
      const entry = byToken.get(symbol) || { amount: 0, value: 0 };
      entry.amount += amount;
      entry.value += amount * priceNow(symbol, prices);
      byToken.set(symbol, entry);
    }
  /** A figure as the owner asked to see it. Never used where they sign. */
  const cover = (text: string) => discretion.conceal(text, { on: privacy });
  const allTokens = [...byToken.entries()].sort((a, b) => b[1].value - a[1].value);
  // Same rules as the wallet, from core/discretion.js. The total above is
  // deliberately built from every holding, hidden or not: a treasury figure
  // that quietly left positions out would be wrong, not tidy.
  const smallSplit = discretion.partitionSmall(
    allTokens.map(([symbol, entry]) => ({
      symbol,
      entry,
      value: priceNow(symbol, prices) ? entry.value : null,
    })),
    { on: hideSmall, threshold: hideSmallThreshold },
  );
  const tokens: [string, { amount: number; value: number }][] = (
    showSmall ? allTokens.map(([symbol, entry]) => ({ symbol, entry })) : smallSplit.shown
  ).map((row) => [row.symbol, row.entry]);
  const top = allTokens[0];
  const concentrated = top && total > 0 && top[1].value / total > 0.6 ? top : null;
  const unpriced = allTokens
    .filter(([symbol]) => !priceNow(symbol, prices))
    .map(([symbol]) => symbol);

  const ownSet = new Set(accounts.map((a) => a.address.toLowerCase()));
  const external = (moves || []).filter(
    (m) => !ownSet.has(m.counterparty.toLowerCase()) && !m.failed,
  );
  const inflow = external
    .filter((m) => m.direction === "in")
    .reduce((sum, m) => sum + m.amount * priceNow(m.symbol, prices), 0);
  const outflow = external
    .filter((m) => m.direction === "out")
    .reduce((sum, m) => sum + m.amount * priceNow(m.symbol, prices), 0);
  const nameOf = (address: string) => {
    const found = accounts.find((a) => a.address.toLowerCase() === address.toLowerCase());
    return found ? accountName(t, found) : short(address);
  };
  const title = email?.name || t("Treasury", "资金库");

  const hero = (
    <Card style={{ padding: 22, gap: 16, backgroundColor: colors.tint }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={s.eyebrow}>{t("Tera Business", "Tera 商业版")}</Text>
          <Text style={[s.text, { fontSize: 18, fontWeight: "700" }]} numberOfLines={1}>
            {title}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Refresh", "刷新")}
          onPress={() => setReload((n) => n + 1)}
          hitSlop={8}
          style={s.iconDisc}
        >
          <Icon name="refresh-cw" size={17} color={colors.ink} />
        </Pressable>
      </View>
      <View style={{ gap: 4 }}>
        {/* The eye sits on the figure it covers, for the same reason it does
            on the wallet: this is reached because somebody has walked up, and
            a control in a settings screen has already lost that moment. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            privacy ? t("Show figures", "显示金额") : t("Hide figures", "隐藏金额")
          }
          onPress={onTogglePrivacy}
          hitSlop={10}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            alignSelf: "flex-start",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text style={s.small}>{t("Total holdings", "总持仓")}</Text>
          <Icon name={privacy ? "eye-off" : "eye"} size={14} color={colors.muted} />
        </Pressable>
        {holdings ? (
          <Text
            style={{
              color: colors.ink,
              fontSize: 40,
              lineHeight: 48,
              fontWeight: "800",
              letterSpacing: -1,
            }}
          >
            {cover(usd(total))}
          </Text>
        ) : (
          <Skeleton width={200} height={44} borderRadius={10} />
        )}
        <Text style={s.small}>
          {t(
            `${accounts.length} held · ${book?.watch.length || 0} watched${unpriced.length ? ` · no price for ${unpriced.join(", ")}` : ""}`,
            `${accounts.length} 个持有 · ${book?.watch.length || 0} 个观察${unpriced.length ? ` · 缺少价格：${unpriced.join("、")}` : ""}`,
          )}
        </Text>
      </View>
      {book && book.watch.length > 0 ? (
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: book.includeWatched }}
          onPress={() => void updateBook((b) => ({ ...b, includeWatched: !b.includeWatched }))}
          style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
        >
          <Text style={[s.small, { color: colors.ink }]}>
            {t("Count watch-only addresses", "计入仅观察地址")}
          </Text>
          <Toggle on={book.includeWatched} small />
        </Pressable>
      ) : null}
    </Card>
  );

  const actions = (
    <View style={s.quickActions}>
      {(
        [
          ["arrow-top-right", "Send", "发送", () => onFlow("send")],
          ["arrow-down", "Receive", "收款", () => onFlow("receive")],
          ["layers", "Batch send", "批量发送", () => onFlow("batch")],
          ["link", "Links", "链接", () => go("biz-links")],
          ["shield-check", "Team", "团队", () => go("biz-team")],
          ["users", "Accounts", "账户", () => go("biz-accounts")],
          ["file-down", "Reports", "报表", () => go("biz-reports")],
        ] as const
      ).map(([icon, en, zh, press]) => (
        <Pressable
          key={en}
          accessibilityRole="button"
          onPress={press}
          style={({ pressed }) => [s.quickAction, { opacity: pressed ? 0.6 : 1 }]}
        >
          <View style={s.quickIcon}>
            <Icon name={icon} color={colors.lime} size={22} />
          </View>
          <Text style={[s.small, { color: colors.ink }]}>{t(en, zh)}</Text>
        </Pressable>
      ))}
    </View>
  );

  const allocation = (
    <Card>
      <Text style={[s.text, { fontWeight: "700" }]}>{t("Allocation", "资产分布")}</Text>
      {!holdings ? (
        <Skeleton width="100%" height={12} borderRadius={6} />
      ) : !tokens.length ? (
        <Text style={s.small}>{t("Nothing held yet.", "暂无持仓。")}</Text>
      ) : (
        <>
          <View
            style={{
              flexDirection: "row",
              height: 12,
              borderRadius: 6,
              overflow: "hidden",
              backgroundColor: colors.raised,
            }}
          >
            {tokens.map(([symbol, entry], i) =>
              total > 0 && entry.value > 0 ? (
                <View
                  key={symbol}
                  style={{
                    flex: entry.value / total,
                    backgroundColor: TILE[Math.min(i, TILE.length - 1)],
                  }}
                />
              ) : null,
            )}
          </View>
          {tokens.map(([symbol, entry], i) => (
            <View key={symbol} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: TILE[Math.min(i, TILE.length - 1)],
                }}
              />
              <Text style={[s.label, { flex: 1 }]}>{symbol}</Text>
              <Text style={[s.small, { minWidth: 90, textAlign: "right" }]}>
                {cover(amountText(entry.amount))}
              </Text>
              <Text style={[s.text, { minWidth: 96, textAlign: "right", fontWeight: "600" }]}>
                {priceNow(symbol, prices) ? cover(usd(entry.value)) : "—"}
              </Text>
              <Text style={[s.small, { width: 44, textAlign: "right" }]}>
                {total > 0 ? `${Math.round((entry.value / total) * 100)}%` : "—"}
              </Text>
            </View>
          ))}
          {smallSplit.hidden.length ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setShowSmall((on) => !on)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingTop: 4,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text style={[s.small, { flex: 1 }]}>
                {t(
                  discretion.hiddenNote(smallSplit.hidden, {
                    formatted: cover(usd(smallSplit.hiddenValue ?? 0)),
                  }),
                  `已隐藏 ${smallSplit.hidden.length} 项小额余额`,
                )}
              </Text>
              <Text style={[s.small, { color: colors.green }]}>
                {showSmall ? t("Hide", "隐藏") : t("Show", "显示")}
              </Text>
            </Pressable>
          ) : null}
          {concentrated ? (
            <View
              style={{
                flexDirection: "row",
                gap: 8,
                alignItems: "flex-start",
                padding: 12,
                borderRadius: 12,
                backgroundColor: colors.warnTint,
              }}
            >
              <Icon name="triangle-alert" size={16} color={colors.yellow} />
              <Text style={[s.small, { flex: 1, color: colors.ink }]}>
                {t(
                  `${Math.round((concentrated[1].value / total) * 100)}% of these holdings are in ${concentrated[0]}.`,
                  `这些持仓中 ${Math.round((concentrated[1].value / total) * 100)}% 为 ${concentrated[0]}。`,
                )}
              </Text>
            </View>
          ) : null}
        </>
      )}
    </Card>
  );

  const accountList = (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={[s.text, { fontWeight: "700" }]}>{t("Accounts", "账户")}</Text>
        <Pressable accessibilityRole="button" onPress={() => go("biz-accounts")} hitSlop={8}>
          <Text style={[s.small, { color: colors.green, fontWeight: "600" }]}>
            {t("Manage", "管理")}
          </Text>
        </Pressable>
      </View>
      {groups.length ? (
        <View style={s.wrap}>
          <Chip label={t("All", "全部")} on={!group} onPress={() => setGroup("")} />
          {groups.map((g) => (
            <Chip
              key={g}
              label={g}
              on={group === g}
              onPress={() => setGroup(group === g ? "" : g)}
            />
          ))}
        </View>
      ) : null}
      {!holdings
        ? [0, 1].map((i) => <Skeleton key={i} width="100%" height={44} borderRadius={12} />)
        : shown.map((h) => {
            const held = accounts.find((a) => a.address.toLowerCase() === h.address.toLowerCase());
            const value = valueOf(h);
            return (
              <Pressable
                key={h.address}
                accessibilityRole={held || h.team ? "button" : undefined}
                disabled={(!held || held.active) && !h.team}
                onPress={() =>
                  h.team
                    ? go("biz-team")
                    : held &&
                      void onSwitch(held.index).then(() =>
                        notify({
                          title: t("Account switched", "已切换账户"),
                          body: t(
                            `Payments you send now come from ${accountName(t, held)}.`,
                            `现在从 ${accountName(t, held)} 付款。`,
                          ),
                          tone: "success",
                        }),
                      )
                }
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingVertical: 6,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <View style={[s.iconDisc, held?.active && { backgroundColor: colors.tint }]}>
                  <Icon
                    name={h.team ? "shield-check" : h.watched ? "eye" : "wallet-outline"}
                    size={18}
                    color={held?.active ? colors.green : colors.muted}
                  />
                </View>
                <View style={{ flex: 1, gap: 1 }}>
                  <Text style={s.label} numberOfLines={1}>
                    {h.name || short(h.address)}
                  </Text>
                  <Text style={s.small} numberOfLines={1}>
                    {[
                      held?.active
                        ? t("Paying from", "付款账户")
                        : h.watched
                          ? t("Watch-only", "仅观察")
                          : "",
                      h.group,
                      short(h.address),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={[s.text, { fontWeight: "600" }]}>{h.failed ? "—" : usd(value)}</Text>
                  <Text style={s.small}>
                    {total > 0 && !h.failed ? `${Math.round((value / total) * 100)}%` : ""}
                  </Text>
                </View>
              </Pressable>
            );
          })}
    </Card>
  );

  const flow = (
    <Card>
      <Text style={[s.text, { fontWeight: "700" }]}>{t("Last 30 days", "最近 30 天")}</Text>
      {!moves ? (
        <Skeleton width="100%" height={40} borderRadius={10} />
      ) : (
        <>
          <View style={{ flexDirection: "row", gap: 10 }}>
            {(
              [
                [t("In", "流入"), inflow, colors.green],
                [t("Out", "流出"), outflow, colors.copper],
                [t("Net", "净额"), inflow - outflow, colors.ink],
              ] as const
            ).map(([label, value, tone]) => (
              <View
                key={label}
                style={{
                  flex: 1,
                  gap: 2,
                  padding: 12,
                  borderRadius: 14,
                  backgroundColor: colors.raised,
                }}
              >
                <Text style={s.small}>{label}</Text>
                <Text style={[s.text, { fontWeight: "700", color: tone }]} numberOfLines={1}>
                  {usd(value)}
                </Text>
              </View>
            ))}
          </View>
          <Text style={s.small}>
            {t(
              "At today's prices. Moves between your own accounts are left out. Reports price each payment on its day.",
              "按今日价格计算，不含自有账户之间的转账。报表会按当日价格计价。",
            )}
          </Text>
        </>
      )}
    </Card>
  );

  const recent = (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={[s.text, { fontWeight: "700" }]}>{t("Recent activity", "最近活动")}</Text>
        <Pressable accessibilityRole="button" onPress={() => go("biz-reports")} hitSlop={8}>
          <Text style={[s.small, { color: colors.green, fontWeight: "600" }]}>
            {t("Reports", "报表")}
          </Text>
        </Pressable>
      </View>
      {!moves ? (
        [0, 1, 2].map((i) => <Skeleton key={i} width="100%" height={36} borderRadius={10} />)
      ) : !moves.length ? (
        <Text style={s.small}>{t("Nothing in the last 30 days.", "最近 30 天没有活动。")}</Text>
      ) : (
        moves
          .filter((m) => m.direction !== "fee")
          .slice(0, 8)
          .map((m) => (
            <View
              key={`${m.hash}-${m.account}-${m.symbol}-${m.direction}`}
              style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
            >
              <View style={s.iconDisc}>
                <Icon
                  name={m.direction === "in" ? "arrow-down-left" : "arrow-top-right"}
                  size={17}
                  color={m.direction === "in" ? colors.green : colors.copper}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.label} numberOfLines={1}>
                  {m.direction === "in"
                    ? t(`From ${nameOf(m.counterparty)}`, `来自 ${nameOf(m.counterparty)}`)
                    : t(`To ${nameOf(m.counterparty)}`, `发往 ${nameOf(m.counterparty)}`)}
                </Text>
                <Text style={s.small} numberOfLines={1}>
                  {`${nameOf(m.account)} · ${new Date(m.timestamp).toLocaleDateString()}`}
                </Text>
              </View>
              <Text
                style={[
                  s.text,
                  { fontWeight: "600", color: m.direction === "in" ? colors.green : colors.ink },
                ]}
              >
                {`${m.direction === "in" ? "+" : "−"}${amountText(m.amount)} ${m.symbol}`}
              </Text>
            </View>
          ))
      )}
    </Card>
  );

  const needs = (waiting?.teams || []).filter((team) => team.approvals || team.toSend);
  const inboxCard =
    waiting && (needs.length || waiting.invites.length) ? (
      <Pressable accessibilityRole="button" onPress={() => go("biz-team")}>
        <Card style={{ gap: 10, borderWidth: 1, borderColor: colors.lime }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Icon name="shield-check" size={18} color={colors.lime} />
            <Text style={[s.label, { flex: 1 }]}>{t("Waiting for you", "待你处理")}</Text>
            <Icon name="chevron-right" size={20} color={colors.faint} />
          </View>
          {needs.map((team) => (
            <Text key={team.safe} style={[s.small, { color: colors.ink }]}>
              {`${team.name || short(team.safe)}: ${[
                team.approvals
                  ? t(`${team.approvals} to approve`, `${team.approvals} 项待批准`)
                  : "",
                team.toSend ? t(`${team.toSend} ready to send`, `${team.toSend} 项可发送`) : "",
              ]
                .filter(Boolean)
                .join(" · ")}`}
            </Text>
          ))}
          {waiting.invites.map((invite) => (
            <Text key={invite.safe} style={[s.small, { color: colors.ink }]}>
              {t(
                `Invitation to ${invite.name || short(invite.safe)}`,
                `来自 ${invite.name || short(invite.safe)} 的邀请`,
              )}
            </Text>
          ))}
        </Card>
      </Pressable>
    ) : null;

  const emailCard =
    emailAvailable() && !email ? (
      <Pressable accessibilityRole="button" onPress={() => go("biz-email")}>
        <Card style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <View style={[s.iconDisc, { backgroundColor: colors.tint }]}>
            <Icon name="mail" size={18} color={colors.green} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={s.label}>{t("Get paid at your email", "用邮箱收款")}</Text>
            <Text style={s.small}>
              {t(
                "Customers type your business email instead of an address.",
                "客户输入你的商业邮箱即可付款，无需地址。",
              )}
            </Text>
          </View>
          <Icon name="chevron-right" size={20} color={colors.faint} />
        </Card>
      </Pressable>
    ) : null;

  if (wide)
    return (
      <View style={{ flexDirection: "row", gap: 28, alignItems: "flex-start" }}>
        <View style={{ flex: 6, minWidth: 0, gap: 22 }}>
          {hero}
          {actions}
          {allocation}
          {flow}
        </View>
        <View style={{ flex: 5, minWidth: 0, gap: 22 }}>
          {inboxCard}
          {emailCard}
          {accountList}
          {recent}
        </View>
      </View>
    );
  return (
    <>
      {hero}
      {actions}
      {inboxCard}
      {emailCard}
      {accountList}
      {allocation}
      {flow}
      {recent}
    </>
  );
}

// --- Accounts ------------------------------------------------------------------

function Accounts({ t, accounts, go, onSwitch, onAdopt, onAccountsChanged, notify }: ScreensProps) {
  const [book, updateBook] = useBook();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [group, setGroup] = useState("");
  const [adding, setAdding] = useState(false);
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const groups = [
    ...new Set(
      [...Object.values(book?.groups || {}), ...(book?.watch || []).map((w) => w.group)].filter(
        Boolean,
      ),
    ),
  ].sort();

  const open = (key: string, currentName: string, currentGroup: string) => {
    setAdding(false);
    setError("");
    setEditing(editing === key ? null : key);
    setName(currentName);
    setGroup(currentGroup);
  };
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  const groupPicker = (
    <View style={{ gap: 8 }}>
      <Field
        label={t("Group", "分组")}
        value={group}
        placeholder={t("e.g. Payroll, Reserves, Client A", "例如：工资、储备、客户 A")}
        maxLength={30}
        onChangeText={setGroup}
      />
      {groups.length ? (
        <View style={s.wrap}>
          {groups.map((g) => (
            <Chip
              key={g}
              label={g}
              on={group === g}
              onPress={() => setGroup(group === g ? "" : g)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );

  return (
    <>
      <Header
        title={t("Accounts", "账户")}
        onBack={() => go("home")}
        backLabel={t("Dashboard", "概览")}
      />
      <Text style={s.small}>
        {t(
          "Held accounts come from this business wallet's recovery phrase and can send. Watch-only addresses are shown on the dashboard and in reports, but nothing here can spend from them.",
          "持有账户来自此商业钱包的助记词，可以付款。仅观察地址会显示在概览和报表中，但无法从中付款。",
        )}
      </Text>
      {error ? (
        <View style={s.error}>
          <Text style={s.text}>{error}</Text>
        </View>
      ) : null}
      <Group title={t("Held", "持有")}>
        {accounts.map((a) => {
          const key = a.address;
          const currentGroup = book?.groups[a.address.toLowerCase()] || "";
          return (
            <View key={key} style={{ gap: 12, paddingBottom: editing === key ? 14 : 0 }}>
              <ListRow
                icon="wallet-outline"
                label={accountName(t, a)}
                detail={[
                  a.active ? t("Paying from", "付款账户") : "",
                  currentGroup,
                  short(a.address),
                ]
                  .filter(Boolean)
                  .join(" · ")}
                onPress={() => open(key, a.name, currentGroup)}
                right={
                  <Icon
                    name={editing === key ? "chevron-down" : "pencil-outline"}
                    size={18}
                    color={colors.faint}
                  />
                }
              />
              {editing === key ? (
                <>
                  <Field
                    label={t("Name", "名称")}
                    value={name}
                    maxLength={vault.MAX_NAME}
                    onChangeText={setName}
                  />
                  {groupPicker}
                  <Button
                    primary
                    disabled={busy}
                    onPress={() =>
                      void (async () => {
                        setBusy(true);
                        setError("");
                        try {
                          await vault.renameAccount(a.index, name);
                          const trimmed = group.trim();
                          await updateBook((b) => {
                            const next = { ...b.groups };
                            if (trimmed) next[a.address.toLowerCase()] = trimmed;
                            else delete next[a.address.toLowerCase()];
                            return { ...b, groups: next };
                          });
                          onAccountsChanged();
                          setEditing(null);
                        } catch (e) {
                          fail(e);
                        } finally {
                          setBusy(false);
                        }
                      })()
                    }
                  >
                    {t("Save", "保存")}
                  </Button>
                  {!a.active ? (
                    <Button
                      onPress={() =>
                        void onSwitch(a.index)
                          .then(() => setEditing(null))
                          .catch(fail)
                      }
                    >
                      {t("Pay from this account", "从此账户付款")}
                    </Button>
                  ) : null}
                </>
              ) : null}
            </View>
          );
        })}
        {vault.hasPhrase() ? (
          <ListRow
            icon="plus"
            label={t("Add an account", "新增账户")}
            detail={t("The next account from this wallet's phrase", "来自此钱包助记词的下一个账户")}
            disabled={busy}
            onPress={() =>
              void (async () => {
                setBusy(true);
                setError("");
                try {
                  const next = (await vault.addAccount()) as Address;
                  await onAdopt(next);
                  notify({
                    title: t("Account added", "已新增账户"),
                    body: t("It is now the account you pay from.", "它现在是你的付款账户。"),
                    tone: "success",
                  });
                } catch (e) {
                  fail(e);
                } finally {
                  setBusy(false);
                }
              })()
            }
          />
        ) : null}
      </Group>
      <Group title={t("Watch-only", "仅观察")}>
        {(book?.watch || []).map((w) => {
          const key = `watch:${w.address}`;
          return (
            <View key={key} style={{ gap: 12, paddingBottom: editing === key ? 14 : 0 }}>
              <ListRow
                icon="eye"
                label={w.name || short(w.address)}
                detail={[w.group, short(w.address)].filter(Boolean).join(" · ")}
                onPress={() => open(key, w.name, w.group)}
                right={
                  <Icon
                    name={editing === key ? "chevron-down" : "pencil-outline"}
                    size={18}
                    color={colors.faint}
                  />
                }
              />
              {editing === key ? (
                <>
                  <Field
                    label={t("Name", "名称")}
                    value={name}
                    maxLength={40}
                    onChangeText={setName}
                  />
                  {groupPicker}
                  <Button
                    primary
                    onPress={() =>
                      void updateBook((b) => ({
                        ...b,
                        watch: b.watch.map((x) =>
                          x.address === w.address
                            ? { ...x, name: name.trim(), group: group.trim() }
                            : x,
                        ),
                      }))
                        .then(() => setEditing(null))
                        .catch(fail)
                    }
                  >
                    {t("Save", "保存")}
                  </Button>
                  <Button
                    danger
                    onPress={() =>
                      void updateBook((b) => ({
                        ...b,
                        watch: b.watch.filter((x) => x.address !== w.address),
                      }))
                        .then(() => setEditing(null))
                        .catch(fail)
                    }
                  >
                    {t("Stop watching", "停止观察")}
                  </Button>
                </>
              ) : null}
            </View>
          );
        })}
        <View style={{ gap: 12, paddingBottom: adding ? 14 : 0 }}>
          <ListRow
            icon="plus"
            label={t("Watch an address", "观察地址")}
            detail={t(
              "A treasury, cold wallet or client wallet you do not hold here",
              "你未在此持有的资金库、冷钱包或客户钱包",
            )}
            onPress={() => {
              setEditing(null);
              setError("");
              setAdding(!adding);
              setAddress("");
              setName("");
              setGroup("");
            }}
          />
          {adding ? (
            <>
              <Field
                label={t("Address", "地址")}
                value={address}
                placeholder="0x…"
                onChangeText={setAddress}
              />
              <Field label={t("Name", "名称")} value={name} maxLength={40} onChangeText={setName} />
              {groupPicker}
              <Button
                primary
                onPress={() => {
                  const typed = address.trim();
                  if (!isAddress(typed, { strict: false }))
                    return setError(
                      t(
                        "Enter a valid Robinhood Chain address.",
                        "请输入有效的 Robinhood Chain 地址。",
                      ),
                    );
                  const checksummed = getAddress(typed);
                  if (accounts.some((a) => a.address.toLowerCase() === checksummed.toLowerCase()))
                    return setError(
                      t(
                        "That address is already one of your held accounts.",
                        "该地址已是你的持有账户。",
                      ),
                    );
                  if (book?.watch.some((w) => w.address === checksummed))
                    return setError(t("You already watch that address.", "你已在观察该地址。"));
                  void updateBook((b) => ({
                    ...b,
                    watch: [
                      ...b.watch,
                      { address: checksummed, name: name.trim(), group: group.trim() },
                    ],
                  }))
                    .then(() => {
                      setAdding(false);
                      setError("");
                    })
                    .catch(fail);
                }}
              >
                {t("Watch address", "观察地址")}
              </Button>
            </>
          ) : null}
        </View>
      </Group>
    </>
  );
}

// --- Reports -------------------------------------------------------------------

type Line = Movement & {
  accountName: string;
  price: number;
  value: number;
  source: PriceSource;
  internal: boolean;
};

const PERIODS = [
  ["30 days", "30 天", 30],
  ["90 days", "90 天", 90],
  ["This year", "今年", -1],
  ["12 months", "12 个月", 365],
] as const;

function periodStart(days: number) {
  if (days > 0) return Date.now() - days * 86_400_000;
  const now = new Date();
  return new Date(now.getFullYear(), 0, 1).getTime();
}

function Reports({ t, wide, accounts, prices, go }: ScreensProps) {
  const [book, updateBook] = useBook();
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>(PERIODS[0]);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const everyone = [
    ...accounts.map((a) => ({
      address: a.address as Address,
      name: accountName(t, a),
      watched: false,
    })),
    ...(book?.watch || []).map((w) => ({
      address: w.address,
      name: w.name || short(w.address),
      watched: true,
    })),
  ];
  const chosen = picked || new Set(accounts.map((a) => a.address));
  const own = new Set(everyone.map((e) => e.address.toLowerCase()));
  const labelOf = (line: Line) =>
    book?.labels[line.hash] || { category: line.internal ? "Internal transfer" : "", note: "" };

  async function build() {
    setBusy(true);
    setError("");
    setLines(null);
    setOpen(null);
    try {
      const since = periodStart(period[2]);
      const targets = everyone.filter((e) => chosen.has(e.address));
      const moves = (
        await Promise.all(targets.map((e) => readHistory(e.address, since, 12)))
      ).flat();
      const priced = await Promise.all(
        moves.map(async (m) => {
          const { price, source } = m.amount
            ? await priceAt(m.symbol, m.timestamp, prices)
            : { price: 0, source: "none" as const };
          return {
            ...m,
            accountName: targets.find((e) => e.address === m.account)?.name || short(m.account),
            price,
            value: m.amount * price,
            source,
            internal: own.has(m.counterparty.toLowerCase()),
          };
        }),
      );
      setLines(priced.sort((a, b) => b.timestamp - a.timestamp));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const ethPrice = priceNow("ETH", prices);
  const external = (lines || []).filter((l) => !l.internal && !l.failed);
  const inflow = external.filter((l) => l.direction === "in").reduce((sum, l) => sum + l.value, 0);
  const outflow = external
    .filter((l) => l.direction === "out")
    .reduce((sum, l) => sum + l.value, 0);
  const fees = (lines || []).reduce((sum, l) => sum + l.fee, 0);
  const notPriced = (lines || []).filter((l) => l.amount && l.source === "none").length;
  const atToday = (lines || []).filter((l) => l.source === "current").length;
  const range = `${new Date(periodStart(period[2])).toLocaleDateString()} – ${new Date().toLocaleDateString()}`;

  const table = () => [
    [
      "Date",
      "Account",
      "Account address",
      "Direction",
      "Asset",
      "Amount",
      "Price (USD)",
      "Value (USD)",
      "Price source",
      "Fee (ETH)",
      "Counterparty",
      "Category",
      "Note",
      "Status",
      "Transaction hash",
      "Explorer",
    ],
    ...(lines || []).map((l) => {
      const label = labelOf(l);
      return [
        new Date(l.timestamp).toISOString(),
        l.accountName,
        l.account,
        l.direction === "in" ? "In" : l.direction === "out" ? "Out" : "Fee only",
        l.symbol,
        l.direction === "fee" ? "" : String(l.amount),
        l.price ? l.price.toFixed(6) : "",
        l.value ? l.value.toFixed(2) : "",
        {
          fixed: "Stablecoin",
          historical: "Price on the day",
          current: "Today's price",
          none: "No price",
        }[l.source],
        l.fee ? l.fee.toFixed(10).replace(/0+$/, "") : "",
        l.counterparty,
        label.category,
        label.note,
        l.failed ? "Failed" : "Confirmed",
        l.hash,
        explorerTx(l.hash),
      ];
    }),
  ];
  const fileName = `tera-business-${new Date().toISOString().slice(0, 10)}`;
  const summary: [string, string][] = [
    [t("Period", "期间"), range],
    [
      t("Accounts", "账户"),
      everyone
        .filter((e) => chosen.has(e.address))
        .map((e) => e.name)
        .join(", "),
    ],
    [t("Money in", "流入"), usd(inflow)],
    [t("Money out", "流出"), usd(outflow)],
    [t("Net", "净额"), usd(inflow - outflow)],
    [
      t("Network fees", "网络费用"),
      `${amountText(fees)} ETH${ethPrice ? ` (${usd(fees * ethPrice)} today)` : ""}`,
    ],
    [t("Transactions", "交易"), String(lines?.length || 0)],
  ];

  async function label(hash: string, change: Partial<{ category: string; note: string }>) {
    await updateBook((b) => {
      const current = b.labels[hash] || { category: "", note: "" };
      return { ...b, labels: { ...b.labels, [hash]: { ...current, ...change } } };
    });
  }

  return (
    <>
      <Header
        title={t("Reports", "报表")}
        onBack={() => go("home")}
        backLabel={t("Dashboard", "概览")}
      />
      <Card>
        <Text style={s.eyebrow}>{t("Period", "期间")}</Text>
        <Choices
          options={PERIODS.map((p) => t(p[0], p[1]))}
          value={t(period[0], period[1])}
          select={(choice) => {
            setPeriod(PERIODS.find((p) => t(p[0], p[1]) === choice) || PERIODS[0]);
            setLines(null);
          }}
        />
        <Text style={s.eyebrow}>{t("Accounts", "账户")}</Text>
        <View style={s.wrap}>
          {everyone.map((e) => (
            <Chip
              key={e.address}
              label={e.watched ? `${e.name} · ${t("watched", "观察")}` : e.name}
              on={chosen.has(e.address)}
              onPress={() => {
                const next = new Set(chosen);
                if (next.has(e.address)) next.delete(e.address);
                else next.add(e.address);
                setPicked(next);
                setLines(null);
              }}
            />
          ))}
        </View>
        <Button primary disabled={busy || !chosen.size} onPress={() => void build()}>
          {busy ? <TeraSpinner size={18} /> : t("Build report", "生成报表")}
        </Button>
        <Text style={s.small}>
          {t(
            "Read from the block explorer and priced on the day of each payment where a price exists. Nothing about this report is sent to Tera.",
            "数据读取自区块浏览器，并尽可能按每笔付款当日的价格计价。此报表的任何内容都不会发送给 Tera。",
          )}
        </Text>
      </Card>
      {error ? (
        <View style={s.error}>
          <Text style={s.text}>{error}</Text>
        </View>
      ) : null}
      {lines ? (
        <>
          <Card>
            <View style={{ flexDirection: wide ? "row" : "column", gap: 10 }}>
              {(
                [
                  [t("Money in", "流入"), usd(inflow), colors.green],
                  [t("Money out", "流出"), usd(outflow), colors.copper],
                  [t("Net", "净额"), usd(inflow - outflow), colors.ink],
                  [t("Fees", "费用"), `${amountText(fees)} ETH`, colors.muted],
                ] as const
              ).map(([k, v, tone]) => (
                <View
                  key={k}
                  style={{
                    flex: 1,
                    gap: 2,
                    padding: 12,
                    borderRadius: 14,
                    backgroundColor: colors.raised,
                  }}
                >
                  <Text style={s.small}>{k}</Text>
                  <Text style={[s.text, { fontWeight: "700", color: tone }]}>{v}</Text>
                </View>
              ))}
            </View>
            <Text style={s.small}>
              {[
                t(`${lines.length} movements · ${range}`, `${lines.length} 笔记录 · ${range}`),
                atToday
                  ? t(`${atToday} priced at today's price`, `${atToday} 笔按今日价格计价`)
                  : "",
                notPriced ? t(`${notPriced} without a price`, `${notPriced} 笔无价格`) : "",
                t(
                  "Moves between your own accounts are not counted as in or out.",
                  "自有账户之间的转账不计入流入或流出。",
                ),
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button
                  primary
                  disabled={!lines.length}
                  onPress={() =>
                    download(`${fileName}.csv`, toCsv(table()), "text/csv;charset=utf-8")
                  }
                >
                  {t("Download CSV", "下载 CSV")}
                </Button>
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  disabled={!lines.length}
                  onPress={() =>
                    printReport(
                      t("Tera Business report", "Tera 商业版报表"),
                      summary,
                      table().map((row) => row.slice(0, 13)),
                    )
                  }
                >
                  {t("Save as PDF", "保存为 PDF")}
                </Button>
              </View>
            </View>
          </Card>
          <Card style={{ gap: 4 }}>
            <Text style={[s.text, { fontWeight: "700", marginBottom: 6 }]}>
              {t("Label payments", "标记付款")}
            </Text>
            {!lines.length ? (
              <Text style={s.small}>{t("Nothing in this period.", "此期间没有记录。")}</Text>
            ) : null}
            {lines.slice(0, 100).map((l) => {
              const key = `${l.hash}-${l.account}-${l.symbol}-${l.direction}`;
              const current = labelOf(l);
              return (
                <View
                  key={key}
                  style={{
                    borderTopWidth: 1,
                    borderColor: colors.line,
                    paddingVertical: 10,
                    gap: 10,
                  }}
                >
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setOpen(open === key ? null : key);
                      setNote(current.note);
                    }}
                    style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
                  >
                    <Icon
                      name={
                        l.direction === "in"
                          ? "arrow-down-left"
                          : l.direction === "out"
                            ? "arrow-top-right"
                            : "gas-station"
                      }
                      size={17}
                      color={
                        l.direction === "in"
                          ? colors.green
                          : l.direction === "out"
                            ? colors.copper
                            : colors.muted
                      }
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={s.label} numberOfLines={1}>
                        {l.direction === "fee"
                          ? t(
                              `Network fee · ${amountText(l.fee)} ETH`,
                              `网络费用 · ${amountText(l.fee)} ETH`,
                            )
                          : `${l.direction === "in" ? "+" : "−"}${amountText(l.amount)} ${l.symbol}${l.value ? ` · ${usd(l.value)}` : ""}`}
                      </Text>
                      <Text style={s.small} numberOfLines={1}>
                        {`${new Date(l.timestamp).toLocaleDateString()} · ${l.accountName} · ${short(l.counterparty || "0x0000000000")}`}
                      </Text>
                    </View>
                    <Text
                      style={[
                        s.small,
                        {
                          color: current.category ? colors.green : colors.faint,
                          fontWeight: "600",
                        },
                      ]}
                    >
                      {current.category || t("Add label", "添加标签")}
                    </Text>
                  </Pressable>
                  {open === key ? (
                    <View style={{ gap: 10 }}>
                      <View style={s.wrap}>
                        {CATEGORIES.map((c) => (
                          <Chip
                            key={c}
                            label={c}
                            on={current.category === c}
                            onPress={() =>
                              void label(l.hash, { category: current.category === c ? "" : c })
                            }
                          />
                        ))}
                      </View>
                      <Field
                        label={t("Note", "备注")}
                        value={note}
                        maxLength={140}
                        placeholder={t("Invoice number, client, purpose…", "发票号、客户、用途…")}
                        onChangeText={setNote}
                        onBlur={() => void label(l.hash, { note: notesCore.cleanNote(note) })}
                      />
                    </View>
                  ) : null}
                </View>
              );
            })}
            {lines.length > 100 ? (
              <Text style={[s.small, { paddingTop: 8 }]}>
                {t(
                  `And ${lines.length - 100} more in the downloaded file.`,
                  `另有 ${lines.length - 100} 笔在下载文件中。`,
                )}
              </Text>
            ) : null}
          </Card>
        </>
      ) : null}
    </>
  );
}

// --- Email ---------------------------------------------------------------------

function Email({ t, owner, accounts, go, notify }: ScreensProps) {
  const [linked, setLinked] = useState<{ email: string; name: string } | null | undefined>(
    undefined,
  );
  const [step, setStep] = useState<"form" | "code">("form");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<{ email: string; address: Address } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const on = emailAvailable();
  const active = accounts.find((a) => a.active);

  useEffect(() => {
    if (!on) return;
    let live = true;
    setLinked(undefined);
    void linkedEmail(owner)
      .then((found) => live && setLinked(found))
      .catch(() => live && setLinked(null));
    return () => {
      live = false;
    };
  }, [owner, on]);

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

  const warning = (
    <View
      style={{
        flexDirection: "row",
        gap: 10,
        padding: 14,
        borderRadius: 14,
        backgroundColor: colors.warnTint,
      }}
    >
      <Icon name="shield-lock" size={18} color={colors.yellow} />
      <Text style={[s.small, { flex: 1, color: colors.ink }]}>
        {t(
          "Your email only receives payments. It cannot sign in to or recover this wallet: your recovery phrase is still the only way back in.",
          "邮箱仅用于收款，无法登录或恢复此钱包：助记词仍是唯一的恢复方式。",
        )}
      </Text>
    </View>
  );

  return (
    <>
      <Header
        title={t("Get paid by email", "邮箱收款")}
        onBack={() => go("home")}
        backLabel={t("Dashboard", "概览")}
      />
      {error ? (
        <View style={s.error}>
          <Text style={s.text}>{error}</Text>
        </View>
      ) : null}
      {!on ? (
        <Card>
          <Text style={s.label}>{t("Not switched on yet", "尚未开放")}</Text>
          <Text style={s.small}>
            {t(
              "Email payments are not available on this server yet. Your wallet address and QR code work as always.",
              "此服务器尚未开放邮箱收款。你的钱包地址和二维码照常可用。",
            )}
          </Text>
        </Card>
      ) : linked === undefined ? (
        <Card>
          <Skeleton width="100%" height={48} borderRadius={12} />
        </Card>
      ) : linked && step === "form" && !pending ? (
        <>
          <Card style={{ alignItems: "center", gap: 10, paddingVertical: 28 }}>
            <View
              style={[
                s.iconDisc,
                { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.tint },
              ]}
            >
              <Icon name="circle-check" size={26} color={colors.green} />
            </View>
            <Text style={[s.text, { fontSize: 20, fontWeight: "700" }]}>{linked.email}</Text>
            <Text style={[s.small, { textAlign: "center" }]}>
              {t(
                `Payments sent to this email arrive in ${active ? accountName(t, active) : short(owner)}${linked.name ? `, shown to senders as ${linked.name}` : ""}.`,
                `发送至此邮箱的付款将进入 ${active ? accountName(t, active) : short(owner)}${linked.name ? `，付款方看到的名称为 ${linked.name}` : ""}。`,
              )}
            </Text>
            <Text selectable style={[s.mono, { color: colors.muted }]}>
              {owner}
            </Text>
          </Card>
          {warning}
          <Button
            onPress={() => {
              setEmail("");
              setName(linked.name);
              setLinked(null);
            }}
          >
            {t("Use a different email", "更换邮箱")}
          </Button>
          <Button
            danger
            disabled={busy}
            onPress={() =>
              void work(async () => {
                await unlinkEmail(linked.email);
                setLinked(null);
                notify({
                  title: t("Email removed", "已移除邮箱"),
                  body: t(
                    `${linked.email} no longer receives payments.`,
                    `${linked.email} 不再接收付款。`,
                  ),
                  tone: "success",
                });
              })
            }
          >
            {t("Stop receiving at this email", "停止使用此邮箱收款")}
          </Button>
        </>
      ) : step === "form" ? (
        <>
          <Text style={s.small}>
            {t(
              "Link your business email and anyone using Tera can pay you by typing it instead of your address. We send a code to prove the inbox is yours.",
              "绑定商业邮箱后，任何 Tera 用户输入该邮箱即可向你付款。我们会发送验证码以确认邮箱属于你。",
            )}
          </Text>
          <Field
            label={t("Business name", "商业名称")}
            value={name}
            maxLength={60}
            placeholder={t("Shown to people paying you", "向付款方显示")}
            onChangeText={setName}
          />
          <Field
            label={t("Business email", "商业邮箱")}
            value={email}
            placeholder="pay@yourbusiness.com"
            keyboardType="email-address"
            autoComplete="email"
            onChangeText={setEmail}
          />
          <Text style={s.small}>
            {t(
              `Payments to this email will arrive in ${active ? accountName(t, active) : "this account"} (${short(owner)}).`,
              `发送至此邮箱的付款将进入 ${active ? accountName(t, active) : "此账户"}（${short(owner)}）。`,
            )}
          </Text>
          {warning}
          <Button
            primary
            disabled={busy || !email.trim()}
            onPress={() =>
              void work(async () => {
                const sent = await sendCode(email, name);
                setPending(sent);
                setCode("");
                setStep("code");
              })
            }
          >
            {busy ? <TeraSpinner size={18} /> : t("Send code", "发送验证码")}
          </Button>
        </>
      ) : (
        <>
          <Card style={{ gap: 6 }}>
            <Text style={s.label}>{t("Check your inbox", "请查收邮件")}</Text>
            <Text style={s.small}>
              {t(
                `We sent a six-digit code to ${pending?.email}. It expires in 10 minutes.`,
                `我们已向 ${pending?.email} 发送六位验证码，10 分钟内有效。`,
              )}
            </Text>
          </Card>
          <Field
            label={t("Code", "验证码")}
            value={code}
            maxLength={6}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            placeholder="123456"
            onChangeText={(value) => setCode(value.replace(/\D/g, ""))}
          />
          <Button
            primary
            disabled={busy || code.length !== 6 || !pending}
            onPress={() =>
              void work(async () => {
                const done = await confirmCode(pending!.email, pending!.address, code);
                setLinked({ email: String(done.email), name: String(done.name || "") });
                setPending(null);
                setStep("form");
                notify({
                  title: t("Email linked", "邮箱已绑定"),
                  body: t(
                    `People can now pay you at ${done.email}.`,
                    `现在可以通过 ${done.email} 向你付款。`,
                  ),
                  tone: "success",
                });
              })
            }
          >
            {busy ? <TeraSpinner size={18} /> : t("Verify", "验证")}
          </Button>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() =>
                void work(async () => {
                  setPending(await sendCode(pending!.email, name));
                })
              }
            >
              <Text style={[s.small, { color: colors.green, fontWeight: "600" }]}>
                {t("Send a new code", "重新发送")}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setStep("form");
                setPending(null);
              }}
            >
              <Text style={[s.small, { textDecorationLine: "underline" }]}>
                {t("Change email", "更换邮箱")}
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </>
  );
}
