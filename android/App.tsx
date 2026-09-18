import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { formatUnits, parseUnits, zeroAddress, type Address } from "viem";
import { api } from "./src/api";
import { Asset, chain, destinations, sources, Tx, USDG } from "./src/config";
import { balances, client, execute, transactionStatus } from "./src/network";
import { policyFor } from "./src/policy";
import { proposalVerdicts, verifyProposal } from "./src/proposals";
import { UNVERIFIABLE } from "./src/core";
import { check, positive, transferTx, verifyBridge, verifyTransfer } from "./src/validation";
import * as vault from "./src/storage";
import { normalizePhrase, walletFromPhrase } from "./src/crypto";
import { Button, Choices, colors, Field, Row, styles as s } from "./src/ui";
import { minimise, PROPOSAL_KEEP, rehydrate, residual, type MinimiseResult } from "./src/minimise";

type Review = {
  title: string;
  rows: [string, string][];
  steps: Tx[];
  verify: () => void;
  reference?: string;
  recipient?: string;
  actionHash?: string;
  bridgeInput?: any;
  draftId?: number;
  simulation?: "checking" | "passed" | "needs-attention";
};
const tokenImages: Record<string, any> = {
  USDG: require("./assets/RH-RWA-Assets-Media/usdg_logo.png"),
  ETH: require("./assets/RH-RWA-Assets-Media/eth.jpeg"),
  AAPL: require("./assets/RH-RWA-Assets-Media/apple.png"),
  AMZN: require("./assets/RH-RWA-Assets-Media/amazon.png"),
  GOOGL: require("./assets/RH-RWA-Assets-Media/google.png"),
  META: require("./assets/RH-RWA-Assets-Media/meta.jpg"),
  MSFT: require("./assets/RH-RWA-Assets-Media/microsoft.png"),
  NVDA: require("./assets/RH-RWA-Assets-Media/nvidia.png"),
  SPCX: require("./assets/RH-RWA-Assets-Media/spacex.png"),
  TSLA: require("./assets/RH-RWA-Assets-Media/tesla.png"),
};
function TokenIcon({ symbol, size = 32 }: { symbol: string; size?: number }) {
  return (
    <Image
      source={tokenImages[symbol] || require("./assets/RH-RWA-Assets-Media/rh-icon.png")}
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.wash }}
    />
  );
}
function Wallet() {
  const [language, setLanguage] = useState<"en" | "zh">("en");
  const t = (en: string, zh: string) => (language === "zh" ? zh : en);
  const [ready, setReady] = useState(false),
    [exists, setExists] = useState(false),
    [pinWallet, setPinWallet] = useState(false),
    [owner, setOwner] = useState<Address | "">("");
  const [page, setPage] = useState("home"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [progress, setProgress] = useState("");
  const [data, setData] = useState(vault.emptyData());
  const dataRef = useRef(data);
  const [balance, setBalance] = useState<Record<string, string> | null>(null),
    [prices, setPrices] = useState<Record<string, number>>({ USDG: 1 }),
    [refreshing, setRefreshing] = useState(false),
    [flowStep, setFlowStep] = useState(0),
    [amountInvalid, setAmountInvalid] = useState(false),
    [settingsSection, setSettingsSection] = useState<
      "root" | "security" | "privacy" | "sessions" | "device"
    >("root"),
    [notice, setNotice] = useState<null | {
      title: string;
      body: string;
      tone?: "success" | "error";
    }>(null);
  const [assets, setAssets] = useState<Asset[]>(sources),
    [message, setMessage] = useState(""),
    [chat, setChat] = useState<
      { role: string; text: string; minimised?: boolean; sent?: string; replaced?: number }[]
    >([]);
  const [minimiseEnabled, setMinimiseEnabled] = useState(true),
    [minimisePlan, setMinimisePlan] = useState<MinimiseResult | null>(null);
  const [propose, setPropose] = useState(false),
    [sessions, setSessions] = useState<any[]>([]),
    [tokenInput, setTokenInput] = useState("");
  const [setup, setSetup] = useState<"start" | "phrase" | "backup" | "import" | "password">(
    "start",
  );
  const [mnemonic, setMnemonic] = useState(""),
    [password, setPassword] = useState(""),
    [repeat, setRepeat] = useState("");
  const [answers, setAnswers] = useState(["", "", ""]),
    [revealed, setRevealed] = useState("");
  const [amount, setAmount] = useState(""),
    [recipient, setRecipient] = useState(""),
    [assetSymbol, setAssetSymbol] = useState("USDG");
  const [destination, setDestination] = useState(8453),
    [outSymbol, setOutSymbol] = useState("ETH"),
    [trade, setTrade] = useState("BUY");
  const [review, setReview] = useState<Review | null>(null),
    [signing, setSigning] = useState(false),
    [auth, setAuth] = useState<null | { title: string; action: () => Promise<void> }>(null),
    [authPassword, setAuthPassword] = useState("");
  const pending = useRef(false);
  const inactivity = useRef(Date.now());
  const backgroundLock = useRef<ReturnType<typeof setTimeout> | null>(null);
  function forget() {
    vault.lock();
    setOwner("");
    setMnemonic("");
    setPassword("");
    setRepeat("");
    setAuthPassword("");
    setAnswers(["", "", ""]);
    setRevealed("");
    setAuth(null);
    setReview(null);
    setChat([]);
    setMessage("");
    setData(vault.emptyData());
    dataRef.current = vault.emptyData();
    setBalance(null);
    setSessions([]);
    setTokenInput("");
    setAmount("");
    setRecipient("");
    setError("");
    setPage("home");
    setFlowStep(0);
    setSettingsSection("root");
    setSetup("start");
    void vault.usesPin().then(setPinWallet);
    void vault.hasWallet().then(async (present) => {
      setExists(present);
      setPinWallet(present && (await vault.usesPin()));
    });
  }
  useEffect(() => {
    vault
      .hasWallet()
      .then(async (present) => {
        setExists(present);
        setPinWallet(present && (await vault.usesPin()));
      })
      .catch(() => setError(t("Device storage unavailable.", "设备存储不可用。")))
      .finally(() => setReady(true));
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        inactivity.current = Date.now();
        if (backgroundLock.current) clearTimeout(backgroundLock.current);
        backgroundLock.current = null;
        return;
      }
      // iOS can enter "inactive" briefly while a system surface appears.
      // Do not discard signing state for that transient condition.
      if (state === "background" && !vault.authenticating) {
        if (backgroundLock.current) clearTimeout(backgroundLock.current);
        backgroundLock.current = setTimeout(() => {
          if (AppState.currentState === "background" && !pending.current) forget();
        }, 60_000);
      }
    });
    const timer = setInterval(() => {
      if (vault.isUnlocked() && !pending.current && Date.now() - inactivity.current > 15 * 60_000)
        forget();
    }, 30_000);
    return () => {
      subscription.remove();
      clearInterval(timer);
      if (backgroundLock.current) clearTimeout(backgroundLock.current);
      vault.lock();
    };
  }, []);
  useEffect(() => {
    if (error)
      setNotice({ title: t("Couldn’t complete that", "无法完成操作"), body: error, tone: "error" });
  }, [error]);
  async function run(work: (guard: () => void) => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    inactivity.current = Date.now();
    setBusy(true);
    setError("");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const version = vault.sessionVersion();
    const guard = () => {
      if (AppState.currentState !== "active" || version !== vault.sessionVersion())
        throw new Error("Session locked. / 会话已锁定。");
    };
    try {
      await work(guard);
    } catch (e) {
      if (version === vault.sessionVersion()) {
        const body = e instanceof Error ? e.message : t("Action failed.", "操作失败。");
        setError(body);
      }
    } finally {
      pending.current = false;
      setBusy(false);
      setProgress("");
    }
  }
  async function store(next: vault.LocalData) {
    await vault.saveData(next);
    dataRef.current = next;
    setData(next);
  }
  async function opened(address: Address, guard: () => void) {
    setOwner(address);
    setExists(true);
    setPassword("");
    setMnemonic("");
    setRepeat("");
    setSetup("start");
    void refresh(address);
    void vault
      .loadData()
      .then((saved) => {
        guard();
        setData(saved);
        dataRef.current = saved;
        setLanguage(saved.language);
      })
      .catch(() => {});
  }
  async function refresh(address = owner) {
    if (!address) return;
    const version = vault.sessionVersion();
    const registryResult = await api("/api/assets").catch(() => ({ assets: [] }));
    const registry: Asset[] = registryResult.assets || [];
    const supported = [
      ...sources,
      ...registry.filter((a) => !sources.some((s) => s.symbol === a.symbol)),
    ];
    const result = await Promise.allSettled([
      balances(address, supported),
      api("/api/assets/prices"),
    ]);
    if (version !== vault.sessionVersion()) return;
    if (result[0].status === "fulfilled") setBalance(result[0].value);
    else
      setError(
        t("Could not refresh balances. Pull again when connected.", "无法刷新余额，请联网后重试。"),
      );
    if (result[1].status === "fulfilled") setPrices(result[1].value.prices || { USDG: 1 });
    setAssets(supported);
  }
  async function pullRefresh() {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }
  const totalUsd = balance
    ? assets.reduce(
        (total, asset) =>
          total +
          Number(formatUnits(BigInt(balance[asset.symbol] || "0"), asset.decimals)) *
            (prices[asset.symbol] || 0),
        0,
      )
    : 0;
  const selectedAsset = assets.find((a) => a.symbol === assetSymbol) || sources[0];
  const dest = destinations.find((d) => d.id === destination)!;
  const output = dest.tokens.find((a) => a.symbol === outSymbol) || dest.tokens[0];
  function units(value: string, decimals: number) {
    check(
      /^\d+(\.\d+)?$/.test(value) && (value.split(".")[1]?.length || 0) <= decimals,
      t("Enter a valid amount with the token’s precision.", "请输入符合代币精度的金额。"),
    );
    const n = parseUnits(value, decimals).toString();
    positive(n);
    return n;
  }
  function continueSend() {
    if (flowStep !== 1) {
      setFlowStep((step) => step + 1);
      return;
    }
    try {
      const requested = BigInt(units(amount, selectedAsset.decimals));
      const available = BigInt(balance?.[selectedAsset.symbol] || "0");
      if (requested > available) {
        setAmountInvalid(true);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setNotice({
          title: t("Insufficient balance", "余额不足"),
          body: t(
            `You have ${formatUnits(available, selectedAsset.decimals)} ${selectedAsset.symbol} available.`,
            `可用余额为 ${formatUnits(available, selectedAsset.decimals)} ${selectedAsset.symbol}。`,
          ),
          tone: "error",
        });
        return;
      }
      setAmountInvalid(false);
      setFlowStep((step) => step + 1);
    } catch (e) {
      setAmountInvalid(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setNotice({
        title: t("Enter an amount", "输入金额"),
        body: e instanceof Error ? e.message : t("Enter a valid amount.", "请输入有效金额。"),
        tone: "error",
      });
    }
  }
  async function prepareTransfer(guard: () => void) {
    const input = {
      ownerAddress: owner,
      accountAddress: owner,
      assetAddress: selectedAsset.address,
      actionType: "TRANSFER",
      recipient: recipient.trim(),
      amount: units(amount, selectedAsset.decimals),
    };
    transferTx(input.assetAddress as Address, input.recipient as Address, input.amount);
    const checked = await policyFor(input);
    guard();
    const result = await api("/api/intent/prepare", checked);
    guard();
    const proposal = { ...result, intent: checked, createdAt: Date.now() };
    await store({ ...dataRef.current, drafts: [...dataRef.current.drafts, proposal] });
    guard();
    showProposal(proposal);
  }
  function showProposal(p: any) {
    const steps = verifyProposal(p, owner);
    const i = p.intent || p.preparedTransaction.intent;
    const asset = assets.find((a) => a.address.toLowerCase() === i.assetAddress.toLowerCase());
    check(asset, t("Load the asset registry first.", "请先加载资产列表。"));
    const input = i.actionType === "BUY" ? sources[0] : asset;
    const q = p.preparedTransaction.quote;
    if (q) check(q.decimalsOut === (i.actionType === "BUY" ? asset.decimals : 6));
    const rows: [string, string][] = [
      [t("Action", "操作"), i.actionType],
      [t("Send", "发送"), `${formatUnits(BigInt(i.amount), input.decimals)} ${input.symbol}`],
      [t("Recipient", "收款地址"), i.recipient || owner],
    ];
    if (q) {
      rows.push([
        t("Expected output", "预计收到"),
        `${formatUnits(BigInt(q.amountOutWei), q.decimalsOut)} ${i.actionType === "BUY" ? asset.symbol : "USDG"}`,
      ]);
      rows.push([
        t("Minimum output", "最低收到"),
        formatUnits((BigInt(q.amountOutWei) * 9900n) / 10000n, q.decimalsOut),
      ]);
    }
    // What the five checks actually reported, rather than a sentence written
    // once and shown regardless. A proposal only reaches this sheet when every
    // check is a plain pass — anything unproven is refused before it is
    // prepared — so this line states what was established, not what was hoped.
    const { verdicts, summary } = proposalVerdicts(p, owner);
    rows.push([t("Checks", "检查"), summary.line]);
    for (const verdict of verdicts.filter((entry: any) => entry.status === UNVERIFIABLE))
      rows.push([`${t("Unproven", "未证实")} · ${verdict.gate}`, verdict.detail]);
    void presentReview({
      title: t("Review proposal", "审核提案"),
      rows,
      steps,
      verify: () => {
        verifyProposal(p, owner);
      },
      recipient: i.recipient || owner,
      actionHash: p.preparedTransaction.actionHash,
      draftId: p.createdAt,
    });
  }
  async function prepareTrade(guard: () => void) {
    const input = {
      ownerAddress: owner,
      accountAddress: owner,
      assetAddress: selectedAsset.address,
      actionType: trade,
      amount: units(amount, trade === "BUY" ? 6 : selectedAsset.decimals),
    };
    const checked = await policyFor(input);
    guard();
    const result = await api("/api/intent/prepare", checked);
    guard();
    const p = { ...result, intent: checked, createdAt: Date.now() };
    await store({ ...dataRef.current, drafts: [...dataRef.current.drafts, p] });
    guard();
    showProposal(p);
  }
  async function prepareBridge(guard: () => void) {
    const source = sources.find((s) => s.symbol === assetSymbol) || sources[0];
    const input = {
      ownerAddress: owner,
      originCurrency: source.address,
      destinationCurrency: output.address,
      destinationChainId: dest.id,
      recipient: recipient.trim(),
      amount: units(amount, source.decimals),
    };
    const { quote } = await api("/api/bridge/quote", input);
    guard();
    const steps = verifyBridge(quote, input);
    await presentReview({
      title: t("Review bridge", "审核跨链"),
      steps,
      verify: () => {
        verifyBridge(quote, input);
      },
      reference: quote.requestId,
      bridgeInput: input,
      rows: [
        [t("Send", "发送"), `${amount} ${source.symbol}`],
        [t("Destination", "目标网络"), `${dest.name} · ${output.symbol}`],
        [t("Recipient", "收款地址"), input.recipient],
        [
          t("Expected, after Relay fees", "扣除 Relay 费用后预计收到"),
          `${formatUnits(BigInt(quote.amountOut), output.decimals)} ${output.symbol}`,
        ],
        [
          t("Minimum received", "最低收到"),
          `${formatUnits(BigInt(quote.minimumAmountOut), output.decimals)} ${output.symbol}`,
        ],
        [t("Expires", "到期时间"), new Date(quote.expiresAt).toLocaleTimeString()],
      ],
    });
  }
  async function presentReview(next: Review) {
    setReview({ ...next, simulation: "checking" });
    try {
      await Promise.all(
        next.steps.map((tx) =>
          client.call({
            account: owner as Address,
            to: tx.to,
            data: tx.data,
            value: BigInt(tx.value),
          }),
        ),
      );
      setReview({ ...next, simulation: "passed" });
    } catch {
      setReview({ ...next, simulation: "needs-attention" });
    }
  }
  async function signReview(r: Review) {
    // Consume the review before broadcasting so a timeout cannot lead to a
    // second tap resending a bridge or transfer.
    r.verify();
    setSigning(true);
    try {
      await execute(
        r.steps,
        r.verify,
        async (record) => {
          const row = {
            ...record,
            title: r.title,
            recipient: r.recipient,
            reference: record.step === record.totalSteps ? r.reference : undefined,
            actionHash: record.step === record.totalSteps ? r.actionHash : undefined,
          };
          await store({
            ...dataRef.current,
            history: [row, ...dataRef.current.history.filter((h) => h.hash !== row.hash)],
            drafts: dataRef.current.drafts.filter((d) => !r.draftId || d.createdAt !== r.draftId),
          });
        },
        setProgress,
      );
      setPage("activity");
      await refresh();
      setNotice({
        title: t("Transaction submitted", "交易已提交"),
        body: t("Your signed transaction is now in Activity.", "已签名交易现已显示在记录中。"),
        tone: "success",
      });
      setReview(null);
    } finally {
      setSigning(false);
    }
  }
  async function deliverAssistantMessage(guard: () => void, plan?: MinimiseResult) {
    if (!message.trim()) return;
    const text = message.trim();
    const keep = propose ? PROPOSAL_KEEP : [];
    const outgoing = plan?.skeleton || text;
    if (plan) {
      const left = residual(outgoing, keep);
      check(
        !left.length,
        t(
          "This message could not be minimised safely. Nothing was sent.",
          "This message could not be minimised safely. Nothing was sent.",
        ),
      );
    }
    const minimised = !!plan?.placeholders.length;
    setMessage("");
    setChat((c) => [
      ...c,
      {
        role: "you",
        text,
        sent: minimised ? outgoing : undefined,
        minimised,
        replaced: plan?.placeholders.length || 0,
      },
    ]);
    const result = await api(
      propose ? "/api/agent/propose" : "/api/agent/chat",
      propose
        ? {
            prompt: outgoing,
            ownerAddress: owner,
            ...(dataRef.current.token ? { sessionToken: dataRef.current.token } : {}),
          }
        : { message: outgoing },
    );
    guard();
    const reply =
      result.reply || result.explanation || t("Proposal prepared.", "Proposal prepared.");
    setChat((c) => [
      ...c,
      { role: "tera", text: minimised ? rehydrate(reply, plan!.placeholders) : reply },
    ]);
    if (propose && result.intent) {
      const checked = await policyFor(result.intent);
      guard();
      const prepared = await api("/api/intent/prepare", checked);
      guard();
      const p = { ...prepared, intent: checked, createdAt: Date.now() };
      await store({ ...dataRef.current, drafts: [...dataRef.current.drafts, p] });
    }
  }
  function startAssistantMessage() {
    const text = message.trim();
    if (!text) return;
    const plan = minimise(text, { owner, keep: propose ? PROPOSAL_KEEP : [] });
    if (minimiseEnabled && plan.placeholders.length) {
      setMinimisePlan(plan);
      return;
    }
    void run((guard) => deliverAssistantMessage(guard, minimiseEnabled ? plan : undefined));
  }
  function authenticate(title: string, action: () => Promise<void>) {
    setAuthPassword("");
    setAuth({ title, action });
  }
  async function authorize(biometric: boolean, guard: () => void) {
    const job = auth;
    if (!job) return;
    const address = await vault.unlock(biometric ? null : authPassword);
    guard();
    check(address === owner);
    setAuth(null);
    setAuthPassword("");
    await job.action();
  }
  function confirm(title: string, body: string, fn: () => void) {
    Alert.alert(title, body, [
      { text: t("Cancel", "取消"), style: "cancel" },
      { text: t("Continue", "继续"), style: "destructive", onPress: fn },
    ]);
  }
  const title = (en: string, zh: string, subtitle?: string) => (
    <View style={{ gap: 10 }}>
      <Text style={s.title}>{t(en, zh)}</Text>
      {subtitle && <Text style={s.small}>{subtitle}</Text>}
    </View>
  );
  const action = (
    en: string,
    zh: string,
    work: (g: () => void) => Promise<void>,
    primary = true,
  ) => (
    <Button primary={primary} disabled={busy} onPress={() => void run(work)}>
      {busy ? <ActivityIndicator color={primary ? colors.paper : colors.green} /> : t(en, zh)}
    </Button>
  );
  const languageControl = (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        const next = language === "en" ? "zh" : "en";
        setLanguage(next);
        if (owner) void store({ ...dataRef.current, language: next }).catch(() => {});
      }}
    >
      <Text style={s.mono}>{language === "en" ? "中文" : "EN"}</Text>
    </Pressable>
  );
  function onboarding() {
    if (!ready) return title("Opening wallet…", "正在打开钱包…");
    if (exists)
      return (
        <>
          {title(
            "Your wallet.\nYour authority.",
            "你的钱包。\n你的权限。",
            t("Unlock on this device.", "在此设备上解锁。"),
          )}
          <Field
            label={
              pinWallet
                ? t("Six-digit wallet PIN", "六码钱包 PIN")
                : t("Wallet password", "钱包密码")
            }
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            textContentType={pinWallet ? "oneTimeCode" : "password"}
            keyboardType={pinWallet ? "number-pad" : "default"}
            maxLength={pinWallet ? 6 : undefined}
          />
          {action("Unlock wallet", "解锁钱包", async (g) => {
            const address = await vault.unlock(password);
            g();
            await opened(address, g);
          })}
          {action(
            "Use biometrics",
            "使用生物识别",
            async (g) => {
              const address = await vault.unlock(null);
              g();
              await opened(address, g);
            },
            false,
          )}
          <Button
            disabled={busy}
            onPress={() =>
              confirm(
                t("Erase and recover", "删除并恢复"),
                t(
                  "This removes this device’s wallet. You need its recovery phrase to restore access. Funds stay on chain.",
                  "这将删除此设备上的钱包，需要助记词才能恢复。链上资金不受影响。",
                ),
                () =>
                  void run(async () => {
                    await vault.eraseWallet();
                    setExists(false);
                    setSetup("import");
                  }),
              )
            }
          >
            {t("Recover with a phrase", "使用助记词恢复")}
          </Button>
        </>
      );
    if (setup === "start")
      return (
        <>
          {title(
            "Your assets.\nYour rules.",
            "你的资产。\n你的规则。",
            t("A wallet that keeps approval with you.", "由你掌握授权的钱包。"),
          )}
          <View style={[s.panel, { marginVertical: 32, paddingVertical: 32 }]}>
            <Text style={s.eyebrow}>01 / {t("SELF CUSTODY", "自主保管")}</Text>
            <Text style={s.text}>
              {t(
                "Create a recovery phrase on your phone. Your keys stay on this device.",
                "在手机上创建助记词，密钥保存在此设备上。",
              )}
            </Text>
          </View>
          <Button
            primary
            disabled={busy}
            onPress={() => {
              setMnemonic(vault.newPhrase());
              setSetup("phrase");
            }}
          >
            {t("Create wallet", "创建钱包")}
          </Button>
          <Button onPress={() => setSetup("import")}>
            {t("I already have a wallet", "我已有钱包")}
          </Button>
        </>
      );
    if (setup === "phrase" || setup === "backup")
      return (
        <>
          {title(
            setup === "phrase" ? "Write these down." : "Check your backup.",
            setup === "phrase" ? "请记下这些单词。" : "检查你的备份。",
            t(
              "Anyone with these words can move your funds. Tera cannot recover them for you.",
              "拥有这些单词的人可以转走资金，Tera 无法替你恢复。",
            ),
          )}
          {setup === "phrase" ? (
            <>
              <View style={s.wrap}>
                {mnemonic.split(" ").map((w, i) => (
                  <View
                    key={i}
                    style={{
                      width: "47%",
                      borderBottomWidth: 1,
                      borderColor: colors.line,
                      paddingVertical: 15,
                    }}
                  >
                    <Text style={s.mono}>
                      {String(i + 1).padStart(2, "0")} {w}
                    </Text>
                  </View>
                ))}
              </View>
              <Button primary onPress={() => setSetup("backup")}>
                {t("I wrote them down", "我已记下")}
              </Button>
            </>
          ) : (
            <>
              {[2, 6, 10].map((n, i) => (
                <Field
                  key={n}
                  label={t(`Word ${n + 1}`, `第 ${n + 1} 个单词`)}
                  value={answers[i]}
                  onChangeText={(v) => setAnswers((a) => a.map((x, j) => (j === i ? v : x)))}
                />
              ))}
              <Button
                primary
                onPress={() => {
                  if (
                    [2, 6, 10].every(
                      (n, i) => answers[i].trim().toLowerCase() === mnemonic.split(" ")[n],
                    )
                  ) {
                    setAnswers(["", "", ""]);
                    setSetup("password");
                  } else
                    setError(t("Those words do not match. Try again.", "单词不匹配，请重试。"));
                }}
              >
                {t("Confirm backup", "确认备份")}
              </Button>
            </>
          )}
        </>
      );
    if (setup === "import")
      return (
        <>
          {title(
            "Welcome back.",
            "欢迎回来。",
            t(
              "Import a standard English recovery phrase. Uses the first Ethereum account; BIP-39 passphrases are not supported in this version.",
              "导入标准英文助记词，使用第一个以太坊账户，此版本不支持 BIP-39 附加口令。",
            ),
          )}
          <Field
            label={t("Recovery phrase", "助记词")}
            value={mnemonic}
            onChangeText={setMnemonic}
            multiline
            secureTextEntry={false}
            contextMenuHidden
            autoComplete="off"
            importantForAutofill="noExcludeDescendants"
          />
          <Button
            primary
            onPress={() => {
              try {
                walletFromPhrase(mnemonic);
                setMnemonic(normalizePhrase(mnemonic));
                setSetup("password");
              } catch {
                setError(t("Check the phrase and word order.", "请检查助记词及顺序。"));
              }
            }}
          >
            {t("Continue", "继续")}
          </Button>
        </>
      );
    return (
      <>
        {title(
          "Protect this wallet.",
          "保护此钱包。",
          t(
            "Choose a six-digit PIN. Use your recovery phrase if you forget it.",
            "设置六码 PIN，忘记时可使用助记词恢复。",
          ),
        )}
        <Field
          label={t("Six-digit PIN", "六码 PIN")}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          keyboardType="number-pad"
          maxLength={6}
        />
        <Field
          label={t("Repeat PIN", "重复 PIN")}
          value={repeat}
          onChangeText={setRepeat}
          secureTextEntry
          keyboardType="number-pad"
          maxLength={6}
        />
        {action("Open my wallet", "打开钱包", async (g) => {
          check(password === repeat, t("Passwords must match.", "两次密码必须一致。"));
          const address = await vault.createWallet(mnemonic, password);
          g();
          await opened(address, g);
        })}
      </>
    );
  }
  function main() {
    if (page === "home")
      return (
        <>
          <View
            style={{
              backgroundColor: colors.dark,
              borderRadius: 28,
              padding: 22,
              gap: 18,
              overflow: "hidden",
            }}
          >
            <View>
              <Text style={[s.small, { color: "#b9c9bd" }]}>
                {t("Portfolio value", "资产总值")}
              </Text>
              <Text
                style={{
                  color: "#ffffff",
                  fontSize: 43,
                  lineHeight: 50,
                  fontWeight: "700",
                  letterSpacing: -1.8,
                }}
              >
                $
                {totalUsd.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                  minimumFractionDigits: 2,
                })}
              </Text>
            </View>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                borderTopWidth: 1,
                borderColor: "#31503e",
                paddingTop: 14,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <MaterialCommunityIcons name="gas-station" size={15} color="#b9c9bd" />
                <Text style={[s.small, { color: "#b9c9bd" }]}>{t("Gas", "燃料费")}</Text>
              </View>
              <Text style={{ color: "#ffffff", fontWeight: "700" }}>
                {balance ? `${formatUnits(BigInt(balance.ETH || "0"), 18)} ETH` : "…"}
              </Text>
            </View>
          </View>
          <View style={s.quickActions}>
            {[
              ["arrow-up", "Send", "发送", "send"],
              ["arrow-down", "Receive", "收款", "receive"],
              ["swap-horizontal", "Swap", "兑换", "swap"],
              ["bridge", "Bridge", "跨链", "bridge"],
            ].map(([icon, en, zh, p]) => (
              <Pressable
                key={p}
                accessibilityRole="button"
                style={({ pressed }) => [s.quickAction, { opacity: pressed ? 0.65 : 1 }]}
                onPress={() => {
                  setAssetSymbol(p === "swap" ? "AAPL" : "USDG");
                  setAmount("");
                  setRecipient("");
                  setFlowStep(0);
                  setPage(p);
                }}
              >
                <MaterialCommunityIcons
                  name={icon as any}
                  color={colors.green}
                  size={23}
                  style={{ marginBottom: 4 }}
                />
                <Text style={s.buttonText}>{t(en, zh)}</Text>
              </Pressable>
            ))}
          </View>
          <View style={[s.panel, { backgroundColor: "#e5f2df" }]}>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Text style={[s.eyebrow, { color: colors.green }]}>
                {t("Your approval", "Your approval")}
              </Text>
              <Text style={{ color: colors.green, fontSize: 16 }}>OK</Text>
            </View>
            <Text style={s.text}>
              {t(
                "Tera can prepare an action. Only this wallet can sign it.",
                "Tera can prepare an action. Only this wallet can sign it.",
              )}
            </Text>
          </View>
        </>
      );
    if (page === "receive")
      return (
        <>
          {title(
            "Receive.",
            "收款。",
            t(
              "Send assets on Robinhood Chain to this address.",
              "请通过 Robinhood Chain 向此地址发送资产。",
            ),
          )}
          <Text selectable style={[s.mono, { fontSize: 18, lineHeight: 30 }]}>
            {owner}
          </Text>
          <View
            style={{
              alignSelf: "center",
              backgroundColor: "#ffffff",
              padding: 16,
              borderRadius: 22,
              borderWidth: 1,
              borderColor: colors.line,
            }}
          >
            <Image
              accessibilityLabel={t("Wallet address QR code", "钱包地址二维码")}
              source={{
                uri: `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(owner)}`,
              }}
              style={{ width: 220, height: 220 }}
            />
          </View>
          {action("Copy address", "复制地址", async () => {
            await Clipboard.setStringAsync(owner);
            setNotice({
              title: t("Address copied", "地址已复制"),
              body: t(
                "Your Robinhood Chain wallet address is ready to paste.",
                "你的 Robinhood Chain 钱包地址已可粘贴。",
              ),
              tone: "success",
            });
          })}
        </>
      );
    if (page === "send") {
      const sendAssets = assets;
      const stepTitle = [
        t("Choose asset", "选择资产"),
        t("Enter amount", "输入金额"),
        t("Recipient", "收款方"),
        t("Review send", "审核发送"),
      ][flowStep];
      return (
        <>
          {title("Send.", "发送。", `${flowStep + 1}/4 · ${stepTitle}`)}
          {flowStep === 0 && (
            <View style={s.wrap}>
              {sendAssets.map((asset) => (
                <Pressable
                  key={asset.symbol}
                  onPress={() => setAssetSymbol(asset.symbol)}
                  style={[
                    s.panel,
                    { width: "48%", flexDirection: "row", alignItems: "center", gap: 10 },
                    assetSymbol === asset.symbol && { borderWidth: 2, borderColor: colors.green },
                  ]}
                >
                  <TokenIcon symbol={asset.symbol} />
                  <Text style={s.text}>{asset.symbol}</Text>
                </Pressable>
              ))}
            </View>
          )}
          {flowStep === 1 && (
            <View style={{ alignItems: "center", gap: 16, paddingVertical: 44 }}>
              <TokenIcon symbol={selectedAsset.symbol} size={52} />
              <TextInput
                autoFocus
                value={amount}
                onChangeText={(value) => {
                  setAmount(value);
                  setAmountInvalid(false);
                }}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor="#b3beb6"
                style={{
                  color: amountInvalid ? colors.danger : colors.ink,
                  fontWeight: "700",
                  fontSize: 64,
                  minWidth: 220,
                  textAlign: "center",
                }}
              />
              <Text style={[s.small, amountInvalid && { color: colors.danger }]}>
                {amountInvalid
                  ? t("Amount exceeds your on-chain balance", "金额超过链上余额")
                  : selectedAsset.symbol}
              </Text>
            </View>
          )}
          {flowStep === 2 && (
            <Field
              label={t("Receiving wallet address", "收款钱包地址")}
              value={recipient}
              onChangeText={setRecipient}
            />
          )}
          {flowStep === 3 && (
            <View style={s.panel}>
              <Row label={t("Asset", "资产")} value={selectedAsset.symbol} />
              <Row label={t("Amount", "金额")} value={`${amount || "0"} ${selectedAsset.symbol}`} />
              <Row label={t("To", "收款方")} value={recipient || "—"} />
            </View>
          )}
          {flowStep < 3 ? (
            <Button primary onPress={continueSend}>
              {t("Continue", "继续")}
            </Button>
          ) : (
            action("Review transaction", "审核交易", prepareTransfer)
          )}
          {flowStep > 0 && (
            <Button onPress={() => setFlowStep((step) => step - 1)}>{t("Back", "返回")}</Button>
          )}
        </>
      );
    }
    if (page === "swap" || page === "bridge") {
      const selectable =
        page === "bridge" ? sources : assets.filter((a) => !["ETH", "USDG"].includes(a.symbol));
      return (
        <>
          {title(
            page === "swap" ? "Swap." : "Across chains.",
            page === "swap" ? "兑换。" : "跨链。",
            page === "bridge"
              ? t("Choose where your assets arrive.", "选择资产到账位置。")
              : t("Choose tokens, then review the live route.", "选择代币，然后审核实时路线。"),
          )}
          <View style={[s.panel, { backgroundColor: "#ffffff" }]}>
            <Text style={s.eyebrow}>
              {page === "swap" ? t("YOU PAY", "你支付") : t("FROM", "从")}
            </Text>
            <View style={s.wrap}>
              {(page === "swap" ? [sources[0]] : sources).map((asset) => (
                <Pressable
                  key={asset.symbol}
                  onPress={() => setAssetSymbol(asset.symbol)}
                  style={{ flexDirection: "row", gap: 8, alignItems: "center", padding: 8 }}
                >
                  <TokenIcon symbol={asset.symbol} size={28} />
                  <Text style={[s.text, assetSymbol === asset.symbol && { fontWeight: "800" }]}>
                    {asset.symbol}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={colors.muted}
              style={{ fontSize: 38, color: colors.ink, fontWeight: "700", paddingTop: 18 }}
            />
          </View>
          {page === "swap" && (
            <>
              <MaterialCommunityIcons
                name="swap-vertical"
                color={colors.green}
                size={28}
                style={{ alignSelf: "center" }}
              />
              <View style={s.panel}>
                <Text style={s.eyebrow}>{t("YOU RECEIVE", "你收到")}</Text>
                <View style={s.wrap}>
                  {selectable.map((asset) => (
                    <Pressable
                      key={asset.symbol}
                      onPress={() => {
                        setAssetSymbol(asset.symbol);
                        setTrade("BUY");
                      }}
                      style={{ flexDirection: "row", gap: 8, alignItems: "center", padding: 8 }}
                    >
                      <TokenIcon symbol={asset.symbol} size={28} />
                      <Text style={[s.text, assetSymbol === asset.symbol && { fontWeight: "800" }]}>
                        {asset.symbol}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </>
          )}
          {page === "bridge" && (
            <>
              <Text style={s.eyebrow}>{t("TO", "到")}</Text>
              <Choices
                options={destinations.map((d) => d.name)}
                value={dest.name}
                select={(name) => {
                  const next = destinations.find((d) => d.name === name)!;
                  setDestination(next.id);
                  setOutSymbol(next.tokens[0].symbol);
                }}
              />
              <View style={s.wrap}>
                {dest.tokens.map((asset) => (
                  <Pressable
                    key={asset.symbol}
                    onPress={() => setOutSymbol(asset.symbol)}
                    style={{ flexDirection: "row", gap: 8, alignItems: "center", padding: 8 }}
                  >
                    <TokenIcon symbol={asset.symbol} size={28} />
                    <Text style={[s.text, output.symbol === asset.symbol && { fontWeight: "800" }]}>
                      {asset.symbol}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Field
                label={t("Destination wallet address", "目标钱包地址")}
                value={recipient}
                onChangeText={setRecipient}
              />
            </>
          )}
          {action(
            "Review live route",
            "审核实时路线",
            page === "bridge" ? prepareBridge : prepareTrade,
          )}
        </>
      );
    }
    if (page === "assistant")
      return (
        <>
          {title(
            "Tera assistant",
            "Tera 助手",
            t(
              "Messages go to the assistant service. Proposals need your review.",
              "消息将发送至助手服务，提案需要你审核。",
            ),
          )}
          <Choices
            options={[t("Ask a question", "提问"), t("Prepare a proposal", "准备提案")]}
            value={propose ? t("Prepare a proposal", "准备提案") : t("Ask a question", "提问")}
            select={(v) => setPropose(v === t("Prepare a proposal", "准备提案"))}
          />
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: minimiseEnabled }}
            onPress={() => setMinimiseEnabled((enabled) => !enabled)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              padding: 15,
              borderRadius: 18,
              backgroundColor: minimiseEnabled ? "#e5f2df" : "#edf0ed",
            }}
          >
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[s.eyebrow, { color: colors.green }]}>
                {t("PROMPT PRIVACY", "PROMPT PRIVACY")}
              </Text>
              <Text style={s.small}>
                {minimiseEnabled
                  ? t(
                      "Review what leaves this phone before sending.",
                      "Review what leaves this phone before sending.",
                    )
                  : t("Messages are sent as typed.", "Messages are sent as typed.")}
              </Text>
            </View>
            <View
              style={{
                width: 38,
                height: 22,
                borderRadius: 20,
                padding: 3,
                justifyContent: "center",
                backgroundColor: minimiseEnabled ? colors.green : "#aab5ad",
              }}
            >
              <View
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 12,
                  backgroundColor: "#ffffff",
                  alignSelf: minimiseEnabled ? "flex-end" : "flex-start",
                }}
              />
            </View>
          </Pressable>
          {data.token && (
            <Text style={s.eyebrow}>{t("Scoped session connected", "已连接限定权限的会话")}</Text>
          )}
          <View style={{ gap: 12 }}>
            {!chat.length && (
              <View style={[s.panel, { alignSelf: "flex-start", maxWidth: "88%" }]}>
                <Text style={[s.eyebrow, { color: colors.green }]}>TERA</Text>
                <Text style={s.text}>
                  {t(
                    "Ask about an asset or tell me what you want to do.",
                    "询问资产，或告诉我你想做什么。",
                  )}
                </Text>
              </View>
            )}
            {chat.map((m, i) => (
              <View
                key={i}
                style={[
                  s.panel,
                  {
                    maxWidth: "88%",
                    alignSelf: m.role === "you" ? "flex-end" : "flex-start",
                    borderBottomRightRadius: m.role === "you" ? 4 : 20,
                    borderBottomLeftRadius: m.role === "you" ? 20 : 4,
                  },
                  m.role === "you" && { backgroundColor: colors.ink },
                ]}
              >
                <Text style={[s.eyebrow, m.role === "you" && { color: "#b9c9bd" }]}>
                  {m.role === "you" ? t("YOU", "你") : "TERA"}
                </Text>
                <Text selectable style={[s.text, m.role === "you" && { color: colors.paper }]}>
                  {m.text.replace(/\*\*(.*?)\*\*/g, "$1").replace(/^#{1,6}\s/gm, "")}
                </Text>
              </View>
            ))}
          </View>
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-end",
              borderWidth: 1,
              borderColor: colors.line,
              borderRadius: 22,
              overflow: "hidden",
              backgroundColor: "#ffffff",
            }}
          >
            <TextInput
              value={message}
              onChangeText={setMessage}
              maxLength={1200}
              multiline
              placeholder={t("Message Tera…", "给 Tera 发消息…")}
              placeholderTextColor={colors.muted}
              style={{ flex: 1, padding: 15, minHeight: 54, color: colors.ink, fontSize: 16 }}
            />
            <Pressable
              disabled={busy || !message.trim()}
              onPress={startAssistantMessage}
              style={{
                width: 56,
                minHeight: 54,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: colors.ink,
                opacity: busy || !message.trim() ? 0.45 : 1,
              }}
            >
              <MaterialCommunityIcons name="arrow-up" color="#ffffff" size={24} />
            </Pressable>
          </View>
          <Text style={s.eyebrow}>{t("PROPOSALS", "提案")}</Text>
          {data.drafts.map((d) => (
            <View style={s.panel} key={d.createdAt}>
              <Text style={s.text}>
                {d.intent?.actionType} ·{" "}
                {
                  assets.find(
                    (a) => a.address.toLowerCase() === d.intent?.assetAddress?.toLowerCase(),
                  )?.symbol
                }
              </Text>
              <Button
                disabled={busy}
                onPress={() => {
                  try {
                    showProposal(d);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                {t("Review", "审核")}
              </Button>
              {action(
                "Delete draft",
                "删除草稿",
                async () =>
                  store({
                    ...dataRef.current,
                    drafts: dataRef.current.drafts.filter((p) => p.createdAt !== d.createdAt),
                  }),
                false,
              )}
            </View>
          ))}
        </>
      );
    if (page === "activity")
      return (
        <>
          {title(
            "Your activity.",
            "你的记录。",
            t(
              "Source confirmation and destination delivery are tracked separately.",
              "源链确认与目标链到账分别跟踪。",
            ),
          )}
          {!data.history.length && (
            <Text style={s.small}>
              {t("Your signed transactions will appear here.", "已签名的交易将显示在这里。")}
            </Text>
          )}
          {data.history.map((r) => (
            <View key={r.hash} style={s.panel}>
              <Text style={s.text}>{r.title}</Text>
              <Text style={s.eyebrow}>
                {r.status} · {r.step}/{r.totalSteps}
              </Text>
              <Text selectable style={s.mono}>
                {r.hash}
              </Text>
              {r.reference && (
                <Text selectable style={s.small}>
                  Relay: {r.reference}
                </Text>
              )}
              {action(
                "Check status",
                "检查状态",
                async (g) => {
                  const sourceStatus = await transactionStatus(r.hash);
                  g();
                  let delivery = r.delivery;
                  if (r.reference && sourceStatus === "confirmed") {
                    const result = await api(`/api/bridge/status/${r.reference}`);
                    g();
                    delivery = result.status.status;
                  }
                  await store({
                    ...dataRef.current,
                    history: dataRef.current.history.map((h) =>
                      h.hash === r.hash ? { ...h, status: sourceStatus, delivery } : h,
                    ),
                  });
                  if (r.actionHash && sourceStatus === "confirmed") {
                    await api("/api/intent/receipt", {
                      actionHash: r.actionHash,
                      txHash: r.hash,
                      recipient: r.recipient,
                    });
                  }
                },
                false,
              )}
              {r.delivery && <Row label={t("Relay delivery", "Relay 到账")} value={r.delivery} />}
              <Button
                onPress={() =>
                  void Linking.openURL(`https://robinhoodchain.blockscout.com/tx/${r.hash}`)
                }
              >
                {t("View on explorer", "在浏览器查看")}
              </Button>
            </View>
          ))}
        </>
      );
    if (settingsSection === "root")
      return (
        <>
          {title(
            "Settings.",
            "设置。",
            t("Manage your wallet one area at a time.", "按类别管理你的钱包。"),
          )}
          {[
            ["security", "Security", "安全", "Recovery phrase, biometrics and lock"],
            ["privacy", "Privacy & data", "隐私与数据", "Retention and deletion controls"],
            ["sessions", "Agent sessions", "代理会话", "Connect, create and revoke scoped tokens"],
            ["device", "Wallet on this device", "本设备钱包", "Address and device controls"],
          ].map(([section, en, zh, detail]) => (
            <Pressable
              key={section}
              onPress={() => setSettingsSection(section as any)}
              style={[
                s.panel,
                {
                  backgroundColor: "#ffffff",
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                },
              ]}
            >
              <View>
                <Text style={s.text}>{t(en, zh)}</Text>
                <Text style={s.small}>{detail}</Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={24} color={colors.green} />
            </Pressable>
          ))}
        </>
      );
    if (settingsSection === "security")
      return (
        <>
          <Button onPress={() => setSettingsSection("root")}>{t("Settings", "设置")}</Button>
          {title("Security.", "安全。")}
          <Button
            disabled={busy}
            onPress={() =>
              authenticate(t("Show recovery phrase", "显示助记词"), async () =>
                setRevealed(vault.revealPhrase()),
              )
            }
          >
            {t("Show recovery phrase", "显示助记词")}
          </Button>
          <Field
            label={t("Password to enable biometrics", "启用生物识别所需的密码")}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          {action(
            "Enable biometric unlock",
            "启用生物识别解锁",
            async () => {
              await vault.enableBiometrics(password);
              setPassword("");
            },
            false,
          )}
          <Button onPress={forget}>{t("Lock now", "立即锁定")}</Button>
        </>
      );
    if (settingsSection === "privacy")
      return (
        <>
          <Button onPress={() => setSettingsSection("root")}>{t("Settings", "设置")}</Button>
          {title("Privacy & data.", "隐私与数据。")}
          <Text style={s.small}>
            {t(
              "Drafts and activity are encrypted on this device.",
              "草稿和记录在此设备上加密保存。",
            )}
          </Text>
          <Choices
            options={["7", "30", "90", "365"]}
            value={String(data.retention)}
            select={(v) =>
              void run(async () => {
                const cutoff = Date.now() - Number(v) * 86400000;
                await store({
                  ...dataRef.current,
                  retention: Number(v),
                  drafts: dataRef.current.drafts.filter((d) => d.createdAt > cutoff),
                  history: dataRef.current.history.filter(
                    (h) => h.createdAt > cutoff || ["pending", "broadcasting"].includes(h.status),
                  ),
                });
              })
            }
          />
          <Button
            disabled={busy}
            onPress={() =>
              confirm(
                t("Delete assistant data", "删除助手数据"),
                t("Remove messages and drafts from this device?", "删除此设备上的消息和草稿？"),
                () =>
                  void run(async () => {
                    setChat([]);
                    await store({ ...dataRef.current, drafts: [] });
                    setNotice({
                      title: t("Deleted", "已删除"),
                      body: t("Local assistant data was removed.", "本地助手数据已删除。"),
                      tone: "success",
                    });
                  }),
              )
            }
          >
            {t("Delete local assistant data", "删除本地助手数据")}
          </Button>
        </>
      );
    if (settingsSection === "sessions")
      return (
        <>
          <Button onPress={() => setSettingsSection("root")}>{t("Settings", "设置")}</Button>
          {title("Agent sessions.", "代理会话。")}
          <Field
            label={t("Connect a scoped token", "连接限定权限令牌")}
            value={tokenInput}
            onChangeText={setTokenInput}
            secureTextEntry
          />
          {action(
            "Connect token",
            "连接令牌",
            async () => {
              check(tokenInput.trim().length >= 32);
              await store({ ...dataRef.current, token: tokenInput.trim() });
              setTokenInput("");
              setNotice({
                title: t("Token connected", "令牌已连接"),
                body: t(
                  "The token can prepare proposals but cannot sign.",
                  "令牌可以准备提案，但不能签名。",
                ),
                tone: "success",
              });
            },
            false,
          )}
          {data.token &&
            action(
              "Disconnect token",
              "断开令牌",
              async () => store({ ...dataRef.current, token: "" }),
              false,
            )}
          {action(
            "Create transfer session",
            "创建转账会话",
            async (g) => {
              const result = await api("/api/session/issue", {
                accountAddress: owner,
                allowedActions: ["TRANSFER"],
                assetAddresses: [USDG],
                ttlSeconds: 3600,
              });
              g();
              await store({ ...dataRef.current, token: result.token });
            },
            false,
          )}
        </>
      );
    if (settingsSection === "device")
      return (
        <>
          <Button onPress={() => setSettingsSection("root")}>{t("Settings", "设置")}</Button>
          {title("This device.", "此设备。")}
          <Row label={t("Wallet", "钱包")} value={owner} />
          <Button
            disabled={busy}
            onPress={() =>
              authenticate(t("Erase wallet", "删除钱包"), async () =>
                confirm(
                  t("Erase this device’s wallet?", "删除此设备的钱包？"),
                  t("You will need your recovery phrase.", "恢复需要助记词。"),
                  () =>
                    void run(async () => {
                      await vault.eraseWallet();
                      forget();
                      setExists(false);
                    }),
                ),
              )
            }
          >
            {t("Erase wallet from device", "从此设备删除钱包")}
          </Button>
        </>
      );
    return (
      <>
        {title("Your rules.", "你的规则。")}
        <Row label={t("Wallet", "钱包")} value={owner} />
        <Text style={s.eyebrow}>{t("SECURITY", "安全")}</Text>
        <Button
          disabled={busy}
          onPress={() =>
            authenticate(t("Show recovery phrase", "显示助记词"), async () =>
              setRevealed(vault.revealPhrase()),
            )
          }
        >
          {t("Show recovery phrase", "显示助记词")}
        </Button>
        <Field
          label={t("Password to enable biometrics", "启用生物识别所需的密码")}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        {action(
          "Enable biometric unlock",
          "启用生物识别解锁",
          async () => {
            await vault.enableBiometrics(password);
            setPassword("");
          },
          false,
        )}
        <Button onPress={forget}>{t("Lock now", "立即锁定")}</Button>
        <Text style={s.eyebrow}>{t("DATA & PRIVACY", "数据与隐私")}</Text>
        <Text style={s.small}>
          {t(
            "Drafts and activity are encrypted on this device. Assistant messages stay in memory. The assistant provider and Relay receive only the information needed for their requests.",
            "草稿和记录在此设备上加密保存，助手消息仅保留在内存中。助手提供商及 Relay 仅接收请求所需的信息。",
          )}
        </Text>
        <Choices
          options={["7", "30", "90", "365"]}
          value={String(data.retention)}
          select={(v) =>
            void run(async () => {
              const cutoff = Date.now() - Number(v) * 86400000;
              await store({
                ...dataRef.current,
                retention: Number(v),
                drafts: dataRef.current.drafts.filter((d) => d.createdAt > cutoff),
                history: dataRef.current.history.filter(
                  (h) => h.createdAt > cutoff || ["pending", "broadcasting"].includes(h.status),
                ),
              });
            })
          }
        />
        <Text style={s.small}>
          {t(
            "Days to keep local history. Pending transactions are retained.",
            "本地记录保留天数，待处理交易将被保留。",
          )}
        </Text>
        <Button
          disabled={busy}
          onPress={() =>
            confirm(
              t("Delete assistant data", "删除助手数据"),
              t("Remove messages and drafts from this device?", "删除此设备上的消息和草稿？"),
              () =>
                void run(async () => {
                  setChat([]);
                  await store({ ...dataRef.current, drafts: [] });
                }),
            )
          }
        >
          {t("Delete local assistant data", "删除本地助手数据")}
        </Button>
        <Button
          disabled={busy}
          onPress={() =>
            authenticate(t("Delete stored proposal data", "删除服务器提案数据"), async () => {
              const timestamp = Date.now();
              const signature = await vault.currentAccount().signMessage({
                message: `Tera Wallet data deletion\nWallet: ${owner.toLowerCase()}\nTimestamp: ${timestamp}`,
              });
              await api(`/api/account/${owner}/assistant-data`, { signature, timestamp }, "DELETE");
            })
          }
        >
          {t("Delete stored proposal data", "删除服务器提案数据")}
        </Button>
        <Text style={s.eyebrow}>{t("AGENT SESSIONS", "代理会话")}</Text>
        <Field
          label={t("Connect a scoped token", "连接限定权限令牌")}
          value={tokenInput}
          onChangeText={setTokenInput}
          secureTextEntry
        />
        {action(
          "Connect token",
          "连接令牌",
          async () => {
            check(tokenInput.trim().length >= 32);
            await store({ ...dataRef.current, token: tokenInput.trim() });
            setTokenInput("");
          },
          false,
        )}
        {data.token &&
          action(
            "Disconnect token",
            "断开令牌",
            async () => store({ ...dataRef.current, token: "" }),
            false,
          )}
        <Text style={s.small}>
          {t(
            "Tokens can prepare proposals; they cannot sign. Create a one-hour USDG transfer session below.",
            "令牌可以准备提案，但不能签名。可在下方创建一小时的 USDG 转账会话。",
          )}
        </Text>
        {action(
          "Create transfer session",
          "创建转账会话",
          async (g) => {
            const result = await api("/api/session/issue", {
              accountAddress: owner,
              allowedActions: ["TRANSFER"],
              assetAddresses: [USDG],
              ttlSeconds: 3600,
            });
            g();
            await store({ ...dataRef.current, token: result.token });
          },
          false,
        )}
        {action(
          "Load sessions",
          "加载会话",
          async (g) => {
            const result = await api(`/api/session/${owner}`);
            g();
            setSessions(result.sessions || []);
          },
          false,
        )}
        {sessions.map((session) => (
          <View key={session.id} style={s.panel}>
            <Text style={s.small}>
              {session.scope?.allowedActions?.join(", ")} ·{" "}
              {session.expires_at || session.expiresAt}
            </Text>
            {action(
              "Revoke",
              "撤销",
              async (g) => {
                await api("/api/session/revoke", {
                  accountAddress: owner,
                  sessionKeyAddress: session.session_key_address || session.sessionKeyAddress,
                });
                g();
                setSessions([]);
                await store({ ...dataRef.current, token: "" });
              },
              false,
            )}
          </View>
        ))}
        <Button
          disabled={busy}
          onPress={() =>
            authenticate(t("Erase wallet", "删除钱包"), async () => {
              confirm(
                t("Erase this device’s wallet?", "删除此设备的钱包？"),
                t(
                  "You will need your recovery phrase. This deletes the wallet and encrypted local history.",
                  "此操作将删除钱包和本地加密记录，恢复需要助记词。",
                ),
                () =>
                  void run(async () => {
                    await vault.eraseWallet();
                    forget();
                    setExists(false);
                  }),
              );
            })
          }
        >
          {t("Erase wallet from device", "从此设备删除钱包")}
        </Button>
      </>
    );
  }
  return (
    <SafeAreaView
      style={s.page}
      onTouchStart={() => {
        inactivity.current = Date.now();
      }}
    >
      <StatusBar style="dark" />
      <View style={s.header}>
        <Pressable
          onPress={() => (owner ? setPage("home") : setSetup("start"))}
          style={{ flexDirection: "row", alignItems: "center", gap: 9 }}
        >
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              overflow: "hidden",
              backgroundColor: colors.dark,
            }}
          >
            <Image
              source={require("./assets/icon.png")}
              style={{ width: 32, height: 32 }}
              resizeMode="cover"
            />
          </View>
          <View>
            <Text style={{ color: colors.ink, fontWeight: "800", fontSize: 14 }}>Tera Wallet</Text>
          </View>
        </Pressable>
        <View
          style={{
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: 14,
            paddingHorizontal: 10,
            paddingVertical: 7,
          }}
        >
          {languageControl}
        </View>
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            owner ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={pullRefresh}
                tintColor={colors.green}
              />
            ) : undefined
          }
        >
          {owner ? main() : onboarding()}
        </ScrollView>
      </KeyboardAvoidingView>
      {owner && (
        <View style={s.tabs}>
          {[
            ["wallet-outline", "Wallet", "钱包", "home"],
            ["message-text-outline", "Assistant", "助手", "assistant"],
            ["history", "Activity", "记录", "activity"],
            ["cog-outline", "Settings", "设置", "settings"],
          ].map(([icon, en, zh, p]) => (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: page === p }}
              style={[s.tab, page === p && { backgroundColor: "#2b4235" }]}
              key={p}
              disabled={busy}
              onPress={() => {
                setError("");
                if (p === "settings") setSettingsSection("root");
                setPage(p);
              }}
            >
              <MaterialCommunityIcons
                name={icon as any}
                size={19}
                color={page === p ? colors.lime : "#9baea2"}
              />
              <Text
                style={[
                  s.small,
                  {
                    color: page === p ? "#ffffff" : "#c1cec5",
                    fontWeight: page === p ? "700" : "500",
                  },
                ]}
              >
                {t(en, zh)}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      <Modal
        visible={!!minimisePlan && !!owner}
        animationType="slide"
        onRequestClose={() => !busy && setMinimisePlan(null)}
      >
        <SafeAreaView style={s.page}>
          <ScrollView contentContainerStyle={s.content}>
            {title(
              "Review private prompt",
              "Review private prompt",
              t(
                "Your message is processed on this phone first. Placeholder values are restored only in the reply shown here.",
                "Your message is processed on this phone first. Placeholder values are restored only in the reply shown here.",
              ),
            )}
            <Text style={s.eyebrow}>{t("WHAT YOU TYPED", "WHAT YOU TYPED")}</Text>
            <View style={[s.panel, { backgroundColor: "#ffffff" }]}>
              <Text selectable style={s.text}>
                {minimisePlan?.text}
              </Text>
            </View>
            <Text style={s.eyebrow}>{t("WHAT LEAVES THIS PHONE", "WHAT LEAVES THIS PHONE")}</Text>
            <View style={[s.panel, { backgroundColor: colors.dark }]}>
              <Text selectable style={[s.text, { color: "#ffffff" }]}>
                {minimisePlan?.skeleton}
              </Text>
            </View>
            <Text style={s.small}>
              {t(
                `${minimisePlan?.placeholders.length || 0} values are replaced locally. This removes literal values from the message; it does not make you anonymous.`,
                `${minimisePlan?.placeholders.length || 0} values are replaced locally. This removes literal values from the message; it does not make you anonymous.`,
              )}
            </Text>
            {!!minimisePlan?.kept.length && (
              <Text style={s.small}>
                {t(
                  "A transaction proposal keeps its recipient and amount so it can be prepared. They are shown above.",
                  "A transaction proposal keeps its recipient and amount so it can be prepared. They are shown above.",
                )}
              </Text>
            )}
            <Button
              primary
              disabled={busy}
              onPress={() => {
                const plan = minimisePlan;
                setMinimisePlan(null);
                if (plan) void run((guard) => deliverAssistantMessage(guard, plan));
              }}
            >
              {t("Send minimised", "Send minimised")}
            </Button>
            <Button
              disabled={busy}
              onPress={() => {
                setMinimisePlan(null);
                void run((guard) => deliverAssistantMessage(guard));
              }}
            >
              {t("Send as typed", "Send as typed")}
            </Button>
            <Button disabled={busy} onPress={() => setMinimisePlan(null)}>
              {t("Cancel", "Cancel")}
            </Button>
          </ScrollView>
        </SafeAreaView>
      </Modal>
      <Modal
        visible={!!review && !!owner}
        transparent
        animationType="slide"
        onRequestClose={() => !busy && setReview(null)}
      >
        <View style={{ flex: 1, backgroundColor: "#10221988", justifyContent: "flex-end" }}>
          <SafeAreaView
            edges={["bottom"]}
            style={{
              maxHeight: "88%",
              backgroundColor: colors.paper,
              borderTopLeftRadius: 30,
              borderTopRightRadius: 30,
              overflow: "hidden",
            }}
          >
            <ScrollView contentContainerStyle={[s.content, { paddingTop: 24 }]}>
              <View
                style={{
                  alignSelf: "center",
                  width: 42,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: colors.line,
                }}
              />
              {title(review?.title || "", review?.title || "")}
              <View
                style={[
                  s.panel,
                  { backgroundColor: review?.simulation === "passed" ? "#e5f2df" : "#f3eee5" },
                ]}
              >
                <Text style={[s.eyebrow, { color: colors.green }]}>
                  {review?.simulation === "checking"
                    ? t("SIMULATING", "正在模拟")
                    : review?.simulation === "passed"
                      ? t("SIMULATION PASSED", "模拟通过")
                      : t("SIMULATION NEEDS ATTENTION", "模拟需要注意")}
                </Text>
                <Text style={s.small}>
                  {review?.simulation === "passed"
                    ? t(
                        "The wallet simulated these exact transaction steps.",
                        "钱包已模拟这些准确交易步骤。",
                      )
                    : t(
                        "The final wallet check runs again before signing.",
                        "签名前将再次执行钱包检查。",
                      )}
                </Text>
              </View>
              {review?.rows.map(([label, value], i) => (
                <Row key={i} label={label} value={value} />
              ))}
              <Text style={s.eyebrow}>{t("TRANSACTION CHANGES", "交易变更")}</Text>
              {review?.steps.map((step, index) => (
                <Row
                  key={`${step.to}-${index}`}
                  label={`${t("Step", "步骤")} ${index + 1}`}
                  value={`${step.data === "0x" ? t("Native transfer", "原生转账") : t("Contract call", "合约调用")} · ${step.to.slice(0, 8)}…${step.to.slice(-4)}`}
                />
              ))}
              {signing && (
                <View
                  style={[
                    s.panel,
                    {
                      backgroundColor: colors.dark,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                    },
                  ]}
                >
                  <ActivityIndicator color={colors.lime} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.eyebrow, { color: colors.lime }]}>
                      {t("SIGNING IN PROGRESS", "正在签名")}
                    </Text>
                    <Text style={[s.small, { color: "#ffffff" }]}>
                      {progress || t("Preparing your signed transaction…", "正在准备已签名交易…")}
                    </Text>
                  </View>
                </View>
              )}
              {auth && !signing && (
                <View
                  style={[
                    s.panel,
                    { backgroundColor: "#ffffff", borderWidth: 1, borderColor: colors.green },
                  ]}
                >
                  <Text style={s.eyebrow}>{t("CONFIRM WITH YOUR WALLET", "使用钱包确认")}</Text>
                  <Text style={s.text}>
                    {t(
                      "Enter your PIN to sign this exact transaction.",
                      "输入 PIN 以签署这笔准确交易。",
                    )}
                  </Text>
                  <Field
                    label={
                      pinWallet ? t("Wallet PIN", "钱包 PIN") : t("Wallet password", "钱包密码")
                    }
                    value={authPassword}
                    onChangeText={setAuthPassword}
                    secureTextEntry
                    keyboardType={pinWallet ? "number-pad" : "default"}
                    maxLength={pinWallet ? 6 : undefined}
                  />
                  {action("Sign transaction", "签署交易", (g) => authorize(false, g))}
                  <Button
                    disabled={busy}
                    onPress={() => {
                      setAuth(null);
                      setAuthPassword("");
                    }}
                  >
                    {t("Cancel signing", "取消签名")}
                  </Button>
                </View>
              )}
              <Text style={s.small}>
                {t(
                  "Network fees are additional, capped at 0.001 ETH per transaction step. This authorizes only the reviewed steps.",
                  "网络手续费另计，每个交易步骤上限为 0.001 ETH，此操作仅授权已审核的步骤。",
                )}
              </Text>
              <Button
                primary
                disabled={busy || signing || review?.simulation === "checking"}
                onPress={() => {
                  const r = review!;
                  authenticate(t("Authorize transaction", "授权交易"), () => signReview(r));
                }}
              >
                {signing ? (
                  <ActivityIndicator color={colors.paper} />
                ) : auth ? (
                  t("Enter PIN below", "在下方输入 PIN")
                ) : busy ? (
                  <ActivityIndicator color={colors.paper} />
                ) : (
                  t("Unlock & sign", "解锁并签名")
                )}
              </Button>
              <Button disabled={busy || signing} onPress={() => setReview(null)}>
                {t("Cancel", "取消")}
              </Button>
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
      <Modal
        visible={!!notice}
        transparent
        animationType="slide"
        onRequestClose={() => setNotice(null)}
      >
        <Pressable
          onPress={() => setNotice(null)}
          style={{ flex: 1, backgroundColor: "#10221988", justifyContent: "flex-end" }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: colors.paper,
              borderTopLeftRadius: 30,
              borderTopRightRadius: 30,
              padding: 24,
              gap: 14,
            }}
          >
            <MaterialCommunityIcons
              name={notice?.tone === "error" ? "alert-circle-outline" : "check-circle-outline"}
              size={32}
              color={notice?.tone === "error" ? colors.danger : colors.green}
            />
            <Text style={s.title}>{notice?.title}</Text>
            <Text style={s.text}>{notice?.body}</Text>
            <Button primary onPress={() => setNotice(null)}>
              {t("Done", "完成")}
            </Button>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        visible={!!auth && !!owner && !review}
        transparent
        animationType="fade"
        onRequestClose={() => !busy && setAuth(null)}
      >
        <View
          style={{ flex: 1, backgroundColor: "#17291edd", justifyContent: "center", padding: 24 }}
        >
          <View style={[s.panel, { backgroundColor: colors.paper }]}>
            <Text style={s.text}>{auth?.title}</Text>
            <Field
              label={pinWallet ? t("Wallet PIN", "钱包 PIN") : t("Wallet password", "钱包密码")}
              value={authPassword}
              onChangeText={setAuthPassword}
              secureTextEntry
              keyboardType={pinWallet ? "number-pad" : "default"}
              maxLength={pinWallet ? 6 : undefined}
            />
            {action("Authorize", "授权", (g) => authorize(false, g))}
            {action("Use biometrics", "使用生物识别", (g) => authorize(true, g), false)}
            <Button
              disabled={busy}
              onPress={() => {
                setAuth(null);
                setAuthPassword("");
              }}
            >
              {t("Cancel", "取消")}
            </Button>
          </View>
        </View>
      </Modal>
      <Modal visible={!!revealed && !!owner} onRequestClose={() => setRevealed("")}>
        <SafeAreaView style={s.page}>
          <View style={s.content}>
            {title("Recovery phrase.", "助记词。")}
            <Text style={s.small}>
              {t(
                "Write this down privately. Never send it to anyone.",
                "请私下记好，切勿发送给任何人。",
              )}
            </Text>
            <Text style={[s.mono, { fontSize: 20, lineHeight: 36 }]}>{revealed}</Text>
            <Button onPress={() => setRevealed("")}>{t("Done", "完成")}</Button>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <Wallet />
    </SafeAreaProvider>
  );
}
