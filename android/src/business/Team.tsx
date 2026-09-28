// The Team screen: a treasury several people answer for.
//
// Roles decide what each member is offered here. The Safe decides what counts:
// an approval only matters if it comes from one of its signers, and a payment
// only leaves once enough of them approved — so a button this screen hides is
// a convenience, and a button it shows cannot do more than the Safe allows.

import * as Clipboard from "expo-clipboard";
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { getAddress, isAddress, type Address } from "viem";
import type { Asset } from "../config";
import { balances } from "../network";
import {
  Button,
  Choices,
  colors,
  Field,
  Header,
  Icon,
  Skeleton,
  styles as s,
  TeraSpinner,
  Text,
} from "../ui";
import { amountText, priceNow, short, usd } from "./data";
import { isEmail, linkedEmail, resolveEmail } from "./email";
import {
  approve,
  can,
  cancel,
  changeRole,
  counted,
  countedRejections,
  createTreasury,
  describe,
  executeCancellation,
  executeProposal,
  invite,
  isSignerRole,
  myTeams,
  proposePayment,
  registerTreasury,
  reject,
  removeMember,
  respond,
  teamsAvailable,
  viewTeam,
  type Proposal,
  type Role,
  type Team,
  type TeamSummary,
} from "./teams";

type T = (en: string, zh: string) => string;
type Notice = { title: string; body: string; tone?: "success" | "error" };
export type TeamProps = {
  t: T;
  wide: boolean;
  owner: Address;
  accounts: { index: number; address: string; name: string; active: boolean }[];
  assets: Asset[];
  prices: Record<string, number>;
  go: (page: string) => void;
  notify: (notice: Notice) => void;
};

const ROLE_TEXT: Record<Role, [string, string, string, string]> = {
  admin: ["Admin", "管理员", "Signs payments and manages the team", "签署付款并管理团队"],
  approver: ["Approver", "审批人", "Signs payments", "签署付款"],
  initiator: ["Initiator", "发起人", "Proposes payments for approval", "发起付款供审批"],
  viewer: ["Viewer", "查看者", "Sees the treasury only", "仅可查看资金库"],
};
const ROLE_ORDER: Role[] = ["admin", "approver", "initiator", "viewer"];

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

function Link({
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

export function TeamScreen(props: TeamProps) {
  const { t, go } = props;
  const [teams, setTeams] = useState<TeamSummary[] | null>(null);
  const [selected, setSelected] = useState<Address | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const found = await myTeams();
      setTeams(found);
      const active = found.filter((team) => team.status === "active");
      setSelected((current) =>
        current && active.some((team) => team.safe === current) ? current : active[0]?.safe || null,
      );
    } catch (e) {
      setTeams([]);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (teamsAvailable()) void load();
    // Reload when the paying account changes: teams belong to an address.
  }, [load, props.owner]);

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

  const header = (
    <Header
      title={t("Team", "团队")}
      onBack={() => go("home")}
      backLabel={t("Dashboard", "概览")}
    />
  );
  const problem = error ? (
    <View style={s.error}>
      <Text style={s.text}>{error}</Text>
    </View>
  ) : null;

  if (!teamsAvailable())
    return (
      <>
        {header}
        <Card>
          <Text style={s.label}>{t("Not switched on yet", "尚未开放")}</Text>
          <Text style={s.small}>
            {t(
              "Team treasuries are not available on this server yet.",
              "此服务器尚未开放团队资金库。",
            )}
          </Text>
        </Card>
      </>
    );

  if (!teams)
    return (
      <>
        {header}
        <Card>
          <Skeleton width="100%" height={60} borderRadius={12} />
        </Card>
      </>
    );

  const invites = teams.filter((team) => team.status === "invited");
  const active = teams.filter((team) => team.status === "active");

  return (
    <>
      {header}
      {problem}
      {invites.map((entry) => (
        <Card key={entry.safe} style={{ backgroundColor: colors.tint }}>
          <Text style={s.label}>
            {t(
              `You're invited to ${entry.name || short(entry.safe)} as ${ROLE_TEXT[entry.role][0]}`,
              `你受邀以${ROLE_TEXT[entry.role][1]}身份加入 ${entry.name || short(entry.safe)}`,
            )}
          </Text>
          <Text style={s.small}>
            {isSignerRole(entry.role)
              ? t(
                  "Once you accept, the treasury's current signers approve adding you as a signer.",
                  "接受后，资金库现有签署人需批准将你添加为签署人。",
                )
              : t(ROLE_TEXT[entry.role][2], ROLE_TEXT[entry.role][3])}
            {entry.invitedBy ? ` · ${t("Invited by", "邀请人")} ${short(entry.invitedBy)}` : ""}
          </Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Button
                primary
                disabled={busy}
                onPress={() =>
                  void work(async () => {
                    await respond(entry.safe, true);
                    setSelected(entry.safe);
                    await load();
                  })
                }
              >
                {t("Accept", "接受")}
              </Button>
            </View>
            <View style={{ flex: 1 }}>
              <Button
                disabled={busy}
                onPress={() =>
                  void work(async () => {
                    await respond(entry.safe, false);
                    await load();
                  })
                }
              >
                {t("Decline", "拒绝")}
              </Button>
            </View>
          </View>
        </Card>
      ))}
      {active.length > 1 || (active.length && creating) ? (
        <View style={s.wrap}>
          {active.map((entry) => (
            <Chip
              key={entry.safe}
              label={entry.name || short(entry.safe)}
              on={!creating && selected === entry.safe}
              onPress={() => {
                setCreating(false);
                setSelected(entry.safe);
              }}
            />
          ))}
          <Chip
            label={t("+ New team", "+ 新团队")}
            on={creating}
            onPress={() => setCreating(true)}
          />
        </View>
      ) : null}
      {!active.length || creating ? (
        <Start
          {...props}
          busy={busy}
          work={work}
          onCreated={async (safe) => {
            setCreating(false);
            setSelected(safe);
            await load();
          }}
        />
      ) : selected ? (
        <TeamView
          key={selected}
          {...props}
          safe={selected}
          onChanged={load}
          onNewTeam={() => setCreating(true)}
        />
      ) : null}
    </>
  );
}

