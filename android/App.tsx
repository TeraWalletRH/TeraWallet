import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  AppState,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as Clipboard from "expo-clipboard";
import { formatUnits, parseUnits, zeroAddress, type Address } from "viem";
import { api } from "./src/api";
import { Asset, chain, destinations, sources, Tx, USDG } from "./src/config";
import { balances, execute, transactionStatus } from "./src/network";
import { policyFor } from "./src/policy";
import { verifyProposal } from "./src/proposals";
import { check, positive, transferTx, verifyBridge, verifyTransfer } from "./src/validation";
import * as vault from "./src/storage";
import { normalizePhrase, walletFromPhrase } from "./src/crypto";
import { Button, Choices, colors, Field, Row, styles as s } from "./src/ui";

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
};
function Wallet() {
  const [language, setLanguage] = useState<"en" | "zh">("en");
  const t = (en: string, zh: string) => (language === "zh" ? zh : en);
  const [ready, setReady] = useState(false),
    [exists, setExists] = useState(false),
    [owner, setOwner] = useState<Address | "">("");
  const [page, setPage] = useState("home"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [progress, setProgress] = useState("");
  const [data, setData] = useState(vault.emptyData());
  const dataRef = useRef(data);
  const [balance, setBalance] = useState<{ USDG: string; ETH: string } | null>(null);
  const [assets, setAssets] = useState<Asset[]>(sources),
    [message, setMessage] = useState(""),
    [chat, setChat] = useState<{ role: string; text: string }[]>([]);
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
    [auth, setAuth] = useState<null | { title: string; action: () => Promise<void> }>(null),
    [authPassword, setAuthPassword] = useState("");
  const pending = useRef(false);
  const inactivity = useRef(Date.now());
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
    setSetup("start");
    void vault.hasWallet().then(setExists);
  }
  useEffect(() => {
    vault
      .hasWallet()
      .then(setExists)
      .catch(() => setError(t("Device storage unavailable.", "设备存储不可用。")))
      .finally(() => setReady(true));
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active" && !vault.authenticating) forget();
    });
    const timer = setInterval(() => {
      if (vault.isUnlocked() && !pending.current && Date.now() - inactivity.current > 120000)
        forget();
    }, 10000);
    return () => {
      subscription.remove();
      clearInterval(timer);
      vault.lock();
    };
  }, []);
  async function run(work: (guard: () => void) => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    const version = vault.sessionVersion();
    const guard = () => {
      if (AppState.currentState !== "active" || version !== vault.sessionVersion())
        throw new Error("Session locked. / 会话已锁定。");
    };
    try {
      await work(guard);
    } catch (e) {
      if (version === vault.sessionVersion())
        setError(e instanceof Error ? e.message : t("Action failed.", "操作失败。"));
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
    const saved = await vault.loadData();
    guard();
    setOwner(address);
    setExists(true);
    setData(saved);
    dataRef.current = saved;
    setLanguage(saved.language);
    setPassword("");
    setMnemonic("");
    setRepeat("");
    setSetup("start");
    void refresh(address);
  }
  async function refresh(address = owner) {
    if (!address) return;
    const version = vault.sessionVersion();
    const result = await Promise.allSettled([balances(address), api("/api/assets")]);
    if (version !== vault.sessionVersion()) return;
    if (result[0].status === "fulfilled") setBalance(result[0].value);
    else
      setError(
        t("Could not refresh balances. Pull again when connected.", "无法刷新余额，请联网后重试。"),
      );
    if (result[1].status === "fulfilled") {
      const registry: Asset[] = result[1].value.assets || [];
      setAssets([
        ...sources,
        ...registry.filter((a) => !sources.some((s) => s.symbol === a.symbol)),
      ]);
    }
  }
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
    rows.push([
      t("Checks", "检查"),
      t(
        "Five service checks passed; transaction verified locally.",
        "五项服务检查已通过，交易已在本地验证。",
      ),
    ]);
    setReview({
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
    setReview({
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
  async function signReview(r: Review) {
    // Consume the review before broadcasting so a timeout cannot lead to a
    // second tap resending a bridge or transfer.
    r.verify();
    setReview(null);
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
  }
  async function ask(guard: () => void) {
    if (!message.trim()) return;
    const text = message.trim();
    setMessage("");
    setChat((c) => [...c, { role: "you", text }]);
    const result = await api(
      propose ? "/api/agent/propose" : "/api/agent/chat",
      propose
        ? {
            prompt: text,
            ownerAddress: owner,
            ...(dataRef.current.token ? { sessionToken: dataRef.current.token } : {}),
          }
        : { message: text },
    );
    guard();
    setChat((c) => [
      ...c,
      {
        role: "tera",
        text: result.reply || result.explanation || t("Proposal prepared.", "提案已准备好。"),
      },
    ]);
    if (propose && result.intent) {
      // Structured intent is reviewed locally before final preparation. Free
      // text necessarily reaches the assistant service first.
      const checked = await policyFor(result.intent);
      guard();
      const prepared = await api("/api/intent/prepare", checked);
      guard();
      const p = { ...prepared, intent: checked, createdAt: Date.now() };
      await store({ ...dataRef.current, drafts: [...dataRef.current.drafts, p] });
    }
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
      {t(en, zh)}
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
            label={t("Wallet password", "钱包密码")}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            textContentType="password"
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
            {t("Create wallet ↗", "创建钱包 ↗")}
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
            "Choose a password of at least 10 characters. Use your recovery phrase if you forget it.",
            "设置至少10个字符的密码，忘记密码时可使用助记词恢复。",
          ),
        )}
        <Field
          label={t("Password", "密码")}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        <Field
          label={t("Repeat password", "重复密码")}
          value={repeat}
          onChangeText={setRepeat}
          secureTextEntry
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
          {title("Your wallet.", "你的钱包。", "Robinhood Chain")}
          <View style={{ paddingVertical: 16 }}>
            <Text style={s.eyebrow}>{t("USDG BALANCE", "USDG 余额")}</Text>
            <Text style={[s.title, { fontSize: 54, lineHeight: 64 }]}>
              {balance ? formatUnits(BigInt(balance.USDG), 6) : "—"}
            </Text>
            <Text style={s.small}>USDG · {t("Global Dollar", "全球美元")}</Text>
          </View>
          <Row
            label={t("Gas balance", "手续费余额")}
            value={balance ? `${formatUnits(BigInt(balance.ETH), 18)} ETH` : "—"}
          />
          <View style={s.quickActions}>
            {[
              ["Send", "发送", "send"],
              ["Receive", "收款", "receive"],
              ["Swap", "兑换", "swap"],
              ["Bridge", "跨链", "bridge"],
            ].map(([en, zh, p]) => (
              <Pressable
                key={p}
                accessibilityRole="button"
                style={({ pressed }) => [s.quickAction, { opacity: pressed ? 0.65 : 1 }]}
                onPress={() => {
                  setAssetSymbol(p === "swap" ? "AAPL" : "USDG");
                  setAmount("");
                  setRecipient("");
                  setPage(p);
                }}
              >
                <Text style={s.buttonText}>{t(en, zh)}</Text>
              </Pressable>
            ))}
          </View>
          <View style={s.panel}>
            <Text style={s.eyebrow}>{t("OWNER SUPERVISED", "由所有者监督")}</Text>
            <Text style={s.text}>
              {t(
                "The assistant proposes. You review. Your phone signs.",
                "助手提出建议，你负责审核，由手机签名。",
              )}
            </Text>
          </View>
          {action("Refresh balances", "刷新余额", async () => refresh(), false)}
          <Text selectable style={s.mono}>
            {owner}
          </Text>
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
          {action("Copy address", "复制地址", async () => {
            await Clipboard.setStringAsync(owner);
            setProgress(t("Copied", "已复制"));
          })}
        </>
      );
    if (page === "send" || page === "swap" || page === "bridge")
      return (
        <>
          {title(
            page === "send" ? "Send." : page === "swap" ? "Swap." : "Across chains.",
            page === "send" ? "发送。" : page === "swap" ? "兑换。" : "跨链。",
            page === "bridge"
              ? t(
                  "Relay receives the addresses and amount needed to quote and deliver.",
                  "Relay 接收报价和到账所需的地址与金额。",
                )
              : t("Review the exact action before signing.", "签名前审核具体操作。"),
          )}
          {page === "swap" && <Choices options={["BUY", "SELL"]} value={trade} select={setTrade} />}
          <Text style={s.eyebrow}>{t("Asset", "资产")}</Text>
          <Choices
            options={(page === "bridge"
              ? sources
              : page === "swap"
                ? assets.filter((a) => !["ETH", "USDG"].includes(a.symbol))
                : assets
            ).map((a) => a.symbol)}
            value={assetSymbol}
            select={setAssetSymbol}
          />
          {page === "bridge" && (
            <>
              <Text style={s.eyebrow}>{t("Destination", "目标网络")}</Text>
              <Choices
                options={destinations.map((d) => d.name)}
                value={dest.name}
                select={(name) => {
                  const d = destinations.find((d) => d.name === name)!;
                  setDestination(d.id);
                  setOutSymbol(d.tokens[0].symbol);
                }}
              />
              <Choices
                options={dest.tokens.map((a) => a.symbol)}
                value={output.symbol}
                select={setOutSymbol}
              />
            </>
          )}
          <Field
            label={t(
              page === "swap" && trade === "BUY" ? "USDG to spend" : "Amount to send",
              page === "swap" && trade === "BUY" ? "支付的 USDG" : "发送金额",
            )}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
          />
          {page !== "swap" && (
            <Field
              label={t("Receiving wallet address", "收款钱包地址")}
              value={recipient}
              onChangeText={setRecipient}
            />
          )}
          {action(
            "Review quote / action ↗",
            "审核报价 / 操作 ↗",
            page === "bridge" ? prepareBridge : page === "swap" ? prepareTrade : prepareTransfer,
          )}
          <Text style={s.small}>
            {t(
              "Network fees are paid in ETH. Leave enough ETH for fees.",
              "网络手续费使用 ETH 支付，请保留足够的 ETH。",
            )}
          </Text>
        </>
      );
    if (page === "assistant")
      return (
        <>
          {title(
            "Ask. Then decide.",
            "先询问，再决定。",
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
          {data.token && (
            <Text style={s.eyebrow}>{t("Scoped session connected", "已连接限定权限的会话")}</Text>
          )}
          {chat.map((m, i) => (
            <View key={i} style={[s.panel, m.role === "you" && { backgroundColor: colors.ink }]}>
              <Text style={s.eyebrow}>{m.role === "you" ? t("YOU", "你") : "TERA"}</Text>
              <Text selectable style={[s.text, m.role === "you" && { color: colors.paper }]}>
                {m.text.replace(/\*\*(.*?)\*\*/g, "$1").replace(/^#{1,6}\s/gm, "")}
              </Text>
            </View>
          ))}
          <Field
            label={t("Message", "消息")}
            value={message}
            onChangeText={setMessage}
            maxLength={1200}
            multiline
          />
          {action("Send message ↑", "发送消息 ↑", ask)}
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
                {t("Review", "审核")} ↗
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
                {t("View on explorer ↗", "在浏览器查看 ↗")}
              </Button>
            </View>
          ))}
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
        <Pressable onPress={() => (owner ? setPage("home") : setSetup("start"))}>
          <Text style={[s.eyebrow, { color: colors.ink }]}>TERA WALLET</Text>
        </Pressable>
        {languageControl}
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          {error && (
            <View style={s.error}>
              <Text style={s.small}>{error}</Text>
            </View>
          )}
          {busy && (
            <Text accessibilityLiveRegion="polite" style={s.small}>
              {progress || t("Working…", "正在处理…")}
            </Text>
          )}
          {owner ? main() : onboarding()}
        </ScrollView>
      </KeyboardAvoidingView>
      {owner && (
        <View style={s.tabs}>
          {[
            ["01", "Wallet", "钱包", "home"],
            ["02", "Assistant", "助手", "assistant"],
            ["03", "Activity", "记录", "activity"],
            ["04", "Settings", "设置", "settings"],
          ].map(([n, en, zh, p]) => (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: page === p }}
              style={s.tab}
              key={p}
              disabled={busy}
              onPress={() => {
                setError("");
                setPage(p);
              }}
            >
              <Text style={[s.eyebrow, page === p && { color: colors.ink }]}>{n}</Text>
              <Text style={[s.small, page === p && { color: colors.ink, fontWeight: "700" }]}>
                {t(en, zh)}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      <Modal
        visible={!!review && !!owner}
        animationType="slide"
        onRequestClose={() => !busy && setReview(null)}
      >
        <SafeAreaView style={s.page}>
          <ScrollView contentContainerStyle={s.content}>
            {title(review?.title || "", review?.title || "")}
            {review?.rows.map(([label, value], i) => (
              <Row key={i} label={label} value={value} />
            ))}
            <Text style={s.small}>
              {t(
                "Network fees are additional, capped at 0.001 ETH per transaction step. This authorizes only the reviewed steps.",
                "网络手续费另计，每个交易步骤上限为 0.001 ETH，此操作仅授权已审核的步骤。",
              )}
            </Text>
            <Button
              primary
              disabled={busy}
              onPress={() => {
                const r = review!;
                authenticate(t("Authorize transaction", "授权交易"), () => signReview(r));
              }}
            >
              {t("Authorize on this device ↗", "在此设备上授权 ↗")}
            </Button>
            <Button disabled={busy} onPress={() => setReview(null)}>
              {t("Cancel", "取消")}
            </Button>
            {error && <Text style={s.small}>{error}</Text>}
          </ScrollView>
        </SafeAreaView>
      </Modal>
      <Modal
        visible={!!auth && !!owner}
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
              label={t("Wallet password", "钱包密码")}
              value={authPassword}
              onChangeText={setAuthPassword}
              secureTextEntry
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
            {error && <Text style={s.small}>{error}</Text>}
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
