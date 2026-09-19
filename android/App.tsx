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
import { formatUnits, parseUnits, zeroAddress, isAddress, type Address } from "viem";
import { api } from "./src/api";
import { Asset, chain, destinations, sources, Tx, USDG } from "./src/config";
import * as tags from "./src/tags";
const tagsAvailable = () => tags.tagsAvailable();
import * as upd from "./src/update";
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
  afterSubmitted?: (hash: string) => Promise<void>;
  simulation?: "checking" | "passed" | "needs-attention";
  isPrivateBridge?: boolean;
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
  TERA: require("./assets/icon.png"),
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
    // Which kind of destination the owner is entering. A tag and an address
    // fail in different ways and are checked differently, so the field asks
    // rather than guessing from what has been typed so far.
    [recipientKind, setRecipientKind] = useState<"tag" | "address">("address"),
    // What the registry last said. `address` is the only thing a transfer is
    // ever built from; the tag beside it is for the owner to read.
    [tagLookup, setTagLookup] = useState<
      | { state: "idle" }
      | { state: "looking"; tag: string }
      | { state: "found"; tag: string; address: Address }
      | { state: "error"; message: string }
    >({ state: "idle" }),
    [myTag, setMyTag] = useState<string | null>(null),
    [claimInput, setClaimInput] = useState(""),
    [claimDismissed, setClaimDismissed] = useState(false),
    [, setTagsOn] = useState(false),
    // What the published build is, if the check got an answer. Null means the
    // check has not run or could not be made — never "you are up to date",
    // which would be a claim this app did not verify.
    [update, setUpdate] = useState<upd.UpdateDecision | null>(null),
    [updateStage, setUpdateStage] = useState<
      "idle" | "downloading" | "verifying" | "installing"
    >("idle"),
    [updateProgress, setUpdateProgress] = useState(0),
    [assetSymbol, setAssetSymbol] = useState("USDG"),
    [privateAsset, setPrivateAsset] = useState<"ETH" | "TERA">("ETH"),
    [sendMode, setSendMode] = useState<"public" | "private">("public"),
    [bridgeMode, setBridgeMode] = useState<"public" | "private">("public");
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
    setRecipientKind("address");
    setTagLookup({ state: "idle" });
    setMyTag(null);
    setClaimInput("");
    setClaimDismissed(false);
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
    // Asked once, on launch, and never retried in a loop: an update is not
    // urgent enough to keep a phone talking to the network about it.
    void upd.checkForUpdate().then(setUpdate);
    // Whether this deployment keeps a tag register at all. Off until it says
    // yes, so a failed call hides the controls rather than offering ones that
    // cannot work.
    void tags.loadTagConfig().then(setTagsOn);
  }, []);
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
    const teraAsset: Asset = {
      symbol: "TERA",
      address: "0x3c12e57fa7817a86ce7c254db9ea5fe639e233f8",
      decimals: 18,
      name: "Tera",
    };
    const supported = [
      ...sources,
      teraAsset,
      ...registry.filter((a) => !sources.some((s) => s.symbol === a.symbol) && a.symbol !== "TERA"),
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
    // Whether this wallet already has a name. Read from the registry, and a
    // failure leaves it unknown rather than answering "no" — an owner who
    // already holds a tag must not be asked to claim one over a dropped call.
    if (tagsAvailable())
      await tags
        .tagOf(address)
        .then((held) => {
          if (version === vault.sessionVersion()) setMyTag(held);
        })
        .catch(() => {});
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
  /**
   * Check the destination before the review sheet, on the screen where it was
   * typed. An address is checked for shape; a tag is resolved against the
   * registry and the address it resolved to is shown, because that address is
   * what the owner is actually agreeing to.
   */
  async function resolveRecipientStep() {
    if (recipientKind === "address") {
      setTagLookup({ state: "idle" });
      if (isAddress(recipient.trim())) return true;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setNotice({
        title: t("Check the address", "请检查地址"),
        body: t("Enter a valid recipient address.", "请输入有效收款地址。"),
        tone: "error",
      });
      return false;
    }
    const typed = recipient.trim();
    setTagLookup({ state: "looking", tag: typed.replace(/^@+/, "") });
    try {
      const found = await tags.resolveTag(typed);
      setTagLookup({ state: "found", tag: found.tag, address: found.address });
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : t("Lookup failed.", "查询失败。");
      setTagLookup({ state: "error", message });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setNotice({ title: t("Tag not found", "未找到标签"), body: message, tone: "error" });
      return false;
    }
  }
  function continueSend() {
    if (flowStep === 0) {
      if (sendMode === "private" && assetSymbol !== "ETH" && assetSymbol !== "TERA") {
        setAssetSymbol("ETH");
        setPrivateAsset("ETH");
      }
      setFlowStep(1);
      return;
    }
    if (flowStep === 1) {
      setFlowStep(2);
      return;
    }
    if (flowStep === 2) {
      try {
        const decimals = selectedAsset.decimals;
        const requested = BigInt(units(amount, decimals));
        const available = BigInt(balance?.[selectedAsset.symbol] || "0");
        if (requested > available) {
          setAmountInvalid(true);
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setNotice({
            title: t("Insufficient balance", "余额不足"),
            body: t(
              `You have ${formatUnits(available, decimals)} ${selectedAsset.symbol} available.`,
              `可用余额为 ${formatUnits(available, decimals)} ${selectedAsset.symbol}。`,
            ),
            tone: "error",
          });
          return;
        }
        setAmountInvalid(false);
        setFlowStep(3);
      } catch (e) {
        setAmountInvalid(true);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setNotice({
          title: t("Enter an amount", "输入金额"),
          body: e instanceof Error ? e.message : t("Enter a valid amount.", "请输入有效金额。"),
          tone: "error",
        });
      }
      return;
    }
    if (flowStep === 3) {
      void (async () => {
        if (await resolveRecipientStep()) setFlowStep(4);
      })();
      return;
    }
  }
  async function prepareTransfer(guard: () => void) {
    // Resolved again here rather than reusing what the previous screen found.
    // A tag can be released and re-claimed between the two, and the address
    // that gets signed must be the one the registry holds now.
    const destination =
      recipientKind === "tag" ? (await tags.resolveTag(recipient)).address : recipient.trim();
    guard();
    const input = {
      ownerAddress: owner,
      accountAddress: owner,
      assetAddress: selectedAsset.address,
      actionType: "TRANSFER",
      recipient: destination,
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
  /**
   * Claim a name for this wallet.
   *
   * Signed here with the owner's key; Tera records it. The signature stops a
   * claim being forged on the way, not Tera rewriting the register later —
   * the claim screen says which of those it is.
   */
  async function claimTagNow(guard: () => void) {
    const account = vault.currentAccount();
    const { tag } = await tags.claimTag(account as never, claimInput);
    guard();
    setMyTag(tag);
    setClaimInput("");
    setClaimDismissed(true);
    setNotice({
      title: t("Tag claimed", "标签已领取"),
      body: t(
        `${tags.display(tag)} now points at this wallet in Tera's tag register.`,
        `${tags.display(tag)} 现已在 Tera 标签注册表中指向此钱包。`,
      ),
      tone: "success",
    });
    setPage("home");
  }
  /**
   * Take whichever update is actually available.
   *
   * JavaScript first, because it is seconds rather than tens of megabytes and
   * needs no install screen. If there is none waiting — which is the case for
   * anything that changed the app's native side — the APK is downloaded here,
   * checked against the digest the build published, and handed to Android's
   * installer, which shows its own screen that no app can skip.
   */
  async function runUpdate(guard: () => void) {
    if (!update) return;
    if (upd.javascriptUpdatesEnabled()) {
      // Applying restarts the app, so this never runs while something is in
      // flight: `run` holds the pending lock for the whole call.
      const applied = await upd.applyJavascriptUpdate();
      guard();
      if (applied === "applied") return;
    }
    setUpdateStage("downloading");
    setUpdateProgress(0);
    try {
      const file = await upd.downloadApk(update.manifest, setUpdateProgress);
      guard();
      setUpdateStage("installing");
      await upd.installApk(file);
    } finally {
      setUpdateStage("idle");
    }
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
  async function preparePrivateSend(guard: () => void) {
    const asset = selectedAsset.symbol;
    const decimals = selectedAsset.decimals;
    const raw = units(amount, decimals);
    // Resolved here for the same reason a direct transfer resolves again: the
    // recipient screen may have been left on a tag, and a tag can change hands
    // between that screen and this one. The payout goes where the registry
    // points now, not where it pointed when the owner typed the name.
    const destination =
      recipientKind === "tag" ? (await tags.resolveTag(recipient)).address : recipient.trim();
    guard();
    check(isAddress(destination), t("Enter a valid recipient address.", "请输入有效收款地址。"));
    const created = await api("/api/private-send/jobs", {
      asset,
      amount: raw,
      senderAddress: owner,
      recipientAddress: destination,
    });
    guard();
    const tx = created.preparedDeposit;
    await presentReview({
      title: t("Review private route", "审核私密路由"),
      rows: [
        [t("Asset", "资产"), asset],
        [t("Amount", "金额"), `${amount} ${asset}`],
        [t("Recipient", "收款方"), destination],
        [t("Routing", "路由"), t("Intake → payout → recipient", "接收 → 支付 → 收款方")],
      ],
      steps: [{ to: tx.to, data: tx.data, value: BigInt(tx.value).toString(), chainId: chain.id }],
      verify: () =>
        transferTx(
          selectedAsset.symbol === "ETH" ? zeroAddress : (selectedAsset.address as Address),
          created.job.intake_address,
          raw,
        ),
      recipient: created.job.intake_address,
      reference: created.job.id,
      afterSubmitted: async (hash) => {
        await api(`/api/private-send/jobs/${created.job.id}/deposit`, { txHash: hash });
      },
    });
  }
  async function preparePrivateBridge(guard: () => void) {
    const source = sources.find((s) => s.symbol === assetSymbol) || sources[0];
    check(
      source.symbol === "ETH",
      t(
        "Private bridge currently supports native ETH. USDG will be available in Update 4.",
        "私密跨链当前支持原生 ETH，USDG 即将在更新 4 中推出。",
      ),
    );
    const destAddr = recipient.trim();
    check(
      dest.id === 792703809
        ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(destAddr)
        : isAddress(destAddr),
      t("Enter a valid destination wallet address.", "请输入有效目标钱包地址。"),
    );
    const raw = units(amount, source.decimals);
    const quoteRes = await api("/api/bridge/private/quote", {
      ownerAddress: owner,
      recipient: destAddr,
      originCurrency: source.address,
      destinationChainId: dest.id,
      destinationCurrency: output.address,
      amount: raw,
    });
    guard();

    const quote = quoteRes.quote;
    const created = await api("/api/bridge/private/jobs", {
      senderAddress: owner,
      destinationChainId: dest.id,
      destinationCurrency: output.address,
      destinationSymbol: output.symbol,
      recipient: destAddr,
      amount: raw,
      quoteRequestId: quote.requestId,
      expectedAmountOut: quote.amountOut,
      minAmountOut: quote.minimumAmountOut,
    });
    guard();

    const tx = created.preparedDeposit;
    await presentReview({
      title: t("Review private bridge", "审核私密跨链"),
      rows: [
        [t("Send", "发送"), `${amount} ${source.symbol}`],
        [t("Destination", "目标网络"), `${dest.name} · ${output.symbol}`],
        [t("Recipient", "收款地址"), destAddr],
        [
          t("Routing", "路由"),
          t("Bridge vault → Relay → recipient", "跨链金库 → Relay → 收款方"),
        ],
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
      steps: [{ to: tx.to, data: tx.data, value: BigInt(tx.value).toString(), chainId: chain.id }],
      verify: () => {
        transferTx(zeroAddress, created.job.vault_address, raw);
      },
      recipient: created.job.vault_address,
      reference: created.job.id,
      isPrivateBridge: true,
      afterSubmitted: async (hash) => {
        await api(`/api/bridge/private/jobs/${created.job.id}/deposit`, { txHash: hash });
      },
    });
  }
  async function prepareBridge(guard: () => void) {
    if (bridgeMode === "private") {
      await preparePrivateBridge(guard);
      return;
    }
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
      let submittedHash = "";
      await execute(
        r.steps,
        r.verify,
        async (record) => {
          if (record.step === record.totalSteps) submittedHash = record.hash;
          const row = {
            ...record,
            title: r.title,
            recipient: r.recipient,
            reference: record.step === record.totalSteps ? r.reference : undefined,
            bridgeInput: record.step === record.totalSteps ? r.bridgeInput : undefined,
            actionHash: record.step === record.totalSteps ? r.actionHash : undefined,
            isPrivateBridge: record.step === record.totalSteps ? r.isPrivateBridge : undefined,
          };
          await store({
            ...dataRef.current,
            history: [row, ...dataRef.current.history.filter((h) => h.hash !== row.hash)],
            drafts: dataRef.current.drafts.filter((d) => !r.draftId || d.createdAt !== r.draftId),
          });
        },
        setProgress,
      );
      if (r.afterSubmitted && submittedHash) await r.afterSubmitted(submittedHash);
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
          {/*
            Asked for, not demanded. This wallet holds money, and a screen that
            refused to open until a name was claimed would put a backend call
            between an owner and their own funds. It reappears every launch
            until it is dealt with, which gets to the same place without that.
          */}
          {update && update.state !== upd.CURRENT && (
            <View style={s.panel}>
              <Text style={s.text}>
                {update.state === upd.REQUIRED
                  ? t("Update required", "需要更新")
                  : t("Update available", "有可用更新")}
              </Text>
              <Text style={s.small}>
                {update.state === upd.REQUIRED
                  ? t(
                      "This build is below the supported version. Update to keep using it safely.",
                      "此版本低于受支持的版本。请更新以继续安全使用。",
                    )
                  : t(
                      `Version ${update.manifest.versionName} is published.`,
                      `版本 ${update.manifest.versionName} 已发布。`,
                    )}
              </Text>
              <Button primary onPress={() => setPage("update")}>
                {t("Update", "更新")}
              </Button>
            </View>
          )}
          {tagsAvailable() && myTag === null && !claimDismissed && (
            <View style={s.panel}>
              <Text style={s.text}>{t("Claim your Tera tag", "领取您的 Tera 标签")}</Text>
              <Text style={s.small}>
                {t(
                  "A tag lets people send to a name instead of your address. It is public, and it points at this wallet on Robinhood Chain.",
                  "标签让他人可以向名称而非地址转账。它是公开的，并在 Robinhood Chain 上指向此钱包。",
                )}
              </Text>
              <Button primary onPress={() => setPage("tag")}>
                {t("Claim a tag", "领取标签")}
              </Button>
              <Button onPress={() => setClaimDismissed(true)}>{t("Not now", "暂不")}</Button>
            </View>
          )}
          {tagsAvailable() && myTag && (
            <Pressable accessibilityRole="button" onPress={() => setPage("tag")}>
              <Text style={s.eyebrow}>{tags.display(myTag)}</Text>
            </Pressable>
          )}
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
                  if (p === "send") setSendMode("public");
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
    if (page === "update") {
      const kind = upd.javascriptUpdatesEnabled() ? upd.JAVASCRIPT : upd.NATIVE;
      const expectation = upd.EXPECTATIONS[kind];
      return (
        <>
          {title(
            update?.state === upd.REQUIRED ? "Update required." : "Update available.",
            update?.state === upd.REQUIRED ? "需要更新。" : "有可用更新。",
            update ? `${update.manifest.versionName} · ${update.reason}` : "",
          )}
          <View style={s.panel}>
            <Row label={t("Installed", "已安装")} value={String(upd.installedVersionCode() ?? "—")} />
            <Row
              label={t("Published", "已发布")}
              value={String(update?.manifest.versionCode ?? "—")}
            />
            {update?.manifest.sizeBytes ? (
              <Row
                label={t("Download", "下载大小")}
                value={`${Math.round(update.manifest.sizeBytes / 1e6)} MB`}
              />
            ) : null}
          </View>
          {/*
            What will happen, in the app's own words, before the owner starts.
            The native path cannot avoid Android's install screen and does not
            pretend it can.
          */}
          <Text style={s.text}>{expectation.title}</Text>
          <Text style={s.small}>{expectation.detail}</Text>
          <Text style={s.small}>{expectation.limit}</Text>
          {kind === upd.NATIVE && (
            <Text style={s.small}>
              {t(
                "The file is checked against the hash published by the build that produced it. If it does not match, it is deleted and not installed.",
                "文件将与构建时发布的哈希值比对。若不匹配，将被删除且不会安装。",
              )}
            </Text>
          )}
          {updateStage === "downloading" && (
            <Text style={s.small}>
              {t(
                `Downloading… ${Math.round(updateProgress * 100)}%`,
                `正在下载… ${Math.round(updateProgress * 100)}%`,
              )}
            </Text>
          )}
          {updateStage === "installing" && (
            <Text style={s.small}>
              {t(
                "Verified. Android will now ask you to confirm the install.",
                "校验通过。Android 现在会请您确认安装。",
              )}
            </Text>
          )}
          {update ? action("Update", "更新", runUpdate) : null}
          <Button onPress={() => setPage("home")}>{t("Back", "返回")}</Button>
        </>
      );
    }
    if (page === "tag") {
      return (
        <>
          {title(
            "Your tag.",
            "您的标签。",
            myTag ? tags.display(myTag) : t("Not claimed yet", "尚未领取"),
          )}
          <Field
            label={t("Tag", "标签")}
            value={claimInput}
            onChangeText={setClaimInput}
            placeholder="@astra"
          />
          <Text style={s.small}>
            {t(
              "Three to twenty characters: letters, numbers and underscores, starting with a letter. Names that read alike are treated as the same name, so @astr0 cannot be claimed while @astro exists.",
              "3 至 20 个字符：字母、数字和下划线，须以字母开头。外观相近的名称视为同一名称，因此 @astro 存在时无法领取 @astr0。",
            )}
          </Text>
          <Text style={s.small}>
            {t(
              "A tag is public while you hold it: anyone can see which address it points at. It names this wallet on Robinhood Chain only — it is not an address on any other chain, and it cannot be used as a bridge destination.",
              "标签在您持有期间是公开的，任何人都可查看其指向的地址。它仅在 Robinhood Chain 上标识此钱包，并非其他链上的地址，也不能用作跨链目标地址。",
            )}
          </Text>
          <Text style={s.small}>
            {t(
              "Tera keeps the tag register. Resolving a name means trusting Tera to answer honestly — unlike a balance or a receipt, there is nothing else to check it against. Always read the address on the review screen before you approve.",
              "Tera 维护标签注册表。解析名称意味着信任 Tera 如实作答——与余额或收据不同，没有其他依据可供核对。批准前请务必核对审核页面上的地址。",
            )}
          </Text>
          {myTag && (
            <Text style={s.small}>
              {t(
                `Claiming a new tag releases ${tags.display(myTag)} in the same transaction.`,
                `领取新标签将在同一笔交易中释放 ${tags.display(myTag)}。`,
              )}
            </Text>
          )}
          {action("Claim this tag", "领取此标签", claimTagNow)}
          <Button onPress={() => setPage("home")}>{t("Back", "返回")}</Button>
        </>
      );
    }
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
    if (page === "private") {
      return (
        <>
          {title("Private route.", "私密路由。")}
          <View style={s.wrap}>
            {(["ETH", "TERA"] as const).map((a) => (
              <Pressable
                key={a}
                accessibilityRole="button"
                onPress={() => {
                  setPrivateAsset(a);
                  setAssetSymbol(a);
                }}
                style={[
                  s.panel,
                  { width: "48%", flexDirection: "row", alignItems: "center", gap: 10 },
                  privateAsset === a && { borderWidth: 2, borderColor: colors.green },
                ]}
              >
                <TokenIcon symbol={a} size={28} />
                <Text style={[s.text, { fontWeight: "700" }]}>{a}</Text>
              </Pressable>
            ))}
          </View>
          <Field
            label={t("Amount", "金额")}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
          />
          <Field
            label={t("Recipient address", "收款地址")}
            value={recipient}
            onChangeText={setRecipient}
          />
          <Text style={s.small}>
            {t(
              "Tera routes the confirmed deposit through separate intake and payout wallets. This reduces the direct link but is not anonymous.",
              "Tera 通过独立的钱包路由已确认的存款。这会减少直接关联，但并不匿名。",
            )}
          </Text>
          {action("Review private route", "审核私密路由", preparePrivateSend)}
        </>
      );
    }
    if (page === "send") {
      const isPrivate = sendMode === "private";
      const sendAssets = assets;
      const stepTitle = [
        t("Select route", "选择路由"),
        t("Choose asset", "选择资产"),
        t("Enter amount", "输入金额"),
        t("Recipient", "收款方"),
        t("Review send", "审核发送"),
      ][flowStep];
      return (
        <>
          {title("Send.", "发送。", `${flowStep + 1}/5 · ${stepTitle}`)}
          {flowStep === 0 && (
            <View style={{ gap: 14 }}>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setSendMode("public");
                }}
                style={[
                  s.panel,
                  {
                    paddingVertical: 26,
                    paddingHorizontal: 20,
                    borderRadius: 22,
                    borderWidth: sendMode === "public" ? 2 : 1,
                    borderColor: sendMode === "public" ? colors.green : colors.line,
                    backgroundColor: sendMode === "public" ? "#eef6eb" : colors.paper,
                    overflow: "hidden",
                    position: "relative",
                    justifyContent: "center",
                  },
                ]}
              >
                <MaterialCommunityIcons
                  name="earth"
                  size={96}
                  color={sendMode === "public" ? colors.green : colors.ink}
                  style={{
                    position: "absolute",
                    right: -16,
                    bottom: -22,
                    opacity: sendMode === "public" ? 0.12 : 0.05,
                  }}
                />
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <Text style={{ fontSize: 20, fontWeight: "800", color: colors.ink }}>
                    {t("Public Send", "公开发送")}
                  </Text>
                  {sendMode === "public" && (
                    <MaterialCommunityIcons name="check-circle" size={22} color={colors.green} />
                  )}
                </View>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setSendMode("private");
                  if (assetSymbol !== "ETH" && assetSymbol !== "TERA") {
                    setAssetSymbol("ETH");
                    setPrivateAsset("ETH");
                  }
                }}
                style={[
                  s.panel,
                  {
                    paddingVertical: 26,
                    paddingHorizontal: 20,
                    borderRadius: 22,
                    borderWidth: sendMode === "private" ? 2 : 1,
                    borderColor: sendMode === "private" ? colors.green : colors.line,
                    backgroundColor: sendMode === "private" ? "#eef6eb" : colors.paper,
                    overflow: "hidden",
                    position: "relative",
                    justifyContent: "center",
                  },
                ]}
              >
                <MaterialCommunityIcons
                  name="shield"
                  size={96}
                  color={sendMode === "private" ? colors.green : colors.ink}
                  style={{
                    position: "absolute",
                    right: -16,
                    bottom: -22,
                    opacity: sendMode === "private" ? 0.12 : 0.05,
                  }}
                />
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <Text style={{ fontSize: 20, fontWeight: "800", color: colors.ink }}>
                    {t("Private Send", "私密发送")}
                  </Text>
                  {sendMode === "private" && (
                    <MaterialCommunityIcons name="check-circle" size={22} color={colors.green} />
                  )}
                </View>
              </Pressable>
            </View>
          )}
          {flowStep === 1 && (
            <View style={s.wrap}>
              {sendAssets.map((asset) => (
                <Pressable
                  key={asset.symbol}
                  accessibilityRole="button"
                  onPress={() => {
                    setAssetSymbol(asset.symbol);
                  }}
                  style={[
                    s.panel,
                    { width: "48%", flexDirection: "row", alignItems: "center", gap: 10 },
                    assetSymbol === asset.symbol && { borderWidth: 2, borderColor: colors.green },
                  ]}
                >
                  <TokenIcon symbol={asset.symbol} size={28} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.text, { fontWeight: "700" }]}>{asset.symbol}</Text>
                    <Text style={s.small} numberOfLines={1}>
                      {balance?.[asset.symbol]
                        ? `${formatUnits(BigInt(balance[asset.symbol]), asset.decimals)}`
                        : "0.0"}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}
          {flowStep === 2 && (
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
                  : `${t("Available:", "可用:")} ${
                      balance?.[selectedAsset.symbol]
                        ? formatUnits(BigInt(balance[selectedAsset.symbol]), selectedAsset.decimals)
                        : "0"
                    } ${selectedAsset.symbol}`}
              </Text>
            </View>
          )}
          {flowStep === 3 && (
            <View style={{ gap: 12 }}>
              {tagsAvailable() && (
                <>
                  <Text style={s.eyebrow}>{t("SEND TO", "发送至")}</Text>
                  <Choices
                    options={[t("Tera tag", "Tera 标签"), t("Wallet address", "钱包地址")]}
                    value={
                      recipientKind === "tag"
                        ? t("Tera tag", "Tera 标签")
                        : t("Wallet address", "钱包地址")
                    }
                    select={(choice) => {
                      setRecipientKind(choice === t("Tera tag", "Tera 标签") ? "tag" : "address");
                      setRecipient("");
                      setTagLookup({ state: "idle" });
                    }}
                  />
                </>
              )}
              <Field
                label={
                  recipientKind === "tag"
                    ? t("Tera tag", "Tera 标签")
                    : t("Receiving wallet address", "收款钱包地址")
                }
                value={recipient}
                placeholder={recipientKind === "tag" ? "@astra" : "0x…"}
                onChangeText={(value) => {
                  setRecipient(value);
                  // Any edit invalidates what the registry said a moment ago.
                  // The lookup runs again when the owner continues, and the
                  // stale address must not survive until then.
                  if (tagLookup.state !== "idle") setTagLookup({ state: "idle" });
                }}
              />
              {recipientKind === "tag" ? (
                <Text style={[s.small, tagLookup.state === "error" && { color: colors.danger }]}>
                  {tagLookup.state === "looking"
                    ? t("Looking up the tag…", "正在查询标签…")
                    : tagLookup.state === "found"
                      ? `${tags.display(tagLookup.tag)} · ${tagLookup.address}`
                      : tagLookup.state === "error"
                        ? tagLookup.message
                        : t(
                            "A tag is looked up in Tera's register. You will see the address it resolves to before you sign — read it.",
                            "标签将在 Tera 注册表中查询。签名前会显示其对应地址，请仔细核对。",
                          )}
                </Text>
              ) : (
                <Text style={s.small}>
                  {isPrivate
                    ? t(
                        "Enter the final destination address. Tera will route the payout here.",
                        "请输入最终收款地址。Tera 将代币路由至此处。",
                      )
                    : t(
                        "Enter the destination Robinhood Chain address.",
                        "请输入 Robinhood Chain 收款地址。",
                      )}
                </Text>
              )}
            </View>
          )}
          {flowStep === 4 && (
            <View style={s.panel}>
              <Row
                label={t("Route", "路由方式")}
                value={
                  isPrivate
                    ? t("Private Route", "私密路由")
                    : t("Public (Direct)", "公开（直接）")
                }
              />
              <Row label={t("Asset", "资产")} value={selectedAsset.symbol} />
              <Row
                label={t("Amount", "金额")}
                value={`${amount || "0"} ${selectedAsset.symbol}`}
              />
              {tagLookup.state === "found" && (
                <Row label={t("Tag", "标签")} value={tags.display(tagLookup.tag)} />
              )}
              <Row
                label={t("To", "收款方")}
                value={(tagLookup.state === "found" ? tagLookup.address : recipient) || "—"}
              />
              {isPrivate && (
                <>
                  <Row
                    label={t("Routing", "路由路径")}
                    value={t("Intake → Payout → Recipient", "接收 → 支付 → 收款方")}
                  />
                  <Text style={[s.small, { marginTop: 10, lineHeight: 18 }]}>
                    {t(
                      "Tera routes the confirmed deposit through separate intake and payout wallets. This reduces the direct link but is not anonymous.",
                      "Tera 通过独立的钱包路由已确认的存款。这会减少直接关联，但并不匿名。",
                    )}
                  </Text>
                </>
              )}
            </View>
          )}
          {flowStep < 4 ? (
            <Button primary onPress={continueSend}>
              {t("Continue", "继续")}
            </Button>
          ) : isPrivate ? (
            action("Review private route", "审核私密路由", preparePrivateSend)
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
              <Text style={s.eyebrow}>{t("ROUTING", "路由模式")}</Text>
              <Choices
                options={[t("Direct route", "直接路由"), t("Private route", "私密路由")]}
                value={bridgeMode === "private" ? t("Private route", "私密路由") : t("Direct route", "直接路由")}
                select={(name) =>
                  setBridgeMode(name === t("Private route", "私密路由") ? "private" : "public")
                }
              />
              {bridgeMode === "private" && (
                <Text style={[s.small, { marginTop: 4 }]}>
                  {t(
                    "Private routing severs the direct link between your Robinhood Chain address and the destination recipient. Funds route through Tera's bridge vault.",
                    "私密路由切断你 Robinhood Chain 地址与目标链收款方之间的直接关联。资金将通过 Tera 跨链金库路由。",
                  )}
                </Text>
              )}
            </>
          )}
          {action(
            page === "bridge" && bridgeMode === "private" ? "Review private bridge" : "Review live route",
            page === "bridge" && bridgeMode === "private" ? "审核私密跨链" : "审核实时路线",
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
          {data.history.map((r) => {
            const isBridge = Boolean(
              r.bridgeInput ||
                (r.reference && /^0x[\da-f]{64}$/i.test(r.reference)) ||
                r.isPrivateBridge,
            );
            return (
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
                    {r.isPrivateBridge
                      ? `Private Bridge: ${r.reference}`
                      : isBridge
                      ? `Relay: ${r.reference}`
                      : `Route: ${r.reference}`}
                  </Text>
                )}
                {action(
                  "Check status",
                  "检查状态",
                  async (g) => {
                    const sourceStatus = await transactionStatus(r.hash);
                    g();
                    let delivery = r.delivery;
                    let payoutHash = r.payoutHash;
                    if (r.reference && sourceStatus === "confirmed") {
                      if (r.isPrivateBridge) {
                        const result = await api(`/api/bridge/private/jobs/${r.reference}`);
                        g();
                        delivery =
                          result.job?.status === "confirmed"
                            ? "delivered"
                            : result.job?.status === "refunded"
                            ? "refunded"
                            : (result.job?.status ?? "pending");
                        if (result.job?.relay_deposit_tx_hash) {
                          payoutHash = result.job.relay_deposit_tx_hash;
                        }
                      } else if (isBridge) {
                        const result = await api(`/api/bridge/status/${r.reference}`);
                        g();
                        delivery = result.status?.status ?? result.status;
                      } else {
                        const result = await api(`/api/private-send/jobs/${r.reference}`);
                        g();
                        delivery =
                          result.job?.status === "confirmed"
                            ? "delivered"
                            : (result.job?.status ?? "pending");
                        if (result.job?.payout_tx_hash) {
                          payoutHash = result.job.payout_tx_hash;
                        }
                      }
                    }
                    await store({
                      ...dataRef.current,
                      history: dataRef.current.history.map((h) =>
                        h.hash === r.hash
                          ? { ...h, status: sourceStatus, delivery, payoutHash }
                          : h,
                      ),
                    });
                    if (r.actionHash && sourceStatus === "confirmed") {
                      await api("/api/intent/receipt", {
                        actionHash: r.actionHash,
                        txHash: r.hash,
                        recipient: r.recipient,
                      });
                    }
                    setNotice({
                      title: t("Status updated", "状态已更新"),
                      body: t(
                        `Source: ${sourceStatus}${delivery ? ` · Delivery: ${delivery}` : ""}`,
                        `源交易: ${sourceStatus}${delivery ? ` · 到账: ${delivery}` : ""}`,
                      ),
                      tone: "success",
                    });
                  },
                  false,
                )}
                {r.delivery && (
                  <Row
                    label={isBridge ? t("Relay delivery", "Relay 到账") : t("Route delivery", "路由到账")}
                    value={r.delivery}
                  />
                )}
                {r.payoutHash && (
                  <Button
                    onPress={() =>
                      void Linking.openURL(`https://robinhoodchain.blockscout.com/tx/${r.payoutHash}`)
                    }
                  >
                    {t("View payout tx", "查看出资交易")}
                  </Button>
                )}
                <Button
                  onPress={() =>
                    void Linking.openURL(`https://robinhoodchain.blockscout.com/tx/${r.hash}`)
                  }
                >
                  {t("View on explorer", "在浏览器查看")}
                </Button>
              </View>
            );
          })}
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