// --- Starting a team -------------------------------------------------------------

function Start({
  t,
  busy,
  work,
  onCreated,
  notify,
}: TeamProps & {
  busy: boolean;
  work: (task: () => Promise<void>) => Promise<void>;
  onCreated: (safe: Address) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [existing, setExisting] = useState(false);
  const [safe, setSafe] = useState("");
  return (
    <>
      <Card>
        <Text style={[s.text, { fontSize: 18, fontWeight: "700" }]}>
          {t("A treasury your team signs for", "由团队共同签署的资金库")}
        </Text>
        <Text style={s.small}>
          {t(
            "A team treasury is a Safe on Robinhood Chain. Money leaves it only when enough signers approve — more than half of them unless you change it — and the Safe checks that, not Tera.",
            "团队资金库是 Robinhood Chain 上的 Safe。只有足够多的签署人批准（默认超过半数），资金才能转出，由 Safe 合约而非 Tera 进行校验。",
          )}
        </Text>
        {ROLE_ORDER.map((role) => (
          <View key={role} style={{ flexDirection: "row", gap: 10 }}>
            <Text style={[s.label, { width: 84 }]}>
              {t(ROLE_TEXT[role][0], ROLE_TEXT[role][1])}
            </Text>
            <Text style={[s.small, { flex: 1 }]}>{t(ROLE_TEXT[role][2], ROLE_TEXT[role][3])}</Text>
          </View>
        ))}
      </Card>
      <Choices
        options={[
          t("Create a new treasury", "创建新资金库"),
          t("Use an existing Safe", "使用现有 Safe"),
        ]}
        value={
          existing
            ? t("Use an existing Safe", "使用现有 Safe")
            : t("Create a new treasury", "创建新资金库")
        }
        select={(choice) => setExisting(choice === t("Use an existing Safe", "使用现有 Safe"))}
      />
      <Field
        label={t("Team name", "团队名称")}
        value={name}
        maxLength={40}
        placeholder={t("e.g. Acme Operations", "例如：Acme 运营")}
        onChangeText={setName}
      />
      {existing ? (
        <Field
          label={t("Safe address", "Safe 地址")}
          value={safe}
          placeholder="0x…"
          onChangeText={setSafe}
        />
      ) : (
        <Text style={s.small}>
          {t(
            "You start as its only signer and admin. Creating it is one transaction from the account you pay from, so it needs a little ETH for the network fee. Invite your team next.",
            "你将是唯一的签署人和管理员。创建需要从付款账户发起一笔交易，因此需要少量 ETH 支付网络费。之后即可邀请团队成员。",
          )}
        </Text>
      )}
      <Button
        primary
        disabled={busy || !name.trim() || (existing && !isAddress(safe.trim(), { strict: false }))}
        onPress={() =>
          void work(async () => {
            const address = existing
              ? await registerTreasury(getAddress(safe.trim()), name)
              : await createTreasury(name);
            notify({
              title: t("Team treasury ready", "团队资金库已就绪"),
              body: t(`Send funds to ${address} to use it.`, `向 ${address} 转入资金即可使用。`),
              tone: "success",
            });
            await onCreated(address);
          })
        }
      >
        {busy ? (
          <TeraSpinner size={18} />
        ) : existing ? (
          t("Add this Safe", "添加此 Safe")
        ) : (
          t("Create team treasury", "创建团队资金库")
        )}
      </Button>
    </>
  );
}

// --- One team --------------------------------------------------------------------

function TeamView({
  t,
  wide,
  owner,
  accounts,
  assets,
  prices,
  notify,
  safe,
  onChanged,
  onNewTeam,
}: TeamProps & { safe: Address; onChanged: () => Promise<void>; onNewTeam: () => void }) {
  const [team, setTeam] = useState<Team | null>(null);
  const [holdings, setHoldings] = useState<Record<string, number> | null>(null);
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [paying, setPaying] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await viewTeam(safe);
      setTeam(next);
      setError("");
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [safe]);

  useEffect(() => {
    let live = true;
    void refresh().then((next) => {
      if (!next || !live) return;
      void balances(safe, assets)
        .then((raw) => {
          const found: Record<string, number> = {};
          for (const asset of assets) {
            const value = raw[asset.symbol];
            if (value && value !== "0") found[asset.symbol] = Number(value) / 10 ** asset.decimals;
          }
          if (live) setHoldings(found);
        })
        .catch(() => live && setHoldings({}));
      for (const member of next.members)
        void linkedEmail(member.address)
          .then(
            (hit) => live && hit && setEmails((all) => ({ ...all, [member.address]: hit.email })),
          )
          .catch(() => {});
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safe, refresh]);

  async function act(key: string, task: () => Promise<unknown>, done?: Notice) {
    setBusy(key);
    setError("");
    try {
      await task();
      if (done) notify(done);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Approve against the latest queue. A proposal with no place takes the next
   * one; if someone else took it meanwhile, reload once and sign for the new one.
   */
  async function approveFresh(id: string) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const current = attempt ? await refresh() : team;
      const proposal = current?.proposals.find((p) => p.id === id);
      if (!current || !proposal) throw new Error("This proposal is no longer in the queue.");
      try {
        return await approve(current, proposal);
      } catch (e) {
        if (attempt || !(e instanceof Error) || !/queue moved/i.test(e.message)) throw e;
      }
    }
  }

  if (!team)
    return error ? (
      <View style={s.error}>
        <Text style={s.text}>{error}</Text>
      </View>
    ) : (
      <Card>
        <Skeleton width="100%" height={80} borderRadius={12} />
      </Card>
    );

  const me = team.you;
  const amSigner = team.owners.includes(owner);
  const nameOf = (address: string) => {
    if (address.toLowerCase() === owner.toLowerCase()) return t("You", "你");
    const mine = accounts.find((a) => a.address.toLowerCase() === address.toLowerCase());
    if (mine) return mine.name || t(`Account ${mine.index + 1}`, `账户 ${mine.index + 1}`);
    return emails[getAddress(address)] || short(address);
  };
  const pending = team.proposals.filter((p) => p.status === "pending");
  const history = team.proposals.filter((p) => p.status !== "pending").slice(0, 10);
  const total = Object.entries(holdings || {}).reduce(
    (sum, [symbol, amount]) => sum + amount * priceNow(symbol, prices),
    0,
  );

  const overview = (
    <Card style={{ backgroundColor: colors.tint, gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={s.eyebrow}>{t("Team treasury", "团队资金库")}</Text>
          <Text style={[s.text, { fontSize: 18, fontWeight: "700" }]} numberOfLines={1}>
            {team.team.name || short(safe)}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Refresh", "刷新")}
          onPress={() => void refresh()}
          hitSlop={8}
          style={s.iconDisc}
        >
          <Icon name="refresh-cw" size={17} color={colors.ink} />
        </Pressable>
      </View>
      {holdings ? (
        <Text
          style={{
            color: colors.ink,
            fontSize: 34,
            lineHeight: 42,
            fontWeight: "800",
            letterSpacing: -0.8,
          }}
        >
          {usd(total)}
        </Text>
      ) : (
        <Skeleton width={160} height={38} borderRadius={8} />
      )}
      {holdings && Object.keys(holdings).length ? (
        <Text style={s.small}>
          {Object.entries(holdings)
            .map(([symbol, amount]) => `${amountText(amount)} ${symbol}`)
            .join(" · ")}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Pill
          text={t(
            `${team.threshold} of ${team.owners.length} approvals`,
            `${team.owners.length} 人中需 ${team.threshold} 人批准`,
          )}
        />
        <Pill text={t(`You: ${ROLE_TEXT[me.role][0]}`, `你：${ROLE_TEXT[me.role][1]}`)} />
        {isSignerRole(me.role) && !amSigner ? (
          <Pill text={t("Signer: waiting to be added", "签署人：等待添加")} warn />
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("Copy treasury address", "复制资金库地址")}
        onPress={() =>
          void Clipboard.setStringAsync(safe).then(() =>
            notify({
              title: t("Treasury address copied", "资金库地址已复制"),
              body: t(
                "Send funds here to add them to the team treasury.",
                "向此地址转账即可存入团队资金库。",
              ),
              tone: "success",
            }),
          )
        }
        style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
      >
        <Text selectable style={[s.mono, { color: colors.muted, flexShrink: 1 }]}>
          {safe}
        </Text>
        <Icon name="content-copy" size={14} color={colors.muted} />
      </Pressable>
    </Card>
  );

  const queue = (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={[s.text, { fontWeight: "700" }]}>
          {t(`Waiting for approval (${pending.length})`, `待批准（${pending.length}）`)}
        </Text>
        {can(me.role, "propose") ? (
          <Link
            label={paying ? t("Close", "关闭") : t("New payment", "新建付款")}
            onPress={() => setPaying(!paying)}
          />
        ) : null}
      </View>
      {paying ? (
        <NewPayment
          t={t}
          assets={assets}
          holdings={holdings || {}}
          onPropose={(payment) =>
            act(
              "propose",
              async () => {
                await proposePayment(safe, payment);
                setPaying(false);
              },
              {
                title: t("Payment proposed", "已发起付款"),
                body: t(
                  `It needs ${team.threshold} approval${team.threshold === 1 ? "" : "s"} before anyone can send it.`,
                  `需要 ${team.threshold} 人批准后才能发送。`,
                ),
                tone: "success",
              },
            )
          }
          busy={busy === "propose"}
        />
      ) : null}
      {!pending.length && !paying ? (
        <Text style={s.small}>
          {t(
            "Nothing is waiting. Proposed payments appear here.",
            "没有待处理项。发起的付款会显示在这里。",
          )}
        </Text>
      ) : null}
      {pending.map((proposal) => {
        const read = describe(team, proposal, assets);
        const approvals = counted(team, proposal);
        const cancellations = countedRejections(team, proposal);
        const placed = proposal.nonce !== null;
        const ready = approvals.length >= team.threshold;
        const next = proposal.nonce === team.nonce;
        const approved = approvals.some((a) => a.signer === owner);
        // A vote cast before it had a place is not a signed cancellation; once it
        // has one, that signer is asked to sign the cancellation too.
        const rejected = proposal.rejections.some(
          (r) => r.signer === owner && (!placed || !!r.signature),
        );
        const mayCancel = proposal.createdBy === owner || can(me.role, "manage");
        const signer = amSigner && can(me.role, "approve");
        const ahead = placed ? Number(BigInt(proposal.nonce!) - BigInt(team.nonce)) : 0;
        const rewritten = proposal.rebuiltAt && !proposal.approvals.length;
        const warn = (text: string) => (
          <View
            style={{
              flexDirection: "row",
              gap: 8,
              padding: 10,
              borderRadius: 12,
              backgroundColor: colors.warnTint,
            }}
          >
            <Icon name="triangle-alert" size={15} color={colors.yellow} />
            <Text style={[s.small, { flex: 1, color: colors.ink }]}>{text}</Text>
          </View>
        );
        return (
          <View
            key={proposal.id}
            style={{ borderTopWidth: 1, borderColor: colors.line, paddingTop: 14, gap: 10 }}
          >
            <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
              <View style={[s.iconDisc, { backgroundColor: colors.raised }]}>
                <Icon
                  name={read.signerChange ? "users" : "arrow-top-right"}
                  size={17}
                  color={read.signerChange ? colors.lime : colors.copper}
                />
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={s.label}>
                  {read.signerChange
                    ? read.signerChange.add
                      ? t(
                          `Add ${nameOf(read.signerChange.who)} as a signer`,
                          `添加 ${nameOf(read.signerChange.who)} 为签署人`,
                        )
                      : t(
                          `Remove ${nameOf(read.signerChange.who)} as a signer`,
                          `移除签署人 ${nameOf(read.signerChange.who)}`,
                        )
                    : read.amount
                      ? `${amountText(Number(read.amount))} ${read.symbol} → ${read.recipient ? nameOf(read.recipient) : ""}`
                      : t(read.title, read.title)}
                </Text>
                {read.recipient ? (
                  <Text selectable style={[s.mono, { color: colors.muted, fontSize: 12 }]}>
                    {read.recipient}
                  </Text>
                ) : null}
                {read.signerChange ? (
                  <Text style={s.small}>
                    {t(
                      `Approvals needed afterwards: ${read.signerChange.threshold}`,
                      `之后所需批准数：${read.signerChange.threshold}`,
                    )}
                  </Text>
                ) : null}
                {proposal.note && !read.signerChange ? (
                  <Text style={[s.small, { color: colors.ink }]}>{proposal.note}</Text>
                ) : null}
                <Text style={s.small}>
                  {[
                    t(
                      `Proposed by ${nameOf(proposal.createdBy)}`,
                      `由 ${nameOf(proposal.createdBy)} 发起`,
                    ),
                    !placed
                      ? t("Not in the queue yet", "尚未排队")
                      : next
                        ? t("Next to send", "下一个发送")
                        : t(`${ahead} ahead of it`, `前面还有 ${ahead} 个`),
                  ].join(" · ")}
                </Text>
              </View>
            </View>
            {rewritten
              ? warn(
                  t(
                    "The signer list changed, so this was rewritten to match. Approve it again.",
                    "签署人名单已变更，此项已相应重写，请重新批准。",
                  ),
                )
              : null}
            {proposal.cancelRequested && !proposal.cancellable
              ? warn(
                  t(
                    `Cancellation requested. ${Math.max(0, team.threshold - cancellations.length)} more signer${team.threshold - cancellations.length === 1 ? "" : "s"} must sign it; later proposals keep their approvals.`,
                    `已请求取消，还需 ${Math.max(0, team.threshold - cancellations.length)} 位签署人签署；后续提议的批准将保留。`,
                  ),
                )
              : proposal.blocked && !proposal.cancellable
                ? warn(
                    placed
                      ? t(
                          `This can no longer be approved. ${Math.max(0, team.threshold - cancellations.length)} more rejection${team.threshold - cancellations.length === 1 ? "" : "s"} cancel it on-chain, or it can be cancelled now.`,
                          `此项已无法获批。再有 ${Math.max(0, team.threshold - cancellations.length)} 人拒绝即可链上取消，或立即取消。`,
                        )
                      : t("This can no longer be approved.", "此项已无法获批。"),
                  )
                : null}
            {proposal.cancellable
              ? warn(
                  t(
                    "Enough signers signed its cancellation. Sending it uses up its place and leaves the rest of the queue as it is.",
                    "已有足够签署人签署取消。发送后将占用其位置，队列其余部分保持不变。",
                  ),
                )
              : null}
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", gap: 4 }}>
                {Array.from({ length: team.threshold }, (_, i) => (
                  <View
                    key={i}
                    style={{
                      flex: 1,
                      height: 5,
                      borderRadius: 3,
                      backgroundColor: i < approvals.length ? colors.green : colors.line,
                    }}
                  />
                ))}
              </View>
              <Text style={s.small}>
                {t(
                  `${Math.min(approvals.length, team.threshold)} of ${team.threshold} approvals${approvals.length ? ` · ${approvals.map((a) => nameOf(a.signer)).join(", ")}` : ""}${proposal.rejections.length ? ` · ${proposal.rejections.length} rejected` : ""}`,
                  `${Math.min(approvals.length, team.threshold)}/${team.threshold} 已批准${proposal.rejections.length ? ` · ${proposal.rejections.length} 人拒绝` : ""}`,
                )}
                {!placed && signer && !approved
                  ? t(
                      " · Your approval gives it the next place in the queue.",
                      " · 你的批准将使其进入队列的下一个位置。",
                    )
                  : ""}
              </Text>
            </View>
            <View style={{ flexDirection: wide ? "row" : "column", gap: 10 }}>
              {signer &&
              !approved &&
              !rejected &&
              !ready &&
              !proposal.blocked &&
              !proposal.cancelRequested ? (
                <>
                  <View style={wide ? { flex: 1 } : null}>
                    <Button
                      primary
                      disabled={!!busy}
                      onPress={() =>
                        void act(`approve-${proposal.id}`, () => approveFresh(proposal.id), {
                          title: t("Approved", "已批准"),
                          body: t("Your approval is recorded.", "你的批准已记录。"),
                          tone: "success",
                        })
                      }
                    >
                      {busy === `approve-${proposal.id}` ? (
                        <TeraSpinner size={18} />
                      ) : (
                        t("Approve", "批准")
                      )}
                    </Button>
                  </View>
                  <View style={wide ? { flex: 1 } : null}>
                    <Button
                      disabled={!!busy}
                      onPress={() =>
                        void act(`reject-${proposal.id}`, () => reject(team, proposal))
                      }
                    >
                      {t("Reject", "拒绝")}
                    </Button>
                  </View>
                </>
              ) : null}
              {signer &&
              !rejected &&
              placed &&
              (proposal.cancelRequested || proposal.blocked) &&
              !proposal.cancellable ? (
                <View style={wide ? { flex: 1 } : null}>
                  <Button
                    primary
                    disabled={!!busy}
                    onPress={() =>
                      void act(`reject-${proposal.id}`, () => reject(team, proposal), {
                        title: t("Cancellation signed", "已签署取消"),
                        body: t(
                          "Your signature on its cancellation is recorded.",
                          "你对取消的签名已记录。",
                        ),
                        tone: "success",
                      })
                    }
                  >
                    {busy === `reject-${proposal.id}` ? (
                      <TeraSpinner size={18} />
                    ) : (
                      t("Sign cancellation", "签署取消")
                    )}
                  </Button>
                </View>
              ) : null}
              {ready && !proposal.cancellable && can(me.role, "execute") ? (
                <View style={wide ? { flex: 1 } : null}>
                  <Button
                    primary
                    disabled={!!busy || !next}
                    onPress={() =>
                      void act(`execute-${proposal.id}`, () => executeProposal(team, proposal), {
                        title: t("Sent", "已发送"),
                        body: t("The treasury executed this.", "资金库已执行此项。"),
                        tone: "success",
                      })
                    }
                  >
                    {busy === `execute-${proposal.id}` ? (
                      <TeraSpinner size={18} />
                    ) : next ? (
                      t("Send now", "立即发送")
                    ) : (
                      t("Waiting for earlier proposals", "等待之前的提议")
                    )}
                  </Button>
                </View>
              ) : null}
              {proposal.cancellable && can(me.role, "execute") ? (
                <View style={wide ? { flex: 1 } : null}>
                  <Button
                    primary
                    disabled={!!busy || !next}
                    onPress={() =>
                      void act(
                        `cancel-send-${proposal.id}`,
                        () => executeCancellation(team, proposal),
                        {
                          title: t("Cancelled on-chain", "已链上取消"),
                          body: t(
                            "Its place is used up; everything queued after it kept its approvals.",
                            "其位置已被占用，后续提议的批准均已保留。",
                          ),
                          tone: "success",
                        },
                      )
                    }
                  >
                    {busy === `cancel-send-${proposal.id}` ? (
                      <TeraSpinner size={18} />
                    ) : next ? (
                      t("Send cancellation", "发送取消")
                    ) : (
                      t("Waiting for earlier proposals", "等待之前的提议")
                    )}
                  </Button>
                </View>
              ) : null}
            </View>
            {mayCancel && !proposal.cancellable ? (
              !placed || proposal.last ? (
                <Link
                  danger
                  label={t("Withdraw this proposal", "撤回此提议")}
                  onPress={() =>
                    void act(`cancel-${proposal.id}`, () => cancel(safe, proposal, "now"))
                  }
                />
              ) : (
                <View style={{ gap: 6 }}>
                  <Link
                    danger
                    label={t(
                      "Cancel now (free; proposals after it need approving again)",
                      "立即取消（免费；之后的提议需重新批准）",
                    )}
                    onPress={() =>
                      void act(`cancel-${proposal.id}`, () => cancel(safe, proposal, "now"))
                    }
                  />
                  {!proposal.cancelRequested ? (
                    <Link
                      label={t(
                        "Cancel on-chain (signers sign it; later approvals are kept)",
                        "链上取消（需签署人签署；保留后续批准）",
                      )}
                      onPress={() =>
                        void act(`cancel-${proposal.id}`, () => cancel(safe, proposal, "onchain"), {
                          title: t("Cancellation requested", "已请求取消"),
                          body: t(
                            "Signers will be asked to sign it. A small network fee is paid when it's sent.",
                            "将请签署人签署。发送时需支付少量网络费。",
                          ),
                          tone: "success",
                        })
                      }
                    />
                  ) : null}
                </View>
              )
            ) : null}
          </View>
        );
      })}
    </Card>
  );

  const members = (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={[s.text, { fontWeight: "700" }]}>{t("Members", "成员")}</Text>
        {can(me.role, "manage") ? (
          <Link
            label={inviting ? t("Close", "关闭") : t("Invite", "邀请")}
            onPress={() => setInviting(!inviting)}
          />
        ) : null}
      </View>
      {inviting ? (
        <InviteForm
          t={t}
          busy={busy === "invite"}
          onInvite={(who, role) =>
            act(
              "invite",
              async () => {
                await invite(safe, who, role);
                setInviting(false);
              },
              {
                title: t("Invitation sent", "已发送邀请"),
                body: t(
                  "They'll see it under Team when they open Tera Business.",
                  "对方打开 Tera 商业版时会在“团队”中看到邀请。",
                ),
                tone: "success",
              },
            )
          }
        />
      ) : null}
      {team.members.map((member) => {
        const self = member.address === owner;
        const manage = can(me.role, "manage");
        return (
          <View key={member.address} style={{ gap: 10 }}>
            <Pressable
              accessibilityRole={manage || self ? "button" : undefined}
              disabled={!manage && !self}
              onPress={() => setOpen(open === member.address ? null : member.address)}
              style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
            >
              <View style={[s.iconDisc, member.signer && { backgroundColor: colors.tint }]}>
                <Icon
                  name={member.signer ? "shield-check" : member.role === "viewer" ? "eye" : "users"}
                  size={17}
                  color={member.signer ? colors.green : colors.muted}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.label} numberOfLines={1}>
                  {nameOf(member.address)}
                </Text>
                <Text style={s.small} numberOfLines={1}>
                  {[
                    t(ROLE_TEXT[member.role][0], ROLE_TEXT[member.role][1]),
                    member.status === "invited"
                      ? t("Invited", "已邀请")
                      : isSignerRole(member.role) && !member.signer
                        ? t("Waiting to be added as a signer", "等待添加为签署人")
                        : member.signer
                          ? t("Signer", "签署人")
                          : "",
                    short(member.address),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </View>
              {manage || self ? (
                <Icon
                  name={open === member.address ? "chevron-down" : "chevron-right"}
                  size={18}
                  color={colors.faint}
                />
              ) : null}
            </Pressable>
            {open === member.address ? (
              <View style={{ gap: 10, paddingLeft: 50 }}>
                {manage ? (
                  <>
                    <View style={s.wrap}>
                      {ROLE_ORDER.map((role) => (
                        <Chip
                          key={role}
                          label={t(ROLE_TEXT[role][0], ROLE_TEXT[role][1])}
                          on={member.role === role}
                          onPress={() =>
                            role !== member.role &&
                            void act(
                              `role-${member.address}`,
                              () => changeRole(safe, member.address, role),
                              {
                                title: t("Role changed", "角色已更改"),
                                body:
                                  isSignerRole(role) !== isSignerRole(member.role) &&
                                  member.status === "active"
                                    ? t(
                                        "Changing who signs is itself a treasury change: it's now waiting for the signers' approval.",
                                        "更改签署人本身也是资金库变更，现需签署人批准。",
                                      )
                                    : t("Saved.", "已保存。"),
                                tone: "success",
                              },
                            )
                          }
                        />
                      ))}
                    </View>
                    <Text style={s.small}>
                      {t(ROLE_TEXT[member.role][2], ROLE_TEXT[member.role][3])}
                    </Text>
                  </>
                ) : null}
                <Link
                  danger
                  label={
                    self ? t("Leave this team", "退出此团队") : t("Remove from team", "移出团队")
                  }
                  onPress={() =>
                    void act(
                      `remove-${member.address}`,
                      async () => {
                        await removeMember(safe, member.address);
                        if (self) await onChanged();
                      },
                      {
                        title: self
                          ? t("You left the team", "你已退出团队")
                          : t("Member removed", "已移除成员"),
                        body: member.signer
                          ? t(
                              "Removing a signer from the treasury is waiting for the signers' approval.",
                              "从资金库移除签署人需等待签署人批准。",
                            )
                          : t("Done.", "已完成。"),
                        tone: "success",
                      },
                    )
                  }
                />
              </View>
            ) : null}
          </View>
        );
      })}
    </Card>
  );

  const past = history.length ? (
    <Card>
      <Text style={[s.text, { fontWeight: "700" }]}>{t("History", "历史")}</Text>
      {history.map((proposal) => {
        const read = describe(team, proposal, assets);
        return (
          <View key={proposal.id} style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
            <Text style={[s.small, { flex: 1, color: colors.ink }]} numberOfLines={1}>
              {read.signerChange
                ? `${read.title} · ${nameOf(read.signerChange.who)}`
                : read.amount
                  ? `${amountText(Number(read.amount))} ${read.symbol} → ${read.recipient ? nameOf(read.recipient) : ""}`
                  : read.title}
            </Text>
            <Text
              style={[
                s.small,
                {
                  color: proposal.status === "executed" ? colors.green : colors.muted,
                  fontWeight: "600",
                },
              ]}
            >
              {
                {
                  executed: t("Sent", "已发送"),
                  rejected: t("Rejected", "已拒绝"),
                  cancelled: t("Cancelled", "已取消"),
                  pending: "",
                }[proposal.status]
              }
            </Text>
          </View>
        );
      })}
    </Card>
  ) : null;

  const trust = (
    <Text style={s.small}>
      {t(
        "Approvals only count from the treasury's signers, and the Safe checks them itself. Tera keeps the member list and this queue, and cannot send anything.",
        "只有资金库签署人的批准才有效，并由 Safe 合约自行校验。Tera 仅保存成员名单和此队列，无法发送任何资金。",
      )}
    </Text>
  );

  const problem = error ? (
    <View style={s.error}>
      <Text style={s.text}>{error}</Text>
    </View>
  ) : null;

  if (wide)
    return (
      <>
        {problem}
        <View style={{ flexDirection: "row", gap: 24, alignItems: "flex-start" }}>
          <View style={{ flex: 6, minWidth: 0, gap: 20 }}>
            {overview}
            {queue}
          </View>
          <View style={{ flex: 5, minWidth: 0, gap: 20 }}>
            {members}
            {past}
            {trust}
            <Link label={t("+ Start another team", "+ 创建其他团队")} onPress={onNewTeam} />
          </View>
        </View>
      </>
    );
  return (
    <>
      {problem}
      {overview}
      {queue}
      {members}
      {past}
      {trust}
      <Link label={t("+ Start another team", "+ 创建其他团队")} onPress={onNewTeam} />
    </>
  );
}

function Pill({ text, warn = false }: { text: string; warn?: boolean }) {
  return (
    <View
      style={{
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
        backgroundColor: warn ? colors.warnTint : colors.wash,
      }}
    >
      <Text style={[s.small, { color: warn ? colors.yellow : colors.ink, fontWeight: "600" }]}>
        {text}
      </Text>
    </View>
  );
}

function NewPayment({
  t,
  assets,
  holdings,
  busy,
  onPropose,
}: {
  t: T;
  assets: Asset[];
  holdings: Record<string, number>;
  busy: boolean;
  onPropose: (payment: {
    recipient: Address;
    asset: Asset;
    amount: string;
    note: string;
  }) => Promise<void>;
}) {
  const held = assets.filter((asset) => holdings[asset.symbol]);
  const choices = held.length ? held : assets.slice(0, 4);
  const [symbol, setSymbol] = useState(choices[0]?.symbol || "ETH");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState("");
  const asset = assets.find((a) => a.symbol === symbol) || choices[0];
  return (
    <View style={{ gap: 12, paddingVertical: 4 }}>
      <View style={s.wrap}>
        {choices.map((a) => (
          <Chip
            key={a.symbol}
            label={
              holdings[a.symbol] ? `${a.symbol} · ${amountText(holdings[a.symbol])}` : a.symbol
            }
            on={symbol === a.symbol}
            onPress={() => setSymbol(a.symbol)}
          />
        ))}
      </View>
      <Field
        label={t("Pay to", "收款方")}
        value={recipient}
        placeholder={t("0x… or a business email", "0x… 或商业邮箱")}
        onChangeText={(value) => {
          setRecipient(value);
          setProblem("");
        }}
      />
      <Field
        label={t(`Amount (${symbol})`, `金额（${symbol}）`)}
        value={amount}
        keyboardType="decimal-pad"
        placeholder="0.00"
        onChangeText={(value) => setAmount(value.replace(/[^\d.]/g, ""))}
      />
      <Field
        label={t("Note for the approvers", "给审批人的备注")}
        value={note}
        maxLength={140}
        placeholder={t("What it's for, invoice number…", "用途、发票号…")}
        onChangeText={setNote}
      />
      {problem ? <Text style={[s.small, { color: colors.danger }]}>{problem}</Text> : null}
      <Button
        primary
        disabled={busy || !recipient.trim() || !Number(amount) || !asset}
        onPress={() =>
          void (async () => {
            setProblem("");
            let to: Address;
            const typed = recipient.trim();
            if (isAddress(typed, { strict: false })) to = getAddress(typed);
            else if (isEmail(typed)) {
              try {
                to = (await resolveEmail(typed)).address;
              } catch (e) {
                return setProblem(e instanceof Error ? e.message : String(e));
              }
            } else
              return setProblem(
                t("Enter a wallet address or a business email.", "请输入钱包地址或商业邮箱。"),
              );
            await onPropose({ recipient: to, asset: asset!, amount, note });
          })()
        }
      >
        {busy ? <TeraSpinner size={18} /> : t("Propose payment", "发起付款")}
      </Button>
      <Text style={s.small}>
        {t(
          "Nothing leaves the treasury until enough signers approve. An email is looked up now and the address it points to is what gets proposed.",
          "在足够多的签署人批准前，资金不会转出。邮箱会立即解析，发起的是其对应的地址。",
        )}
      </Text>
    </View>
  );
}

function InviteForm({
  t,
  busy,
  onInvite,
}: {
  t: T;
  busy: boolean;
  onInvite: (who: string, role: Role) => Promise<void>;
}) {
  const [who, setWho] = useState("");
  const [role, setRole] = useState<Role>("approver");
  return (
    <View style={{ gap: 12, paddingVertical: 4 }}>
      <Field
        label={t("Wallet address or business email", "钱包地址或商业邮箱")}
        value={who}
        placeholder="0x… · name@business.com"
        onChangeText={setWho}
      />
      <View style={s.wrap}>
        {ROLE_ORDER.map((r) => (
          <Chip
            key={r}
            label={t(ROLE_TEXT[r][0], ROLE_TEXT[r][1])}
            on={role === r}
            onPress={() => setRole(r)}
          />
        ))}
      </View>
      <Text style={s.small}>
        {t(ROLE_TEXT[role][2], ROLE_TEXT[role][3])}
        {isSignerRole(role)
          ? t(
              ". Once they accept, adding them as a signer waits for the current signers' approval.",
              "。对方接受后，添加其为签署人需现有签署人批准。",
            )
          : "."}
      </Text>
      <Button primary disabled={busy || !who.trim()} onPress={() => void onInvite(who, role)}>
        {busy ? <TeraSpinner size={18} /> : t("Send invitation", "发送邀请")}
      </Button>
    </View>
  );
}
