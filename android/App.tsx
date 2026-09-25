import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  AppState,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Image,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import Svg, { Path, Defs, RadialGradient, Stop } from "react-native-svg";
import { BlurTargetView, BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import { erc20Abi, formatUnits, parseUnits, zeroAddress, isAddress, type Address } from "viem";
import { api } from "./src/api";
import { Asset, chain, destinations, sources, Tx, USDG } from "./src/config";
import * as tags from "./src/tags";
const tagsAvailable = () => tags.tagsAvailable();
import * as upd from "./src/update";
import { balances, client, execute, transactionStatus } from "./src/network";
import { fetchChainHistory, type ChainHistoryEntry } from "./src/explorer";
import { policyFor } from "./src/policy";
import { proposalVerdicts, verifyProposal } from "./src/proposals";
import { contacts as contactsCore, UNVERIFIABLE, value as valueCore } from "./src/core";
import { check, positive, transferTx, verifyBridge, verifyTransfer } from "./src/validation";
import * as vault from "./src/storage";
import { normalizePhrase, walletFromPhrase } from "./src/crypto";
import {
  Button,
  Choices,
  colors,
  Field,
  fontFiles,
  Group,
  Header,
  Icon,
  Keypad,
  ListRow,
  PinInput,
  Row,
  setColorTheme,
  TeraSpinner,
  setFontsReady,
  Steps,
  styles as s,
  Text,
  TextInput,
  Toggle,
} from "./src/ui";
import { useFonts } from "expo-font";
import { minimise, PROPOSAL_KEEP, rehydrate, residual, type MinimiseResult } from "./src/minimise";
import { Gallery, type Item as NftItem } from "./src/Gallery";
import { ActionSheet } from "./src/ActionSheet";
import { AppTour, type TourRect } from "./src/Tour";
import { nft } from "./src/core";

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
  /** The address the owner chose to pay. Read by the address book only. */
  payee?: string;
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
  USDC: require("./assets/usdc.png"),
  USDT: require("./assets/usdt.png"),
  SOL: require("./assets/solana.png"),
};

const logoMark = require("./assets/logo-mark.png");

/**
 * The very first screen's hero — deliberately bigger and more alive than
 * the circular Illustration treatment every later onboarding step uses:
 * this is the one moment that's closer to a splash/title screen than a
 * form step, so it gets the wordmark itself, large, on a soft multi-color
 * ring glow, slowly breathing — rather than reaching for a stock
 * illustration or photo, which would be off-brand however well it was
 * chosen. A real component, not inline JSX in onboarding(), for the same
 * hook-lifecycle reason as Illustration below.
 */
function WelcomeHero() {
  const pulse = React.useRef(new Animated.Value(0)).current;
  const spin = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 2000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 2000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    // A full turn takes half a minute — slow enough to read as "alive"
    // ambient motion, not as a spinner (TeraSpinner's turn is 1.1s).
    const spinLoop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 30000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    pulseLoop.start();
    spinLoop.start();
    return () => {
      pulseLoop.stop();
      spinLoop.stop();
    };
  }, [pulse, spin]);
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return (
    <View
      style={{
        height: 250,
        alignItems: "center",
        justifyContent: "center",
        marginTop: 28,
        marginBottom: 56,
      }}
    >
      {/* The rotation lives on the rings, not the mark: the mark isn't
          radially symmetric (it's a folded ribbon), so spinning it read as
          broken rather than alive. A gradient sweep on the outer ring makes
          the rotation actually visible — a flat-opacity circle looks
          identical at every angle. */}
      <Animated.View
        pointerEvents="none"
        style={{ position: "absolute", width: 320, height: 320, transform: [{ rotate }] }}
      >
        <LinearGradient
          colors={[colors.green, colors.lime, colors.copper, colors.green]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ width: "100%", height: "100%", borderRadius: 160, opacity: 0.14 }}
        />
      </Animated.View>
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          width: 240,
          height: 240,
          borderRadius: 120,
          backgroundColor: colors.lime,
          opacity: 0.14,
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          width: 172,
          height: 172,
          borderRadius: 86,
          backgroundColor: colors.copper,
          opacity: 0.16,
        }}
      />
      <Animated.Image
        source={logoMark}
        resizeMode="contain"
        style={{ width: 132, height: 132, transform: [{ scale }] }}
      />
    </View>
  );
}
/**
 * The same wordmark-on-a-badge treatment as WelcomeHero, scaled down for
 * every later onboarding step — one brand mark throughout instead of a
 * different stock illustration per step. A real component (not a helper
 * function called inline from Wallet()) specifically so its animation
 * hooks get their own mount/unmount lifecycle per step shown, rather than
 * attaching to Wallet()'s own hook order, which would break across
 * onboarding's conditional branches.
 */
function Illustration() {
  const bob = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(bob, {
          toValue: 0,
          duration: 1800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [bob]);
  return (
    <View style={{ alignItems: "center", marginTop: 12, marginBottom: 4 }}>
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          width: 104,
          height: 104,
          borderRadius: 52,
          backgroundColor: colors.lime,
          opacity: 0.14,
        }}
      />
      <View
        style={{
          width: 112,
          height: 112,
          borderRadius: 56,
          borderWidth: 1,
          borderColor: colors.tint,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View
          style={{
            width: 94,
            height: 94,
            borderRadius: 47,
            backgroundColor: colors.tint,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Animated.Image
            source={logoMark}
            resizeMode="contain"
            style={{
              width: 52,
              height: 52,
              transform: [
                { translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) },
              ],
            }}
          />
        </View>
      </View>
    </View>
  );
}
/**
 * A smooth closed blob through `points` around a circle, each point's
 * radius wobbling on a travelling sine wave — an actual wavelength moving
 * around the shape, which is the point. Quadratic beziers run through the
 * midpoint of each edge (not the points themselves), which is what keeps
 * every corner rounded instead of drawing a spiky star.
 */
function wobblePath(
  cx: number,
  cy: number,
  baseR: number,
  amp: number,
  freq: number,
  phase: number,
  points = 10,
) {
  const pts: [number, number][] = [];
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2;
    const r = baseR + amp * Math.sin(freq * angle + phase);
    pts.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
  }
  const mid = (a: [number, number], b: [number, number]): [number, number] => [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
  ];
  const start = mid(pts[points - 1], pts[0]);
  let d = `M ${start[0]} ${start[1]} `;
  for (let i = 0; i < points; i++) {
    const next = pts[(i + 1) % points];
    const m = mid(pts[i], next);
    d += `Q ${pts[i][0]} ${pts[i][1]} ${m[0]} ${m[1]} `;
  }
  return d + "Z";
}
/**
 * A listening state for the assistant's voice input. No real audio levels
 * exist yet to visualise (this is UI only; nothing is transcribed), so
 * instead of a literal waveform this fakes the same "alive" read with
 * layered, continuously-morphing blobs in the mark's own palette — closer
 * to Siri's orb than a static mic icon or a flat nested-circle target.
 * Native-driven Animated can't touch an SVG path's `d`, so the phase value
 * runs on the JS thread and a listener recomputes the path on every tick.
 */
function VoiceBlob({
  size,
  gradientId,
  colorA,
  colorB,
  duration,
  amp,
  freq,
}: {
  size: number;
  gradientId: string;
  colorA: string;
  colorB: string;
  duration: number;
  amp: number;
  freq: number;
}) {
  const phase = React.useRef(new Animated.Value(0)).current;
  const [d, setD] = React.useState(() =>
    wobblePath(size / 2, size / 2, size / 2 - amp, amp, freq, 0),
  );
  React.useEffect(() => {
    const id = phase.addListener(({ value }) => {
      setD(wobblePath(size / 2, size / 2, size / 2 - amp, amp, freq, value * Math.PI * 2));
    });
    const loop = Animated.loop(
      Animated.timing(phase, {
        toValue: 1,
        duration,
        easing: Easing.linear,
        useNativeDriver: false,
      }),
    );
    loop.start();
    return () => {
      loop.stop();
      phase.removeListener(id);
    };
  }, [phase, duration, size, amp, freq]);
  return (
    <Svg width={size} height={size} style={{ position: "absolute" }}>
      <Defs>
        <RadialGradient id={gradientId} cx="50%" cy="45%" r="65%">
          <Stop offset="0%" stopColor={colorA} stopOpacity={0.95} />
          <Stop offset="100%" stopColor={colorB} stopOpacity={0.55} />
        </RadialGradient>
      </Defs>
      <Path d={d} fill={`url(#${gradientId})`} />
    </Svg>
  );
}
function VoiceListening() {
  return (
    <View style={{ alignItems: "center", justifyContent: "center", width: 220, height: 220 }}>
      <VoiceBlob
        size={190}
        gradientId="voiceBlobA"
        colorA={colors.lime}
        colorB={colors.green}
        duration={5200}
        amp={16}
        freq={3}
      />
      <VoiceBlob
        size={148}
        gradientId="voiceBlobB"
        colorA={colors.copper}
        colorB={colors.lime}
        duration={4200}
        amp={14}
        freq={4}
      />
      <VoiceBlob
        size={100}
        gradientId="voiceBlobC"
        colorA="#ffe9c2"
        colorB={colors.copper}
        duration={3400}
        amp={10}
        freq={5}
      />
    </View>
  );
}

const chainImages: Record<string, any> = {
  Base: require("./assets/base.jpeg"),
  Arc: require("./assets/arc-logo.jpeg"),
  Solana: require("./assets/solana.png"),
  "Robinhood Chain": require("./assets/RH-RWA-Assets-Media/rh-icon.png"),
};

function ChainIcon({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <Image
      source={chainImages[name] || require("./assets/RH-RWA-Assets-Media/rh-icon.png")}
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.wash }}
    />
  );
}

/**
 * A shuffle order for the backup word bank, stable across re-renders without
 * a `useMemo` — `onboarding()` is a plain function called conditionally
 * inside Wallet(), not a component, so it can't hold hooks of its own.
 * Deterministic in the phrase (same phrase, same order every render) and
 * different between phrases, via a small seeded PRNG rather than `Math.random`.
 */
function shuffleOrder(seed: string, n: number): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const rand = () => {
    h = (h * 1103515245 + 12345) | 0;
    return ((h >>> 1) % 100000) / 100000;
  };
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** A balance for a list row: at most six decimals, no trailing zeros. The review screen shows the exact figure. */
function shortAmount(amount: string) {
  const [whole, fraction = ""] = amount.split(".");
  const kept = fraction.slice(0, 6).replace(/0+$/, "");
  return kept ? `${whole}.${kept}` : whole;
}

function TokenIcon({
  symbol,
  size = 32,
  chainBadge = false,
}: {
  symbol: string;
  size?: number;
  // A small Robinhood-mark subscript over the token icon's corner, the way
  // MetaMask badges a token with the network it's actually held on — every
  // asset here lives on Robinhood Chain, and "ETH" alone reads as mainnet
  // Ethereum without it.
  chainBadge?: boolean;
}) {
  const badgeSize = Math.round(size * 0.42);
  const ringSize = badgeSize + 4;
  return (
    <View style={{ width: size, height: size }}>
      <Image
        source={tokenImages[symbol] || require("./assets/RH-RWA-Assets-Media/rh-icon.png")}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.wash }}
      />
      {chainBadge && (
        <View
          style={{
            position: "absolute",
            right: -2,
            bottom: -2,
            width: ringSize,
            height: ringSize,
            borderRadius: ringSize / 2,
            backgroundColor: colors.wash,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Image
            source={require("./assets/RH-RWA-Assets-Media/rh-icon.png")}
            style={{ width: badgeSize, height: badgeSize, borderRadius: badgeSize / 2 }}
          />
        </View>
      )}
    </View>
  );
}
function Wallet() {
  const [language, setLanguage] = useState<"en" | "zh">("en");
  const t = (en: string, zh: string) => (language === "zh" ? zh : en);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setColorTheme(next);
    setTheme(next);
    if (owner) void store({ ...dataRef.current, theme: next }).catch(() => {});
  }
  const [ready, setReady] = useState(false),
    [exists, setExists] = useState(false),
    [pinWallet, setPinWallet] = useState(false),
    [owner, setOwner] = useState<Address | "">("");
  const [page, setPage] = useState("home"),
    [sheetOpen, setSheetOpen] = useState(false),
    [swapReceivePicker, setSwapReceivePicker] = useState(false),
    [voiceMode, setVoiceMode] = useState(false),
    [liveTranscript, setLiveTranscript] = useState(""),
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
      "root" | "security" | "privacy" | "sessions" | "device" | "accounts" | "contacts"
    >("root"),
    // Every account on this wallet, derived on unlock and after each change.
    // Addresses only live here while the wallet is open; locking clears them,
    // the same as the ledger that records who has read them.
    [accounts, setAccounts] = useState<
      Array<{ index: number; address: string; name: string; active: boolean }>
    >([]),
    [nameInput, setNameInput] = useState(""),
    // Which wallet's "…" action sheet / rename sheet is open, if any — an
    // index into `accounts`, not a boolean, since either sheet can target
    // any wallet in the list, not just the one currently open.
    [walletMenuFor, setWalletMenuFor] = useState<number | null>(null),
    [renamingIndex, setRenamingIndex] = useState<number | null>(null),
    // Shown inline in the rename sheet, never via the global `error` →
    // `notice` pipeline: that pipeline opens its own Modal, which would
    // stack on top of the rename sheet's still-open Modal and hang iOS,
    // the same way the "…" menu's own actions did before they were
    // deferred past its close.
    [renameError, setRenameError] = useState(""),
    [accountsInfo, setAccountsInfo] = useState(false),
    // Same "…" menu treatment as a wallet row, keyed by address instead of
    // index since that's a contact's stable identity.
    [contactMenuFor, setContactMenuFor] = useState<string | null>(null),
    [contactsInfo, setContactsInfo] = useState(false),
    [importAddress, setImportAddress] = useState(""),
    [importLookup, setImportLookup] = useState<Asset | null>(null),
    [importError, setImportError] = useState(""),
    // The tx hash of whichever Activity row is open on the detail screen.
    [activityDetail, setActivityDetail] = useState<string | null>(null),
    // Confirmed activity read back from the chain, to fill in what a
    // second device (or a reinstall) of this same wallet has no local
    // record of. null until the first fetch resolves.
    [chainHistory, setChainHistory] = useState<ChainHistoryEntry[] | null>(null),
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
  // The trail of steps taken to reach the current one, so a swipe or a back
  // control can retrace it — this is a plain wizard, not a navigation stack,
  // so there is nothing else recording how `setup` got here.
  const [setupHistory, setSetupHistory] = useState<(typeof setup)[]>([]);
  function goSetup(next: typeof setup) {
    setSetupHistory((h) => [...h, setup]);
    setSetup(next);
  }
  function setupBack() {
    setSetupHistory((h) => {
      if (!h.length) return h;
      setSetup(h[h.length - 1]);
      return h.slice(0, -1);
    });
  }
  // There's no navigation stack here (plain state, not react-navigation), so
  // nothing gives onboarding the native edge-swipe-to-go-back gesture for
  // free. This reproduces just that gesture: a narrow capture zone on the
  // left edge, refs so the PanResponder (created once) always sees the
  // latest history instead of the one from first render.
  const setupHistoryRef = useRef(setupHistory);
  setupHistoryRef.current = setupHistory;
  const setupBackRef = useRef(setupBack);
  setupBackRef.current = setupBack;
  const edgeSwipeBack = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (evt, gesture) => {
        if (!setupHistoryRef.current.length) return false;
        const startX = evt.nativeEvent.pageX - gesture.dx;
        return startX < 24 && gesture.dx > 10 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 2;
      },
      onPanResponderRelease: (_evt, gesture) => {
        if (gesture.dx > 70 && Math.abs(gesture.dy) < 60) setupBackRef.current();
      },
    }),
  ).current;
  const [mnemonic, setMnemonic] = useState(""),
    [password, setPassword] = useState(""),
    [repeat, setRepeat] = useState("");
  const [answers, setAnswers] = useState(["", "", ""]),
    [revealed, setRevealed] = useState("");
  // The backup check picks words rather than typing them: each slot holds the
  // index into `mnemonic`'s own words that was tapped for it (not the bank's
  // shuffled position), so a picked chip can be found and hidden regardless
  // of where it landed in the shuffle.
  const [pickedChips, setPickedChips] = useState<(number | null)[]>([null, null, null]),
    // -1: no slot's word list is open. A slot only opens on tap — nothing
    // is shown until the owner asks for it.
    [activeAnswerSlot, setActiveAnswerSlot] = useState(-1);
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
    [, setTagsOn] = useState(false),
    // What the published build is, if the check got an answer. Null means the
    // check has not run or could not be made — never "you are up to date",
    // which would be a claim this app did not verify.
    [update, setUpdate] = useState<upd.UpdateDecision | null>(null),
    [updateStage, setUpdateStage] = useState<"idle" | "downloading" | "verifying" | "installing">(
      "idle",
    ),
    [updateProgress, setUpdateProgress] = useState(0),
    [assetSymbol, setAssetSymbol] = useState("USDG"),
    [privateAsset, setPrivateAsset] = useState<"ETH" | "TERA">("ETH"),
    [sendMode, setSendMode] = useState<"public" | "private">("public"),
    [bridgeMode, setBridgeMode] = useState<"public" | "private">("public"),
    [bridgeStep, setBridgeStep] = useState(0);
  const [destination, setDestination] = useState(8453),
    [outSymbol, setOutSymbol] = useState("ETH"),
    [trade, setTrade] = useState("BUY");
  const [review, setReview] = useState<Review | null>(null),
    [signing, setSigning] = useState(false),
    [auth, setAuth] = useState<null | { title: string; action: () => Promise<void> }>(null),
    [authPassword, setAuthPassword] = useState(""),
    // Shown inline in their own modals rather than via the global `error` →
    // `notice` pipeline: that pipeline opens its own Modal, which would
    // stack on top of these still-open ones and hang iOS (same reasoning as
    // renameError near the wallet menu).
    [authError, setAuthError] = useState(""),
    [biometricSheet, setBiometricSheet] = useState(false),
    [biometricError, setBiometricError] = useState("");
  const pending = useRef(false);
  const glassTarget = useRef<View>(null);
  const chatScrollRef = useRef<ScrollView>(null);
  const reviewScrollRef = useRef<ScrollView>(null);
  // The PIN/biometric box appears inline inside the review sheet (not its
  // own Modal — stacking a second Modal on top of review's would risk the
  // same presentation collision fixed elsewhere this session), low enough
  // in a long review that it can land below the fold. Scroll it into view
  // instead of leaving the owner to find it.
  useEffect(() => {
    if (auth) reviewScrollRef.current?.scrollToEnd({ animated: true });
  }, [auth]);
  useEffect(() => {
    if (page !== "activity" || !owner) return;
    let live = true;
    void fetchChainHistory(owner, t)
      .then((entries) => live && setChainHistory(entries))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [page, owner]);
  // A wallet-menu action that itself opens a Modal can't run right away —
  // the menu is still a Modal mid-close at that point. It's queued here and
  // fired from the menu's onClosed, once its Modal has actually unmounted.
  const afterWalletMenuCloses = useRef<(() => void) | null>(null);
  const afterContactMenuCloses = useRef<(() => void) | null>(null);
  // A speech-recognition error closes the voice-mode Modal and would open
  // the global notice Modal in the very same tick — two native Modals
  // transitioning at once, the same class of hang fixed elsewhere this
  // session. Queued here and flushed once the voice Modal has actually
  // dismissed (onDismiss is iOS-only, so the effect below is the fallback
  // for Android, which doesn't share iOS's single-presentation restriction
  // as strictly but gets the same safe treatment anyway).
  const pendingVoiceNotice = useRef<null | { title: string; body: string; tone: "error" }>(null);
  // The spotlight app tour: `tourStep` is null while inactive, else an index
  // into `tourSteps` below. `tourRect` is that step's target measured in
  // screen coordinates — recomputed on every step change, not derived at
  // render time, since it depends on an async native measurement.
  const [tourStep, setTourStep] = useState<number | null>(null);
  const [tourRect, setTourRect] = useState<TourRect | null>(null);
  const tourPending = useRef(false);
  const homeScrollRef = useRef<ScrollView>(null);
  const homeScrollY = useRef(0);
  const tourTagBannerRef = useRef<View>(null);
  const tourSwitcherRef = useRef<View>(null);
  const tourBalanceRef = useRef<View>(null);
  const tourActionsRef = useRef<View>(null);
  const tourAssetsRef = useRef<View>(null);
  const tourTabBarRef = useRef<View>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", () => setKeyboardOpen(true));
    const hidden = Keyboard.addListener("keyboardDidHide", () => setKeyboardOpen(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  // On-device speech recognition for the assistant's mic button. Interim
  // results land here as they're heard, so the message field is already
  // filled with whatever was said by the time recognition ends — there's
  // no separate "transcribe, then fill" step.
  useSpeechRecognitionEvent("result", (event) => {
    const transcript = event.results[0]?.transcript;
    if (transcript !== undefined) {
      setLiveTranscript(transcript);
      setMessage(transcript);
    }
  });
  useSpeechRecognitionEvent("end", () => setVoiceMode(false));
  useSpeechRecognitionEvent("error", (event) => {
    setVoiceMode(false);
    // Silence and a deliberate stop aren't failures — nothing to tell the
    // owner beyond the message field simply staying as it was.
    if (
      event.error === "no-speech" ||
      event.error === "speech-timeout" ||
      event.error === "aborted"
    )
      return;
    if (event.error === "not-allowed") {
      pendingVoiceNotice.current = {
        title: t("Microphone access needed", "需要麦克风权限"),
        body: t(
          "Allow microphone and speech recognition access in system settings to use voice input.",
          "请在系统设置中允许麦克风和语音识别权限以使用语音输入。",
        ),
        tone: "error",
      };
      return;
    }
    pendingVoiceNotice.current = {
      title: t("Voice input failed", "语音输入失败"),
      body: t("Try again, or type your message instead.", "请重试，或改为手动输入。"),
      tone: "error",
    };
  });
  useEffect(() => {
    if (!voiceMode && pendingVoiceNotice.current) {
      setNotice(pendingVoiceNotice.current);
      pendingVoiceNotice.current = null;
    }
  }, [voiceMode]);
  async function startVoiceMode() {
    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permission.granted) {
      setNotice({
        title: t("Microphone access needed", "需要麦克风权限"),
        body: t(
          "Allow microphone and speech recognition access in system settings to use voice input.",
          "请在系统设置中允许麦克风和语音识别权限以使用语音输入。",
        ),
        tone: "error",
      });
      return;
    }
    setLiveTranscript("");
    ExpoSpeechRecognitionModule.start({
      lang: language === "zh" ? "zh-CN" : "en-US",
      interimResults: true,
      continuous: false,
    });
    setVoiceMode(true);
  }
  // The contact sheet: adding, renaming, or offered right after a send.
  const [contactSheet, setContactSheet] = useState<null | {
      address: string;
      fixed: boolean;
      afterSend?: boolean;
    }>(null),
    [contactName, setContactName] = useState(""),
    [contactAddress, setContactAddress] = useState(""),
    [contactError, setContactError] = useState(""),
    [contactQuery, setContactQuery] = useState("");
  // Saved names, cleaned on every read: the stored list is whatever the file held.
  const book = contactsCore.cleanBook(data.contacts);
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
    setError("");
    setPage("home");
    setFlowStep(0);
    setBridgeStep(0);
    setSettingsSection("root");
    setSetup("start");
    setSetupHistory([]);
    setAccounts([]);
    setNameInput("");
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
      // "inactive", not just "background", is a real AppState value on iOS —
      // it's the transient state while a system sheet (Face ID/Touch ID,
      // an alert, Control Center) has focus, not the app leaving the
      // foreground. A biometric prompt routinely leaves AppState reading
      // "inactive" for a moment after it resolves, so treating anything
      // short of "active" as backgrounded made a successful Face ID/Touch
      // ID unlock fail right after with "Session locked".
      if (AppState.currentState === "background" || version !== vault.sessionVersion())
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
  /**
   * A wallet's display name, and the fallback when it has none.
   *
   * Numbered from 1 because the derivation index is an implementation detail —
   * "Wallet 1" is what an owner sees for index 0, which is the wallet they have
   * had all along.
   */
  const defaultName = (index: number) => t(`Wallet ${index + 1}`, `钱包 ${index + 1}`);
  const walletName = (entry: { index: number; name: string }) =>
    entry.name || defaultName(entry.index);
  /** `0x1234…cdef`. Enough to tell two wallets apart at a glance. */
  const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

  /** Re-derive the wallet list from the keystore. */
  function syncAccounts() {
    try {
      const list = vault.listAccounts();
      setAccounts(list);
      const active = list.find((entry) => entry.active);
      setNameInput(active?.name || "");
      return list;
    } catch {
      // Locked. The list belongs to an open wallet and nothing else needs it.
      setAccounts([]);
      setNameInput("");
      return [];
    }
  }

  /**
   * Point the app at a wallet that is already open in the keystore.
   *
   * Balances, drafts and the tag are dropped before the new address is set
   * rather than after. They belong to the wallet being left, and leaving them on
   * screen for the moment it takes to load would be showing one wallet's
   * holdings under another wallet's name.
   */
  async function adopt(address: Address) {
    setBalance(null);
    setChat([]);
    setMyTag(null);
    setError("");
    setOwner(address);
    syncAccounts();
    const version = vault.sessionVersion();
    const saved = await vault.loadData().catch(() => null);
    if (saved && version === vault.sessionVersion()) {
      setData(saved);
      dataRef.current = saved;
      setLanguage(saved.language);
      // Dark mode only for now, regardless of what a wallet set up before
      // this had stored — see the commented-out toggle in Settings.
      setColorTheme("dark");
      setTheme("dark");
    }
    void refresh(address);
    return address;
  }

  /** Switch to another wallet on this device. */
  async function switchTo(index: number) {
    return adopt((await vault.selectAccount(index)) as Address);
  }

  const tourSteps = [
    // Only in the tour when the banner itself is on screen to point at —
    // an owner who's already claimed a tag never sees this step.
    ...(tagsAvailable() && myTag === null
      ? [
          {
            ref: tourTagBannerRef,
            scrollable: true,
            label: t("Your tag", "你的标签"),
            body: t(
              "Claim a short name so people can send to you without typing out an address.",
              "领取一个简短的名称，这样其他人无需输入地址即可向你付款。",
            ),
          },
        ]
      : []),
    {
      ref: tourSwitcherRef,
      scrollable: true,
      label: t("Wallets", "钱包"),
      body: t(
        "Tap your wallet name to switch between wallets, or add another.",
        "点击钱包名称可切换钱包或添加新钱包。",
      ),
    },
    {
      ref: tourBalanceRef,
      scrollable: true,
      label: t("Balance", "余额"),
      body: t(
        "Your total balance across every asset, plus the ETH you're holding for gas.",
        "这里显示你所有资产的总价值，以及用于支付燃料费的 ETH。",
      ),
    },
    {
      ref: tourActionsRef,
      scrollable: true,
      label: t("Quick actions", "快捷操作"),
      body: t(
        "Send, receive, or swap directly. Tap More for everything else this wallet does:",
        "直接发送、接收或兑换。点击“更多”查看钱包的其他全部功能：",
      ),
      // A preview of what's actually inside the More sheet, shown right in
      // the tooltip rather than opening the real sheet for this step: the
      // real one is a Modal, and stacking it under this overlay risks the
      // exact same double-Modal hang fixed elsewhere in the wallet menu.
      extra: (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {(
            [
              ["bridge", t("Bridge", "跨链")],
              ["shield-lock-outline", t("Private", "私密发送")],
              ...(tagsAvailable() ? [["at", t("Tag", "标签")]] : []),
              ["trophy-outline", t("Ranks", "榜单")],
              ["account-multiple-outline", t("Contacts", "联系人")],
            ] as [string, string][]
          ).map(([icon, label]) => (
            <View
              key={icon}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                backgroundColor: colors.wash,
                borderRadius: 999,
                paddingVertical: 6,
                paddingHorizontal: 10,
              }}
            >
              <Icon name={icon} size={14} color={colors.green} />
              <Text style={[s.small, { color: colors.ink }]}>{label}</Text>
            </View>
          ))}
        </View>
      ),
    },
    {
      ref: tourAssetsRef,
      scrollable: true,
      label: t("Assets", "资产"),
      body: t("Your tokens live here.", "你的代币显示在这里。"),
    },
    {
      ref: tourTabBarRef,
      scrollable: false,
      label: t("Navigation", "导航"),
      body: t(
        "Jump between your wallet, activity, the Tera assistant, and settings from here.",
        "在这里可以切换钱包、记录、Tera 助手和设置。",
      ),
    },
  ];
  function measureInWindow(ref: React.RefObject<View | null>): Promise<TourRect | null> {
    return new Promise((resolve) => {
      if (!ref.current) {
        resolve(null);
        return;
      }
      ref.current.measureInWindow((x, y, width, height) => resolve({ x, y, width, height }));
    });
  }
  function wait(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  // Scrolls the target into a consistent spot before measuring it for real:
  // a target's on-screen position depends on scroll, so the first read here
  // is only used to compute how far to scroll, not to place the spotlight.
  async function goToTourStep(index: number) {
    const step = tourSteps[index];
    if (!step) return;
    if (step.scrollable) {
      const first = await measureInWindow(step.ref);
      if (first) {
        const delta = first.y - 150;
        if (Math.abs(delta) > 4) {
          homeScrollRef.current?.scrollTo({
            y: Math.max(0, homeScrollY.current + delta),
            animated: true,
          });
          await wait(360);
        }
      }
    }
    const rect = await measureInWindow(step.ref);
    setTourRect(rect);
    setTourStep(index);
  }
  function nextTourStep() {
    if (tourStep === null) return;
    if (tourStep + 1 >= tourSteps.length) {
      setTourStep(null);
      setTourRect(null);
      return;
    }
    void goToTourStep(tourStep + 1);
  }
  function prevTourStep() {
    if (tourStep === null || tourStep === 0) return;
    void goToTourStep(tourStep - 1);
  }
  function skipTour() {
    setTourStep(null);
    setTourRect(null);
  }
  // Called from Home once it's actually on screen — either immediately, if
  // already there, or after `page` catches up when triggered from elsewhere
  // (first unlock, or "Replay app tour" from Settings).
  function startTour() {
    if (page === "home") {
      void goToTourStep(0);
      return;
    }
    tourPending.current = true;
    setPage("home");
  }
  useEffect(() => {
    if (page === "home" && tourPending.current) {
      tourPending.current = false;
      const id = setTimeout(() => void goToTourStep(0), 250);
      return () => clearTimeout(id);
    }
    // Only `page` should retrigger this — `tourPending` is a ref precisely
    // so setting it doesn't need to also be a dependency here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);
  async function opened(address: Address, guard: () => void) {
    setOwner(address);
    setExists(true);
    setPassword("");
    setMnemonic("");
    setRepeat("");
    setSetup("start");
    setSetupHistory([]);
    syncAccounts();
    void refresh(address);
    void vault
      .loadData()
      .then((saved) => {
        guard();
        const next = saved.tourSeen ? saved : { ...saved, tourSeen: true };
        setData(next);
        dataRef.current = next;
        setLanguage(saved.language);
        // Dark mode only for now — see the commented-out toggle in Settings.
        setColorTheme("dark");
        setTheme("dark");
        if (!saved.tourSeen) {
          void vault.saveData(next).catch(() => {});
          startTour();
        }
      })
      .catch(() => {});
  }
  async function refresh(address = owner) {
    if (!address) return;
    const version = vault.sessionVersion();
    // Fired together, not chained: only balances() actually needs the
    // registry's token list first. Prices and the tag lookup don't depend
    // on anything here, but used to be awaited before/after it anyway,
    // turning three independent requests into three sequential round-trips.
    const registryPromise = api("/api/assets").catch(() => ({ assets: [] }));
    const pricesPromise = api("/api/assets/prices");
    const tagPromise = tagsAvailable()
      ? tags.tagOf(address).catch(() => undefined)
      : Promise.resolve(undefined);
    const registryResult = await registryPromise;
    const registry: Asset[] = registryResult.assets || [];
    const teraAsset: Asset = {
      symbol: "TERA",
      address: "0x3c12e57fa7817a86ce7c254db9ea5fe639e233f8",
      decimals: 18,
      name: "Tera",
    };
    const known = [...sources, teraAsset, ...registry];
    const supported = [
      ...sources,
      teraAsset,
      ...registry.filter((a) => !sources.some((s) => s.symbol === a.symbol) && a.symbol !== "TERA"),
      // Tokens the owner imported by address — anything outside the
      // built-in and registry-known lists, which refresh() would otherwise
      // never check a balance for.
      ...dataRef.current.customTokens.filter(
        (a) => !known.some((k) => k.address.toLowerCase() === a.address.toLowerCase()),
      ),
    ];
    const [balanceResult, pricesResult, tagResult] = await Promise.allSettled([
      balances(address, supported),
      pricesPromise,
      tagPromise,
    ]);
    if (version !== vault.sessionVersion()) return;
    if (balanceResult.status === "fulfilled") setBalance(balanceResult.value);
    else
      setError(
        t("Could not refresh balances. Pull again when connected.", "无法刷新余额，请联网后重试。"),
      );
    if (pricesResult.status === "fulfilled") setPrices(pricesResult.value.prices || { USDG: 1 });
    setAssets(supported);
    // A failure leaves the tag unknown rather than answering "no" — an
    // owner who already holds a tag must not be asked to claim one over a
    // dropped call.
    if (tagResult.status === "fulfilled" && tagResult.value !== undefined)
      setMyTag(tagResult.value);
  }
  async function pullRefresh() {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }
  async function lookupCustomToken() {
    setImportError("");
    setImportLookup(null);
    const address = importAddress.trim();
    if (!isAddress(address)) {
      setImportError(t("Enter a valid contract address.", "请输入有效的合约地址。"));
      return;
    }
    if (
      [...assets, ...data.customTokens].some(
        (a) => a.address.toLowerCase() === address.toLowerCase(),
      )
    )
      return setImportError(t("This token is already tracked.", "该代币已在追踪列表中。"));
    try {
      const [symbol, decimals, name] = await Promise.all([
        client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
        client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
        client
          .readContract({ address, abi: erc20Abi, functionName: "name" })
          .catch(() => undefined),
      ]);
      setImportLookup({ symbol, decimals, address, name });
    } catch {
      setImportError(
        t(
          "Couldn't read a token at that address. Check it's an ERC-20 contract on this network.",
          "无法从该地址读取代币信息，请确认这是本链上的 ERC-20 合约。",
        ),
      );
    }
  }
  async function addCustomToken() {
    const token = importLookup;
    if (!token) return;
    await store({ ...dataRef.current, customTokens: [...dataRef.current.customTokens, token] });
    setImportAddress("");
    setImportLookup(null);
    setNotice({
      title: t("Token added", "代币已添加"),
      body: t(
        `${token.symbol} will show in your assets once you hold a balance.`,
        `如果你持有 ${token.symbol}，将显示在资产列表中。`,
      ),
      tone: "success",
    });
    void refresh();
  }
  async function removeCustomToken(address: string) {
    await store({
      ...dataRef.current,
      customTokens: dataRef.current.customTokens.filter(
        (a) => a.address.toLowerCase() !== address.toLowerCase(),
      ),
    });
    void refresh();
  }
  // Through the shared core rather than summed here. The version this replaced multiplied
  // by `prices[symbol] || 0`, so a holding whose price could not be read was counted as
  // worth nothing and the total still rendered as a complete figure. `totalValue` leaves
  // it out and names it instead, and `valuation.coverage` is what the screen has to read
  // before it can show the number as a total.
  const valuation = valueCore.totalValue(
    balance
      ? assets.map((asset) => ({
          symbol: asset.symbol,
          amount: formatUnits(BigInt(balance[asset.symbol] || "0"), asset.decimals),
        }))
      : [],
    prices,
  );
  // The holdings with something in them, for the home list. Same figures the total is built from.
  const held = balance
    ? assets
        .map((asset) => ({
          asset,
          amount: formatUnits(BigInt(balance[asset.symbol] || "0"), asset.decimals),
        }))
        .filter(({ amount }) => Number(amount) > 0)
    : [];
  // Local history first (it has the richer detail — payee, bridge/relay
  // reference, delivery status — none of which exists on chain), then
  // whatever confirmed on-chain activity isn't already in it. That gap is
  // exactly what's missing on a second device or a fresh install of this
  // same wallet.
  const combinedHistory = [
    ...data.history,
    ...(chainHistory || [])
      .filter((c) => !data.history.some((h) => h.hash === c.hash))
      .map((c) => ({
        hash: c.hash,
        title: c.title,
        step: 1,
        totalSteps: 1,
        status: c.status,
        createdAt: c.timestamp,
      })),
  ].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
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
  function continueBridge() {
    if (bridgeStep === 0) {
      if (bridgeMode === "private" && assetSymbol !== "ETH" && assetSymbol !== "USDG") {
        setAssetSymbol("USDG");
      }
      setBridgeStep(1);
      return;
    }
    if (bridgeStep === 1) {
      setBridgeStep(2);
      return;
    }
    if (bridgeStep === 2) {
      try {
        const source = sources.find((s) => s.symbol === assetSymbol) || sources[0];
        const decimals = source.decimals;
        const requested = BigInt(units(amount, decimals));
        const available = BigInt(balance?.[source.symbol] || "0");
        if (requested > available) {
          setAmountInvalid(true);
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setNotice({
            title: t("Insufficient balance", "余额不足"),
            body: t(
              `You have ${formatUnits(available, decimals)} ${source.symbol} available.`,
              `可用余额为 ${formatUnits(available, decimals)} ${source.symbol}。`,
            ),
            tone: "error",
          });
          return;
        }
        setAmountInvalid(false);
        setBridgeStep(3);
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
    if (bridgeStep === 3) {
      const destAddr = recipient.trim();
      const isValid =
        dest.id === 792703809
          ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(destAddr)
          : isAddress(destAddr);
      if (!isValid) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setNotice({
          title: t("Invalid destination address", "目标地址无效"),
          body:
            dest.id === 792703809
              ? t("Enter a valid Solana wallet address.", "请输入有效的 Solana 钱包地址。")
              : t(
                  "Enter a valid EVM (0x...) wallet address.",
                  "请输入有效的 EVM (0x...) 钱包地址。",
                ),
          tone: "error",
        });
        return;
      }
      setBridgeStep(4);
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
   * Install the published version, from the bubble on the home screen.
   *
   * The APK is downloaded here, checked against the digest the build
   * published, and handed to Android's installer. Android then shows its own
   * install screen — and, the first time, asks to allow installs from this
   * app. No app can skip either, and the bubble says so before it starts.
   */
  async function runUpdate(guard: () => void) {
    if (!update) return;
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
    const payee = i.actionType === "TRANSFER" ? i.recipient : undefined;
    const savedAs = payee ? contactsCore.nameFor(book, payee) : "";
    if (savedAs) rows.push([t("Saved as", "已保存为"), savedAs]);
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
      payee,
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
        ...(contactsCore.nameFor(book, destination)
          ? ([[t("Saved as", "已保存为"), contactsCore.nameFor(book, destination)]] as [
              string,
              string,
            ][])
          : []),
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
      payee: destination,
      reference: created.job.id,
      afterSubmitted: async (hash) => {
        await api(`/api/private-send/jobs/${created.job.id}/deposit`, { txHash: hash });
      },
    });
  }
  async function preparePrivateBridge(guard: () => void) {
    const source = sources.find((s) => s.symbol === assetSymbol) || sources[0];
    check(
      ["ETH", "USDG"].includes(source.symbol),
      t("Private bridge currently supports ETH and USDG.", "私密跨链当前支持 ETH 和 USDG。"),
    );
    const destAddr = recipient.trim();
    check(
      dest.id === 792703809 ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(destAddr) : isAddress(destAddr),
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
      originCurrency: source.address,
      assetSymbol: source.symbol,
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
        [t("Routing", "路由"), t("Bridge vault → Relay → recipient", "跨链金库 → Relay → 收款方")],
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
        transferTx(source.address as Address, created.job.vault_address, raw);
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
  function sendNft(token: NftItem, recipientText: string) {
    try {
      const recipient = recipientText.trim();
      check(isAddress(recipient), t("Enter a valid recipient address.", "请输入有效的收款地址。"));
      const step = nft.transferCall(token, owner, recipient);
      const reviewed = { ...step, chainId: chain.id } as Tx;
      void presentReview({
        title: t("Send NFT", "发送 NFT"),
        rows: [
          [t("NFT", "NFT"), token.metadata?.name || "#" + token.tokenId],
          [t("Collection", "合集"), token.collection || t("Unnamed collection", "未命名合集")],
          [t("Token ID", "代币编号"), token.tokenId],
          [t("Recipient", "收款方"), recipient],
        ],
        steps: [reviewed],
        recipient,
        verify: () => nft.checkTransfer(reviewed, token, owner, recipient),
      });
    } catch (e) {
      Alert.alert(t("Cannot send NFT", "无法发送 NFT"), String((e as Error)?.message || e));
    }
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
            payee: record.step === record.totalSteps ? r.payee : undefined,
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
      const payee = r.payee && isAddress(r.payee) ? r.payee : "";
      if (
        payee &&
        payee.toLowerCase() !== owner.toLowerCase() &&
        !contactsCore.nameFor(dataRef.current.contacts, payee)
      )
        openContact(payee, true);
      else
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
    setAuthError("");
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
  const title = (
    en: string,
    zh: string,
    subtitle?: string,
    align: "left" | "center" = "center",
  ) => (
    <View style={{ gap: 14, alignItems: align === "center" ? "center" : "flex-start" }}>
      <Text style={[s.title, { textAlign: align }]}>{t(en, zh)}</Text>
      {subtitle && (
        <Text style={[s.small, { fontSize: 15, lineHeight: 21, textAlign: align }]}>
          {subtitle}
        </Text>
      )}
    </View>
  );
  // Auth screens open with a hero graphic + title. `fill` (the default)
  // sits them in the vertical middle of the space before the controls that
  // follow (PIN pad, keypad) — right for screens with enough trailing
  // content to balance it. A screen whose trailing content is just one
  // field or a short form (import, the phrase/backup steps) has too little
  // below to balance a flex:1 header: centering it in *all* the leftover
  // space stretches that gap to the entire screen height instead of a
  // sensible one, so those pass `fill: false` for a fixed gap instead.
  const authHeader = (hero: React.ReactNode, titleNode: React.ReactNode, fill = true) => (
    <View
      style={fill ? { flex: 1, justifyContent: "center", gap: 24 } : { gap: 24, paddingTop: 4 }}
    >
      {hero}
      {titleNode}
    </View>
  );
  const action = (
    en: string,
    zh: string,
    work: (g: () => void) => Promise<void>,
    primary = true,
  ) => (
    <Button primary={primary} disabled={busy} onPress={() => void run(work)}>
      {busy ? <TeraSpinner size={18} /> : t(en, zh)}
    </Button>
  );
  function toggleLanguage() {
    const next = language === "en" ? "zh" : "en";
    setLanguage(next);
    if (owner) void store({ ...dataRef.current, language: next }).catch(() => {});
  }
  const languageControl = (
    <Pressable accessibilityRole="button" onPress={toggleLanguage}>
      <Text style={s.mono}>{language === "en" ? "中文" : "EN"}</Text>
    </Pressable>
  );
  function onboarding() {
    if (!ready)
      return (
        <View style={{ alignItems: "center", gap: 18, marginTop: 120 }}>
          <TeraSpinner size={40} />
          <Text style={s.text}>{t("Opening wallet…", "正在打开钱包…")}</Text>
        </View>
      );
    if (exists)
      return (
        <>
          {authHeader(
            <Illustration />,
            title(
              "Your wallet.\nYour authority.",
              "你的钱包。\n你的权限。",
              t("Unlock on this device.", "在此设备上解锁。"),
            ),
          )}
          {pinWallet ? (
            <>
              <PinInput label={t("Six-digit wallet PIN", "六码钱包 PIN")} value={password} />
              {busy ? (
                // Same height as the Keypad it replaces (4 rows of 72 + 3
                // gaps of 16), so the loader doesn't collapse the layout
                // into a tiny icon stranded where the keypad used to be.
                <View style={{ height: 336, alignItems: "center", justifyContent: "center" }}>
                  <TeraSpinner size={44} />
                </View>
              ) : (
                <Keypad
                  onDigit={(d) => {
                    if (password.length >= 6) return;
                    const next = password + d;
                    setPassword(next);
                    // Six digits is the whole PIN — submit immediately
                    // rather than making the owner also find and tap an
                    // Unlock button.
                    if (next.length === 6)
                      void run(async (g) => {
                        try {
                          const address = await vault.unlock(next);
                          g();
                          await opened(address, g);
                        } catch (e) {
                          // Wrong PIN: clear the boxes so the retry starts
                          // from empty instead of six already-wrong digits.
                          setPassword("");
                          throw e;
                        }
                      });
                  }}
                  onBackspace={() => setPassword((p) => p.slice(0, -1))}
                />
              )}
            </>
          ) : null}
          {!pinWallet && (
            <>
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
            </>
          )}
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() =>
              void run(async (g) => {
                const address = await vault.unlock(null);
                g();
                await opened(address, g);
              })
            }
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              paddingVertical: 8,
              opacity: busy ? 0.4 : pressed ? 0.6 : 1,
            })}
          >
            <Icon name="fingerprint" size={17} color={colors.green} />
            <Text style={[s.small, { color: colors.green, fontWeight: "600" }]}>
              {t("Use biometrics", "使用生物识别")}
            </Text>
          </Pressable>
          <View style={{ flex: 1 }} />
          <Pressable
            accessibilityRole="button"
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
                    setSetupHistory([]);
                  }),
              )
            }
            style={({ pressed }) => ({
              alignItems: "center",
              paddingVertical: 8,
              opacity: busy ? 0.4 : pressed ? 0.6 : 1,
            })}
          >
            <Text style={[s.small, { textDecorationLine: "underline" }]}>
              {t("Recover with a phrase", "使用助记词恢复")}
            </Text>
          </Pressable>
        </>
      );
    if (setup === "start")
      return (
        <>
          {authHeader(
            <WelcomeHero />,
            title(
              "Your assets.\nYour rules.",
              "你的资产。\n你的规则。",
              t(
                "Self-custodial. Your recovery phrase and keys never leave this device.",
                "自主保管。助记词和密钥永远只保存在此设备上。",
              ),
            ),
          )}
          <View style={{ flex: 1 }} />
          <Button
            primary
            disabled={busy}
            onPress={() => {
              setMnemonic(vault.newPhrase());
              goSetup("phrase");
            }}
          >
            {t("Create wallet", "创建钱包")}
          </Button>
          <Button onPress={() => goSetup("import")}>
            {t("I already have a wallet", "我已有钱包")}
          </Button>
        </>
      );
    if (setup === "phrase" || setup === "backup") {
      const words = mnemonic.split(" ");
      function pickChip(wordIdx: number) {
        setPickedChips((prev) => {
          if (prev.includes(wordIdx)) return prev;
          const slot = activeAnswerSlot;
          if (slot < 0 || slot > 2 || prev[slot] !== null) return prev;
          const next = prev.map((x, i) => (i === slot ? wordIdx : x));
          setAnswers((a) => a.map((x, i) => (i === slot ? words[wordIdx] : x)));
          return next;
        });
        // Choosing a word answers the question that opened this list —
        // close it, rather than leaving it open or jumping to the next slot.
        setActiveAnswerSlot(-1);
      }
      function tapSlot(slot: number) {
        if (activeAnswerSlot === slot) {
          setActiveAnswerSlot(-1);
          return;
        }
        if (pickedChips[slot] !== null) {
          setPickedChips((p) => p.map((x, i) => (i === slot ? null : x)));
          setAnswers((a) => a.map((x, i) => (i === slot ? "" : x)));
        }
        setActiveAnswerSlot(slot);
      }
      return (
        <>
          {authHeader(
            <Illustration />,
            title(
              setup === "phrase" ? "Write these down." : "Check your backup.",
              setup === "phrase" ? "请记下这些单词。" : "检查你的备份。",
              t(
                "Anyone with these words can move your funds. Tera cannot recover them for you.",
                "拥有这些单词的人可以转走资金，Tera 无法替你恢复。",
              ),
            ),
            false,
          )}
          {setup === "phrase" ? (
            <>
              <View style={[s.panel, s.wrap, { justifyContent: "space-between", rowGap: 10 }]}>
                {mnemonic.split(" ").map((w, i) => (
                  <View
                    key={i}
                    style={{
                      width: "48%",
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                      backgroundColor: colors.raised,
                      borderRadius: 12,
                      paddingVertical: 12,
                      paddingHorizontal: 12,
                    }}
                  >
                    <Text style={[s.small, { width: 20, color: colors.faint }]}>{i + 1}</Text>
                    <Text style={[s.mono, { fontSize: 15 }]}>{w}</Text>
                  </View>
                ))}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("Copy recovery phrase", "复制助记词")}
                onPress={() =>
                  void Clipboard.setStringAsync(mnemonic).then(() =>
                    setNotice({
                      title: t("Phrase copied", "助记词已复制"),
                      body: t(
                        "Paste it somewhere private, then clear your clipboard.",
                        "请粘贴到私密位置，然后清空剪贴板。",
                      ),
                      tone: "success",
                    }),
                  )
                }
                style={({ pressed }) => [
                  { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
                  { paddingVertical: 10, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Icon name="content-copy" size={16} color={colors.muted} />
                <Text style={[s.small, { color: colors.muted, fontWeight: "600" }]}>
                  {t("Copy", "复制")}
                </Text>
              </Pressable>
              <Button
                primary
                onPress={() => {
                  setAnswers(["", "", ""]);
                  setPickedChips([null, null, null]);
                  setActiveAnswerSlot(-1);
                  goSetup("backup");
                }}
              >
                {t("I wrote them down", "我已记下")}
              </Button>
            </>
          ) : (
            <>
              {[2, 6, 10].map((n, i) => (
                <View key={n} style={s.field}>
                  <Text style={s.eyebrow}>{t(`Word ${n + 1}`, `第 ${n + 1} 个单词`)}</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t(`Word ${n + 1}`, `第 ${n + 1} 个单词`)}
                    onPress={() => tapSlot(i)}
                    style={[
                      s.input,
                      {
                        justifyContent: "center",
                        borderColor: activeAnswerSlot === i ? colors.green : colors.line,
                        borderWidth: activeAnswerSlot === i ? 2 : 1,
                      },
                    ]}
                  >
                    <Text style={[s.mono, { fontSize: 16 }]}>{answers[i]}</Text>
                  </Pressable>
                  {activeAnswerSlot === i && (
                    <View style={[s.wrap, { marginTop: 2 }]}>
                      {shuffleOrder(mnemonic, words.length)
                        .filter((wordIdx) => !pickedChips.includes(wordIdx))
                        .map((wordIdx) => (
                          <Pressable
                            key={wordIdx}
                            accessibilityRole="button"
                            onPress={() => pickChip(wordIdx)}
                            style={({ pressed }) => ({
                              paddingVertical: 10,
                              paddingHorizontal: 16,
                              borderRadius: 999,
                              backgroundColor: colors.tint,
                              opacity: pressed ? 0.6 : 1,
                            })}
                          >
                            <Text
                              style={[
                                s.mono,
                                { fontSize: 15, color: colors.green, fontWeight: "600" },
                              ]}
                            >
                              {words[wordIdx]}
                            </Text>
                          </Pressable>
                        ))}
                    </View>
                  )}
                </View>
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
                    setPickedChips([null, null, null]);
                    setActiveAnswerSlot(-1);
                    goSetup("password");
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
    }
    if (setup === "import")
      return (
        <>
          {authHeader(
            <Illustration />,
            title(
              "Welcome back.",
              "欢迎回来。",
              t(
                "Import a standard English recovery phrase. Uses the first Ethereum account; BIP-39 passphrases are not supported in this version.",
                "导入标准英文助记词，使用第一个以太坊账户，此版本不支持 BIP-39 附加口令。",
              ),
            ),
            false,
          )}
          <View style={s.field}>
            <Text style={s.eyebrow}>{t("Recovery phrase", "助记词")}</Text>
            <View style={[s.input, { padding: 0, overflow: "hidden" }]}>
              <TextInput
                accessibilityLabel={t("Recovery phrase", "助记词")}
                placeholderTextColor={colors.muted}
                autoCorrect={false}
                autoCapitalize="none"
                value={mnemonic}
                onChangeText={setMnemonic}
                multiline
                secureTextEntry={false}
                autoComplete="off"
                importantForAutofill="noExcludeDescendants"
                style={{
                  minHeight: mnemonic ? 110 : 60,
                  textAlignVertical: "top",
                  padding: 15,
                  color: colors.ink,
                  fontSize: 16,
                }}
              />
              {!mnemonic && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("Paste recovery phrase", "粘贴助记词")}
                  onPress={() =>
                    void Clipboard.getStringAsync()
                      .then((text) => {
                        if (text) setMnemonic(text);
                        else
                          setNotice({
                            title: t("Nothing to paste", "剪贴板为空"),
                            body: t(
                              "Copy your recovery phrase first, then try again.",
                              "请先复制助记词，然后重试。",
                            ),
                            tone: "error",
                          });
                      })
                      .catch(() =>
                        setNotice({
                          title: t("Couldn’t read the clipboard", "无法读取剪贴板"),
                          body: t("Paste it in manually instead.", "请改为手动粘贴。"),
                          tone: "error",
                        }),
                      )
                  }
                  style={({ pressed }) => [
                    {
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      paddingBottom: 16,
                    },
                    { opacity: pressed ? 0.6 : 1 },
                  ]}
                >
                  <Icon name="content-paste" size={18} color={colors.muted} />
                  <Text style={[s.small, { color: colors.muted, fontWeight: "600" }]}>
                    {t("Paste", "粘贴")}
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
          <Button
            primary
            onPress={() => {
              try {
                walletFromPhrase(mnemonic);
                setMnemonic(normalizePhrase(mnemonic));
                goSetup("password");
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
        {authHeader(
          <Illustration />,
          password.length < 6
            ? title(
                "Protect this wallet.",
                "保护此钱包。",
                t(
                  "Choose a six-digit PIN. Use your recovery phrase if you forget it.",
                  "设置六码 PIN，忘记时可使用助记词恢复。",
                ),
              )
            : title(
                "Confirm your PIN.",
                "确认您的 PIN。",
                t("Enter it once more to make sure.", "请再次输入以确认。"),
              ),
        )}
        {password.length < 6 ? (
          <PinInput label={t("Six-digit PIN", "六码 PIN")} value={password} />
        ) : (
          <PinInput label={t("Repeat PIN", "重复 PIN")} value={repeat} />
        )}
        {busy ? (
          // Same height as the Keypad it replaces (4 rows of 72 + 3 gaps of
          // 16), so the loader doesn't collapse the layout into a tiny icon
          // stranded where the keypad used to be.
          <View style={{ height: 336, alignItems: "center", justifyContent: "center" }}>
            <TeraSpinner size={44} />
          </View>
        ) : (
          <Keypad
            onDigit={(d) => {
              // Pure length-derived focus, no extra state needed: still
              // filling the first PIN below 6 digits, else filling repeat.
              if (password.length < 6) {
                const next = password + d;
                setPassword(next);
              } else if (repeat.length < 6) {
                const next = repeat + d;
                setRepeat(next);
                checkPinSetup(password, next);
              }
            }}
            onBackspace={() => {
              // Backspacing an empty Repeat field falls back to editing the
              // PIN, rather than doing nothing — the natural way to "go
              // back" without a separate tap-to-refocus gesture.
              if (repeat.length > 0) setRepeat((r) => r.slice(0, -1));
              else setPassword((p) => p.slice(0, -1));
            }}
          />
        )}
      </>
    );
  }
  // Fires from either PIN field's onChangeText — either one could be the
  // field that completes the pair — with both current values passed
  // explicitly rather than read from state, since the state update from
  // this same keystroke hasn't landed yet.
  function checkPinSetup(pin: string, repeatPin: string) {
    if (pin.length !== 6 || repeatPin.length !== 6) return;
    void run(async (g) => {
      try {
        check(pin === repeatPin, t("PINs must match.", "两次 PIN 必须一致。"));
        const address = await vault.createWallet(mnemonic, pin);
        g();
        await opened(address, g);
      } catch (e) {
        // Mismatch: clear both so the retry starts from empty instead of
        // two already-wrong PINs.
        setPassword("");
        setRepeat("");
        throw e;
      }
    });
  }
  // Every way into a flow starts it from the same clean state — the home
  // shortcuts, and the action sheet behind the centre tab.
  function openFlow(p: string, mode: "public" | "private" = "public") {
    setError("");
    setAssetSymbol(p === "swap" ? "AAPL" : "USDG");
    setAmount("");
    setRecipient("");
    setFlowStep(0);
    setBridgeStep(0);
    setSwapReceivePicker(false);
    if (p === "swap") setTrade("BUY");
    if (p === "send") {
      setSendMode(mode);
      if (mode === "private") {
        setAssetSymbol("ETH");
        setPrivateAsset("ETH");
      }
    }
    if (p === "bridge") {
      setBridgeMode("public");
      setAssetSymbol("USDG");
      setDestination(8453);
      setOutSymbol("ETH");
    }
    setPage(p);
  }
  const contactNote = t(
    contactsCore.PRIVACY_NOTE,
    "名称仅保存在此设备的加密钱包数据中，不会发送给 Tera。名称只是你的标签，并非核验：签名前请核对地址。",
  );
  function openContact(address: string, afterSend = false) {
    setContactName(address ? contactsCore.nameFor(book, address) : "");
    setContactAddress(address);
    setContactError("");
    setContactSheet({ address, fixed: !!address, afterSend });
  }
  async function saveContactNow() {
    const sheet = contactSheet;
    if (!sheet) return;
    const result = contactsCore.saveContact(dataRef.current.contacts, {
      address: sheet.fixed ? sheet.address : contactAddress,
      name: contactName,
      owner,
    });
    const saved = result.contact;
    if (!result.ok || !saved) {
      setContactError(result.reason);
      return;
    }
    await store({ ...dataRef.current, contacts: result.book });
    setContactSheet(null);
    setNotice({
      title: t("Contact saved", "联系人已保存"),
      body: t(
        `${saved.name} is saved for ${contactsCore.short(saved.address)} on this device only.`,
        `已在本设备保存 ${saved.name}（${contactsCore.short(saved.address)}）。`,
      ),
      tone: "success",
    });
  }
  function removeContactNow(address: string) {
    confirm(
      t("Remove contact", "删除联系人"),
      t(
        "The name is removed from this device. The address itself is unchanged.",
        "名称将从此设备删除，地址本身不受影响。",
      ),
      () =>
        void run(async () => {
          await store({
            ...dataRef.current,
            contacts: contactsCore.removeContact(dataRef.current.contacts, address),
          });
          setContactSheet(null);
        }),
    );
  }
  /** Start a public send with this address already on the recipient step. */
  function sendTo(address: string) {
    setError("");
    setAssetSymbol("USDG");
    setAmount("");
    setRecipient(address);
    setRecipientKind("address");
    setTagLookup({ state: "idle" });
    setFlowStep(0);
    setSendMode("public");
    setPage("send");
  }
  /**
   * Saved names and recent payees under the recipient field. A pick fills the
   * full address, which is what the checks and the signature see.
   */
  function recipientPicks() {
    const typed = recipient.trim();
    if (isAddress(typed)) {
      const name = contactsCore.nameFor(book, typed);
      return name ? (
        <Text style={[s.small, { color: colors.green }]}>
          {t(
            `Saved as ${name}. Read the address above — it is what gets signed.`,
            `已保存为 ${name}。请核对上方地址——签名的是该地址。`,
          )}
        </Text>
      ) : null;
    }
    const saved = contactsCore.searchContacts(book, typed);
    const recent = typed
      ? []
      : contactsCore.recentPayees(data.history, book, { owner }).filter((entry) => !entry.name);
    const picks = [...saved, ...recent].slice(0, 6);
    if (!picks.length) return null;
    return (
      <View style={{ gap: 8 }}>
        <Text style={s.eyebrow}>
          {typed ? t("SAVED CONTACTS", "已保存联系人") : t("CONTACTS & RECENT", "联系人与最近")}
        </Text>
        {picks.map((entry) => (
          <Pressable
            key={entry.address}
            accessibilityRole="button"
            accessibilityLabel={`${entry.name || t("Sent before", "曾发送")} ${entry.address}`}
            onPress={() => {
              setRecipient(entry.address);
              setTagLookup({ state: "idle" });
            }}
            style={[s.panel, { flexDirection: "row", alignItems: "center", gap: 12 }]}
          >
            <Icon
              name={entry.name ? "account-circle-outline" : "history"}
              size={24}
              color={colors.green}
            />
            <View style={{ flex: 1 }}>
              <Text style={[s.text, { fontWeight: "700" }]}>
                {entry.name || t("Sent before", "曾发送")}
              </Text>
              <Text style={s.mono} numberOfLines={1} ellipsizeMode="middle">
                {entry.address}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
    );
  }
  /**
   * Its own layout, not a page inside the shared ScrollView like everything
   * else — a chat only reads as a chat when the input is pinned to the
   * bottom and the conversation scrolls in the space above it, rather than
   * the input sitting wherever it falls in a page that scrolls as one long
   * column.
   */
  function assistantScreen() {
    const teraAvatar = (
      <View style={[s.iconDisc, { width: 28, height: 28, borderRadius: 14 }]}>
        <Image
          source={require("./assets/logo-mark.png")}
          style={{ width: 16, height: 16 }}
          resizeMode="contain"
        />
      </View>
    );
    return (
      <View style={{ flex: 1 }}>
        <Header
          title={t("Tera assistant", "Tera 助手")}
          onBack={() => setPage("home")}
          backLabel={t("Wallet", "钱包")}
        />
        <ScrollView
          ref={chatScrollRef}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20, gap: 14 }}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => chatScrollRef.current?.scrollToEnd({ animated: true })}
        >
          <Text style={[s.small, { textAlign: "center" }]}>
            {t(
              "Messages go to the assistant service. Proposals need your review.",
              "消息将发送至助手服务，提案需要你审核。",
            )}
          </Text>
          <Choices
            options={[t("Ask a question", "提问"), t("Prepare a proposal", "准备提案")]}
            value={propose ? t("Prepare a proposal", "准备提案") : t("Ask a question", "提问")}
            select={(v) => setPropose(v === t("Prepare a proposal", "准备提案"))}
          />
          {data.token && (
            <Text style={s.eyebrow}>{t("Scoped session connected", "已连接限定权限的会话")}</Text>
          )}
          <View style={{ gap: 12 }}>
            {!chat.length && (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "flex-end",
                  gap: 8,
                  alignSelf: "flex-start",
                  maxWidth: "88%",
                }}
              >
                {teraAvatar}
                <View style={[s.panel, { flexShrink: 1, borderBottomLeftRadius: 4 }]}>
                  <Text style={s.text}>
                    {t(
                      "Ask about an asset or tell me what you want to do.",
                      "询问资产，或告诉我你想做什么。",
                    )}
                  </Text>
                </View>
              </View>
            )}
            {chat.map((m, i) =>
              m.role === "you" ? (
                <View
                  key={i}
                  style={[
                    s.panel,
                    {
                      maxWidth: "88%",
                      alignSelf: "flex-end",
                      borderBottomRightRadius: 4,
                      backgroundColor: colors.green,
                    },
                  ]}
                >
                  <Text selectable style={[s.text, { color: colors.paper }]}>
                    {m.text.replace(/\*\*(.*?)\*\*/g, "$1").replace(/^#{1,6}\s/gm, "")}
                  </Text>
                </View>
              ) : (
                <View
                  key={i}
                  style={{
                    flexDirection: "row",
                    alignItems: "flex-end",
                    gap: 8,
                    alignSelf: "flex-start",
                    maxWidth: "88%",
                  }}
                >
                  {teraAvatar}
                  <View style={[s.panel, { flexShrink: 1, borderBottomLeftRadius: 4 }]}>
                    <Text selectable style={s.text}>
                      {m.text.replace(/\*\*(.*?)\*\*/g, "$1").replace(/^#{1,6}\s/gm, "")}
                    </Text>
                  </View>
                </View>
              ),
            )}
            {busy && (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  alignSelf: "flex-start",
                }}
              >
                <View style={[s.iconDisc, { width: 28, height: 28, borderRadius: 14 }]}>
                  <TeraSpinner size={16} />
                </View>
                <Text style={[s.small, { color: colors.muted, fontStyle: "italic" }]}>
                  {t("Tera is thinking…", "Tera 正在思考…")}
                </Text>
              </View>
            )}
          </View>
          {data.drafts.length > 0 && (
            <View style={{ gap: 12 }}>
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
            </View>
          )}
        </ScrollView>
        <View
          style={{
            paddingHorizontal: 16,
            paddingTop: 10,
            paddingBottom: 14,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderColor: colors.line,
            backgroundColor: colors.bg,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
            {/* Caps growth like a real chat input (ChatGPT/iMessage-style):
                grows with content up to ~6 lines, then scrolls internally
                instead of swallowing the whole screen and pushing the send
                button out of reach. */}
            <TextInput
              value={message}
              onChangeText={setMessage}
              maxLength={1200}
              multiline
              placeholder={t("Message Tera…", "给 Tera 发消息…")}
              placeholderTextColor={colors.muted}
              style={{
                flex: 1,
                borderWidth: 1,
                borderColor: colors.line,
                borderRadius: 22,
                backgroundColor: colors.wash,
                paddingHorizontal: 16,
                paddingVertical: 12,
                minHeight: 44,
                maxHeight: 140,
                color: colors.ink,
                fontSize: 16,
              }}
            />
            {message.trim() ? (
              <Pressable
                disabled={busy}
                onPress={startAssistantMessage}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: colors.green,
                  opacity: busy ? 0.45 : 1,
                }}
              >
                <Icon name="arrow-up" color={colors.paper} size={20} />
              </Pressable>
            ) : (
              <Pressable
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={t("Voice message", "语音消息")}
                onPress={() => void startVoiceMode()}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  borderWidth: 1,
                  borderColor: colors.line,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: busy ? 0.45 : 1,
                }}
              >
                <Icon name="mic" color={colors.green} size={20} />
              </Pressable>
            )}
          </View>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: minimiseEnabled }}
            onPress={() => setMinimiseEnabled((enabled) => !enabled)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingTop: 10,
              paddingHorizontal: 4,
            }}
          >
            <Toggle on={minimiseEnabled} small />
            <Text style={[s.small, { flex: 1 }]} numberOfLines={1}>
              {t("Review what leaves this phone before sending", "发送前审核离开本机的内容")}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }
  // Shared by the Home screen's compact list and the full Tokens screen, so
  // a held asset looks identical whichever one it's read from.
  function assetRow(asset: Asset, amount: string, first: boolean) {
    return (
      <View
        key={asset.symbol}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingVertical: 12,
          borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
          borderColor: colors.line,
        }}
      >
        <TokenIcon symbol={asset.symbol} size={38} chainBadge />
        <View style={{ flex: 1 }}>
          <Text style={s.label}>{asset.symbol}</Text>
          <Text style={s.small} numberOfLines={1}>
            {shortAmount(amount)}
          </Text>
        </View>
        <Text style={s.label}>
          {valueCore.format(valueCore.valueOf(amount, prices[asset.symbol]))}
        </Text>
      </View>
    );
  }
  function main() {
    if (page === "tokens")
      return (
        <>
          <Header
            title={t("Tokens", "代币")}
            onBack={() => setPage("home")}
            backLabel={t("Wallet", "钱包")}
            right={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("Import a token", "导入代币")}
                hitSlop={8}
                onPress={() => {
                  setImportAddress("");
                  setImportLookup(null);
                  setImportError("");
                  setPage("import-token");
                }}
                style={({ pressed }) => ({
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: pressed ? colors.raised : colors.wash,
                })}
              >
                <Icon name="plus" size={20} color={colors.ink} />
              </Pressable>
            }
          />
          {held.length ? (
            <View style={[s.panel, { paddingVertical: 4, gap: 0 }]}>
              {held.map(({ asset, amount }, i) => assetRow(asset, amount, i === 0))}
            </View>
          ) : (
            <View style={[s.panel, { alignItems: "center", paddingVertical: 22 }]}>
              <Text style={s.small}>
                {t("No balances on this wallet yet.", "此钱包暂无余额。")}
              </Text>
            </View>
          )}
        </>
      );
    if (page === "import-token")
      return (
        <>
          <Header
            title={t("Import tokens", "导入代币")}
            onBack={() => setPage("tokens")}
            backLabel={t("Tokens", "代币")}
          />
          <Text style={s.small}>
            {t(
              "Add a token by its contract address on Robinhood Chain. It'll show in your assets once you hold a balance.",
              "输入 Robinhood Chain 上的合约地址以添加代币。持有余额后将显示在资产列表中。",
            )}
          </Text>
          <View style={s.field}>
            <Text style={s.eyebrow}>{t("Contract address", "合约地址")}</Text>
            <TextInput
              value={importAddress}
              onChangeText={(v) => {
                setImportAddress(v);
                setImportLookup(null);
                setImportError("");
              }}
              placeholder="0x…"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              style={s.input}
            />
          </View>
          {importError ? (
            <Text style={[s.small, { color: colors.danger }]}>{importError}</Text>
          ) : null}
          {importLookup ? (
            <View style={[s.panel, { flexDirection: "row", alignItems: "center", gap: 12 }]}>
              <TokenIcon symbol={importLookup.symbol} size={38} />
              <View style={{ flex: 1 }}>
                <Text style={s.label}>{importLookup.symbol}</Text>
                {importLookup.name ? <Text style={s.small}>{importLookup.name}</Text> : null}
              </View>
            </View>
          ) : null}
          {importLookup
            ? action("Add token", "添加代币", addCustomToken)
            : action("Look up token", "查找代币", lookupCustomToken, false)}
          {data.customTokens.length > 0 && (
            <Group title={t("Imported tokens", "已导入的代币")}>
              {data.customTokens.map((token) => (
                <ListRow
                  key={token.address}
                  icon="wallet-outline"
                  label={token.symbol}
                  detail={short(token.address)}
                  right={
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("Remove token", "移除代币")}
                      hitSlop={10}
                      onPress={() => void removeCustomToken(token.address)}
                      style={({ pressed }) => ({ padding: 4, opacity: pressed ? 0.5 : 1 })}
                    >
                      <Icon name="trash-2" size={18} color={colors.danger} />
                    </Pressable>
                  }
                />
              ))}
            </Group>
          )}
        </>
      );
    if (page === "nfts" && owner)
      return (
        <Gallery key={owner} owner={owner} t={t} onBack={() => setPage("home")} onSend={sendNft} />
      );
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
                      `This version is no longer supported. Update to version ${update.manifest.versionName} to keep using the app safely.`,
                      `此版本已不再受支持。请更新到版本 ${update.manifest.versionName} 以继续安全使用。`,
                    )
                  : t(
                      `A new version of Tera (${update.manifest.versionName}) has been released. Update to get the latest changes.`,
                      `Tera 新版本（${update.manifest.versionName}）已发布。请更新以获取最新内容。`,
                    )}
              </Text>
              {update.manifest.notes ? <Text style={s.small}>{update.manifest.notes}</Text> : null}
              {updateStage === "downloading" ? (
                <Text style={s.small}>
                  {t(
                    `Downloading… ${Math.round(updateProgress * 100)}%`,
                    `正在下载… ${Math.round(updateProgress * 100)}%`,
                  )}
                </Text>
              ) : updateStage === "installing" ? (
                <Text style={s.small}>
                  {t(
                    "Download checked. Confirm the install on Android's screen.",
                    "下载已校验。请在 Android 界面上确认安装。",
                  )}
                </Text>
              ) : (
                <Text style={s.small}>
                  {t(
                    `The download${update.manifest.sizeBytes ? ` (${Math.round(update.manifest.sizeBytes / 1e6)} MB)` : ""} is checked before anything is installed. Android then asks you to confirm the install, and the first time it asks you to allow installs from Tera. Your wallet stays on the phone.`,
                    `下载文件${update.manifest.sizeBytes ? `（${Math.round(update.manifest.sizeBytes / 1e6)} MB）` : ""}会先经过校验再安装。随后 Android 会请您确认安装；首次还会请您允许 Tera 安装应用。您的钱包会保留在手机上。`,
                  )}
                </Text>
              )}
              {action("Update", "更新", runUpdate)}
            </View>
          )}
          {tagsAvailable() && myTag === null && (
            <Pressable
              ref={tourTagBannerRef}
              accessibilityRole="button"
              onPress={() => setPage("tag")}
              style={[s.panel, { flexDirection: "row", alignItems: "center", gap: 12 }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.text}>{t("Claim your Tera tag", "领取您的 Tera 标签")}</Text>
                <Text style={s.small}>
                  {t("Send to a name instead of an address.", "以名称代替地址收款。")}
                </Text>
              </View>
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: colors.green,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon name="chevron-right" size={20} color={colors.paper} />
              </View>
            </Pressable>
          )}
          <View
            ref={tourSwitcherRef}
            collapsable={false}
            style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
          >
            <View
              style={{
                width: 46,
                height: 46,
                borderRadius: 23,
                backgroundColor: colors.tint,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name="wallet-outline" size={22} color={colors.green} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.small}>{t("Welcome back,", "欢迎回来，")}</Text>
              {/*
                The wallet this total belongs to, named above the figure rather
                than tucked into Settings. With more than one wallet on the
                device a bare number is ambiguous, and the ambiguity is the
                expensive kind: it is the figure someone checks before deciding
                whether a transfer leaves them enough.
              */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("Switch or add a wallet", "切换或添加钱包")}
                onPress={() => {
                  setSettingsSection("accounts");
                  setPage("settings");
                }}
                style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
              >
                <Text style={[s.text, { fontSize: 17, fontWeight: "700" }]} numberOfLines={1}>
                  {walletName(accounts.find((entry) => entry.active) || { index: 0, name: "" })}
                </Text>
                <Icon name="chevron-down" size={18} color={colors.muted} />
              </Pressable>
            </View>
            {tagsAvailable() && myTag ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setPage("tag")}
                style={{
                  backgroundColor: colors.wash,
                  borderRadius: 999,
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                }}
              >
                <Text style={[s.small, { color: colors.green, fontWeight: "600" }]}>
                  {tags.display(myTag)}
                </Text>
              </Pressable>
            ) : null}
          </View>
          <View ref={tourBalanceRef} collapsable={false}>
            <LinearGradient
              colors={[colors.wash, colors.tint, colors.greenPressed]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ borderRadius: 24, padding: 22, gap: 16, overflow: "hidden" }}
            >
              {/* The kit's line pattern: two thin rings bleeding off the card. */}
              <View
                pointerEvents="none"
                style={{
                  position: "absolute",
                  width: 280,
                  height: 280,
                  borderRadius: 140,
                  borderWidth: 1,
                  borderColor: "#ffffff1f",
                  right: -110,
                  top: -150,
                }}
              />
              <View
                pointerEvents="none"
                style={{
                  position: "absolute",
                  width: 220,
                  height: 220,
                  borderRadius: 110,
                  borderWidth: 1,
                  borderColor: "#ffffff19",
                  left: -90,
                  bottom: -150,
                }}
              />
              <View style={{ alignItems: "center" }}>
                <Text style={[s.small, { color: colors.ink, opacity: 0.7 }]}>
                  {t("Total balance", "资产总值")}
                </Text>
                <Text
                  style={{
                    color: colors.ink,
                    fontSize: 38,
                    lineHeight: 46,
                    fontWeight: "700",
                    letterSpacing: -1,
                  }}
                >
                  {valueCore.format(valuation.total)}
                </Text>
                {valuation.coverage !== valueCore.COMPLETE ? (
                  <Text
                    style={[s.small, { color: colors.ink, opacity: 0.75, textAlign: "center" }]}
                  >
                    {valuation.coverage === valueCore.PARTIAL
                      ? t(
                          `Subtotal — no price for ${valuation.unpriced.map((entry) => entry.symbol).join(", ")}`,
                          `小计 — 缺少价格：${valuation.unpriced.map((entry) => entry.symbol).join("、")}`,
                        )
                      : t("No prices could be read.", "无法读取价格。")}
                  </Text>
                ) : null}
              </View>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  backgroundColor: "#00000026",
                  borderRadius: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 9,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Icon name="gas-station" size={15} color={colors.ink} />
                  <Text style={[s.small, { color: colors.ink }]}>{t("Gas", "燃料费")}</Text>
                </View>
                <Text style={{ color: colors.ink, fontWeight: "700" }}>
                  {balance
                    ? `${shortAmount(formatUnits(BigInt(balance.ETH || "0"), 18))} ETH`
                    : "…"}
                </Text>
              </View>
            </LinearGradient>
          </View>
          <View ref={tourActionsRef} collapsable={false} style={s.quickActions}>
            {[
              ["arrow-top-right", "Send", "发送", "send"],
              ["arrow-down", "Receive", "收款", "receive"],
              ["swap-horizontal", "Swap", "兑换", "swap"],
              ["dots-horizontal", "More", "更多", "more"],
            ].map(([icon, en, zh, p]) => (
              <Pressable
                key={p}
                accessibilityRole="button"
                style={({ pressed }) => [s.quickAction, { opacity: pressed ? 0.6 : 1 }]}
                onPress={() => (p === "more" ? setSheetOpen(true) : openFlow(p))}
              >
                <View style={s.quickIcon}>
                  <Icon name={icon} color={colors.lime} size={24} />
                </View>
                <Text style={[s.small, { color: colors.ink }]}>{t(en, zh)}</Text>
              </Pressable>
            ))}
          </View>
          <View ref={tourAssetsRef} collapsable={false} style={{ gap: 10 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setPage("tokens")}
                style={{ flexDirection: "row", alignItems: "center", gap: 2 }}
              >
                <Text style={[s.text, { fontWeight: "700" }]}>{t("Assets", "资产")}</Text>
                <Icon name="chevron-right" size={16} color={colors.muted} />
              </Pressable>
            </View>
            {!balance ? (
              <View style={[s.panel, { alignItems: "center" }]}>
                <TeraSpinner size={26} />
              </View>
            ) : held.length ? (
              <View style={[s.panel, { paddingVertical: 4, gap: 0 }]}>
                {held.map(({ asset, amount }, i) => assetRow(asset, amount, i === 0))}
              </View>
            ) : (
              <View style={[s.panel, { alignItems: "center", paddingVertical: 22 }]}>
                <Text style={s.small}>
                  {t("No balances on this wallet yet.", "此钱包暂无余额。")}
                </Text>
                <Pressable accessibilityRole="button" onPress={() => openFlow("receive")}>
                  <Text style={[s.small, { color: colors.green, fontWeight: "600" }]}>
                    {t("Receive assets", "接收资产")}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={[s.text, { fontWeight: "700" }]}>
                {t("Recent activity", "最近记录")}
              </Text>
              {data.history.length ? (
                <Pressable accessibilityRole="button" onPress={() => setPage("activity")}>
                  <Text style={[s.small, { color: colors.green, fontWeight: "600" }]}>
                    {t("View all", "查看全部")}
                  </Text>
                </Pressable>
              ) : null}
            </View>
            {data.history.length ? (
              data.history.slice(0, 3).map((r) => {
                const isBridge = Boolean(
                  r.bridgeInput ||
                  (r.reference && /^0x[\da-f]{64}$/i.test(r.reference)) ||
                  r.isPrivateBridge,
                );
                const isSend = !isBridge && !!r.recipient;
                return (
                  <Pressable
                    key={r.hash}
                    accessibilityRole="button"
                    onPress={() => setPage("activity")}
                    style={[s.panel, { flexDirection: "row", alignItems: "center", gap: 12 }]}
                  >
                    <View style={s.iconDisc}>
                      {isSend ? (
                        <Icon name="arrow-top-right" size={20} color={colors.ink} />
                      ) : (
                        <Icon
                          name={isBridge ? "bridge" : "swap-vertical"}
                          size={20}
                          color={colors.ink}
                        />
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.label} numberOfLines={1}>
                        {r.title}
                      </Text>
                      <Text style={s.small}>
                        {t("Step", "步骤")} {r.step}/{r.totalSteps}
                      </Text>
                    </View>
                    <View
                      style={{
                        borderRadius: 999,
                        paddingHorizontal: 10,
                        paddingVertical: 4,
                        backgroundColor:
                          r.status === "confirmed"
                            ? colors.tint
                            : r.status === "failed" || r.status === "reverted"
                              ? colors.dangerTint
                              : colors.warnTint,
                      }}
                    >
                      <Text
                        style={[
                          s.small,
                          {
                            fontWeight: "600",
                            color:
                              r.status === "confirmed"
                                ? colors.green
                                : r.status === "failed" || r.status === "reverted"
                                  ? colors.danger
                                  : colors.yellow,
                          },
                        ]}
                      >
                        {r.status}
                      </Text>
                    </View>
                  </Pressable>
                );
              })
            ) : (
              <View style={[s.panel, { alignItems: "center", paddingVertical: 22 }]}>
                <Text style={s.small}>
                  {t("Your signed transactions will appear here.", "已签名的交易将显示在这里。")}
                </Text>
              </View>
            )}
          </View>
        </>
      );
    if (page === "tag") {
      return (
        <>
          <Header
            title={t("Your tag", "您的标签")}
            onBack={() => setPage("home")}
            backLabel={t("Back", "返回")}
          />
          <View style={[s.panel, { alignItems: "center", paddingVertical: 22 }]}>
            <Icon name="at" size={30} color={colors.green} />
            <Text style={[s.text, { fontSize: 20, fontWeight: "700" }]}>
              {myTag ? tags.display(myTag) : t("Not claimed yet", "尚未领取")}
            </Text>
          </View>
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
        </>
      );
    }
    if (page === "receive")
      return (
        <>
          <Header
            title={t("Receive", "收款")}
            onBack={() => setPage("home")}
            backLabel={t("Back", "返回")}
          />
          <Text style={[s.small, { textAlign: "center" }]}>
            {t(
              "Send assets on Robinhood Chain to this address.",
              "请通过 Robinhood Chain 向此地址发送资产。",
            )}
          </Text>
          <View style={{ borderRadius: 24, overflow: "hidden" }}>
            <View
              style={{
                backgroundColor: colors.green,
                alignItems: "center",
                paddingVertical: 28,
                overflow: "hidden",
              }}
            >
              <View
                pointerEvents="none"
                style={{
                  position: "absolute",
                  width: 260,
                  height: 260,
                  borderRadius: 130,
                  borderWidth: 1,
                  borderColor: "#ffffff40",
                  right: -120,
                  top: -120,
                }}
              />
              {/* White behind the code whatever the theme: a scanner needs the contrast. */}
              <View style={{ backgroundColor: "#ffffff", padding: 14, borderRadius: 18 }}>
                <Image
                  accessibilityLabel={t("Wallet address QR code", "钱包地址二维码")}
                  source={{
                    uri: `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(owner)}`,
                  }}
                  style={{ width: 200, height: 200 }}
                />
              </View>
            </View>
            <View
              style={{ backgroundColor: colors.tint, padding: 18, alignItems: "center", gap: 6 }}
            >
              <Text style={[s.text, { fontWeight: "700" }]}>
                {tagsAvailable() && myTag
                  ? tags.display(myTag)
                  : walletName(accounts.find((entry) => entry.active) || { index: 0, name: "" })}
              </Text>
              <Text selectable style={[s.mono, { textAlign: "center", color: colors.muted }]}>
                {owner}
              </Text>
            </View>
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
          <Header
            title={t("Private route", "私密路由")}
            onBack={() => setPage("home")}
            backLabel={t("Back", "返回")}
          />
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
                  privateAsset === a && {
                    borderWidth: 2,
                    borderColor: colors.green,
                    backgroundColor: colors.tint,
                  },
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
          <Header
            title={t("Send", "发送")}
            onBack={() => (flowStep > 0 ? setFlowStep((step) => step - 1) : setPage("home"))}
            backLabel={t("Back", "返回")}
          />
          <Steps count={5} current={flowStep} label={stepTitle} />
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
                    backgroundColor: sendMode === "public" ? colors.tint : colors.wash,
                    overflow: "hidden",
                    position: "relative",
                    justifyContent: "center",
                  },
                ]}
              >
                <Icon
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
                    <Icon name="check-circle" size={22} color={colors.green} />
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
                    backgroundColor: sendMode === "private" ? colors.tint : colors.wash,
                    overflow: "hidden",
                    position: "relative",
                    justifyContent: "center",
                  },
                ]}
              >
                <Icon
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
                    <Icon name="check-circle" size={22} color={colors.green} />
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
                    assetSymbol === asset.symbol && {
                      borderWidth: 2,
                      borderColor: colors.green,
                      backgroundColor: colors.tint,
                    },
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
                placeholderTextColor={colors.faint}
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
              {recipientKind === "address" && recipientPicks()}
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
                  isPrivate ? t("Private Route", "私密路由") : t("Public (Direct)", "公开（直接）")
                }
              />
              <Row label={t("Asset", "资产")} value={selectedAsset.symbol} />
              <Row label={t("Amount", "金额")} value={`${amount || "0"} ${selectedAsset.symbol}`} />
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
        </>
      );
    }
    if (page === "swap") {
      // The backend only ever trades a non-stable asset against USDG
      // (prepareTrade's actionType is BUY or SELL of `selectedAsset`, not a
      // free choice of two arbitrary assets) — so "which side is USDG"
      // is what the direction toggle actually flips, not an open pair
      // picker. USDG is the fixed side; assetSymbol is the one the picker
      // below can change.
      const paySymbol = trade === "BUY" ? "USDG" : assetSymbol;
      const receiveSymbol = trade === "BUY" ? assetSymbol : "USDG";
      const payAsset = assets.find((a) => a.symbol === paySymbol) || sources[0];
      const receiveAsset = assets.find((a) => a.symbol === receiveSymbol) || sources[0];
      const payBalance = balance
        ? formatUnits(BigInt(balance[paySymbol] || "0"), payAsset.decimals)
        : null;
      const estimated =
        Number(amount) > 0 && prices[paySymbol] && prices[receiveSymbol]
          ? String((Number(amount) * prices[paySymbol]) / prices[receiveSymbol])
          : null;
      const swapChip = (symbol: string, onPress?: () => void) => (
        <Pressable
          disabled={!onPress}
          onPress={onPress}
          style={{
            flexDirection: "row",
            gap: 8,
            alignItems: "center",
            paddingVertical: 7,
            paddingHorizontal: 10,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: onPress ? colors.green : colors.line,
            backgroundColor: onPress ? colors.tint : colors.raised,
          }}
        >
          <TokenIcon symbol={symbol} size={24} />
          <Text style={[s.text, { fontWeight: "700" }]}>{symbol}</Text>
          {onPress && <Icon name="chevron-down" size={18} color={colors.muted} />}
        </Pressable>
      );
      return (
        <>
          <Header
            title={t("Swap", "兑换")}
            onBack={() => setPage("home")}
            backLabel={t("Back", "返回")}
          />
          <Text style={[s.small, { textAlign: "center" }]}>
            {t("Choose tokens, then review the live route.", "选择代币，然后审核实时路线。")}
          </Text>
          <View style={s.panel}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={s.eyebrow}>{t("YOU PAY", "你支付")}</Text>
              {payBalance && (
                <Pressable onPress={() => setAmount(payBalance)}>
                  <Text style={s.small}>
                    {t("Balance", "余额")}: {shortAmount(payBalance)}
                  </Text>
                </Pressable>
              )}
            </View>
            <View style={s.wrap}>
              {swapChip(paySymbol, trade === "SELL" ? () => setSwapReceivePicker(true) : undefined)}
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("Swap pay and receive", "交换支付与接收方向")}
            onPress={() => setTrade((current) => (current === "BUY" ? "SELL" : "BUY"))}
            style={({ pressed }) => ({
              alignSelf: "center",
              width: 44,
              height: 44,
              borderRadius: 22,
              marginVertical: -26,
              zIndex: 1,
              backgroundColor: colors.green,
              borderWidth: 4,
              borderColor: colors.paper,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.8 : 1,
              transform: [{ scale: pressed ? 0.94 : 1 }],
            })}
          >
            <Icon name="swap-vertical" color={colors.paper} size={22} />
          </Pressable>
          <View style={s.panel}>
            <Text style={s.eyebrow}>{t("YOU RECEIVE", "你收到")}</Text>
            <View style={s.wrap}>
              {swapChip(
                receiveSymbol,
                trade === "BUY" ? () => setSwapReceivePicker(true) : undefined,
              )}
            </View>
            {estimated && (
              <Text style={[s.small, { paddingTop: 4 }]}>
                {"≈"} {shortAmount(estimated)} {receiveSymbol}
              </Text>
            )}
          </View>
          {action("Review live route", "审核实时路线", prepareTrade)}
        </>
      );
    }
    if (page === "bridge") {
      const isPrivate = bridgeMode === "private";
      const bridgeStepTitle = [
        t("Select route", "选择路由"),
        t("Choose destination", "选择目标"),
        t("Enter amount", "输入金额"),
        t("Destination address", "目标地址"),
        t("Review bridge", "审核跨链"),
      ][bridgeStep];
      const bridgeSourceAssets = sources;
      const selectedSource = sources.find((s) => s.symbol === assetSymbol) || sources[0];

      return (
        <>
          <Header
            title={t("Bridge", "跨链")}
            onBack={() => (bridgeStep > 0 ? setBridgeStep((step) => step - 1) : setPage("home"))}
            backLabel={t("Back", "返回")}
          />
          <Steps count={5} current={bridgeStep} label={bridgeStepTitle} />

          {bridgeStep === 0 && (
            <View style={{ gap: 14 }}>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setBridgeMode("public");
                }}
                style={[
                  s.panel,
                  {
                    paddingVertical: 26,
                    paddingHorizontal: 20,
                    borderRadius: 22,
                    borderWidth: bridgeMode === "public" ? 2 : 1,
                    borderColor: bridgeMode === "public" ? colors.green : colors.line,
                    backgroundColor: bridgeMode === "public" ? colors.tint : colors.wash,
                    overflow: "hidden",
                    position: "relative",
                    justifyContent: "center",
                  },
                ]}
              >
                <Icon
                  name="earth"
                  size={96}
                  color={bridgeMode === "public" ? colors.green : colors.ink}
                  style={{
                    position: "absolute",
                    right: -16,
                    bottom: -22,
                    opacity: bridgeMode === "public" ? 0.12 : 0.05,
                  }}
                />
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <View style={{ gap: 4 }}>
                    <Text style={{ fontSize: 20, fontWeight: "800", color: colors.ink }}>
                      {t("Public Bridge", "公开跨链")}
                    </Text>
                    <Text style={[s.small, { color: colors.muted }]}>
                      {t("Direct cross-chain bridge via Relay", "通过 Relay 直接跨链")}
                    </Text>
                  </View>
                  {bridgeMode === "public" && (
                    <Icon name="check-circle" size={22} color={colors.green} />
                  )}
                </View>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setBridgeMode("private");
                  if (assetSymbol !== "ETH" && assetSymbol !== "USDG") {
                    setAssetSymbol("USDG");
                  }
                }}
                style={[
                  s.panel,
                  {
                    paddingVertical: 26,
                    paddingHorizontal: 20,
                    borderRadius: 22,
                    borderWidth: bridgeMode === "private" ? 2 : 1,
                    borderColor: bridgeMode === "private" ? colors.green : colors.line,
                    backgroundColor: bridgeMode === "private" ? colors.tint : colors.wash,
                    overflow: "hidden",
                    position: "relative",
                    justifyContent: "center",
                  },
                ]}
              >
                <Icon
                  name="shield"
                  size={96}
                  color={bridgeMode === "private" ? colors.green : colors.ink}
                  style={{
                    position: "absolute",
                    right: -16,
                    bottom: -22,
                    opacity: bridgeMode === "private" ? 0.12 : 0.05,
                  }}
                />
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <View style={{ gap: 4 }}>
                    <Text style={{ fontSize: 20, fontWeight: "800", color: colors.ink }}>
                      {t("Private Bridge", "私密跨链")}
                    </Text>
                    <Text style={[s.small, { color: colors.muted }]}>
                      {t("Sever link via Tera's bridge vault", "通过 Tera 跨链金库切断链上关联")}
                    </Text>
                  </View>
                  {bridgeMode === "private" && (
                    <Icon name="check-circle" size={22} color={colors.green} />
                  )}
                </View>
              </Pressable>
            </View>
          )}

          {bridgeStep === 1 && (
            <View style={{ gap: 18 }}>
              <View style={s.panel}>
                <Text style={s.eyebrow}>{t("DESTINATION NETWORK", "目标网络")}</Text>
                <View style={{ gap: 10, marginTop: 10 }}>
                  {destinations.map((d) => {
                    const isSelected = dest.id === d.id;
                    return (
                      <Pressable
                        key={d.id}
                        accessibilityRole="button"
                        onPress={() => {
                          setDestination(d.id);
                          setOutSymbol(d.tokens[0].symbol);
                        }}
                        style={[
                          {
                            flexDirection: "row",
                            alignItems: "center",
                            padding: 14,
                            borderRadius: 14,
                            borderWidth: isSelected ? 2 : 1,
                            borderColor: isSelected ? colors.green : colors.line,
                            backgroundColor: isSelected ? colors.tint : colors.wash,
                            gap: 12,
                          },
                        ]}
                      >
                        <ChainIcon name={d.name} size={36} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.ink }}>
                            {d.name}
                          </Text>
                          <Text style={s.small}>{d.tokens.map((t) => t.symbol).join(" · ")}</Text>
                        </View>
                        {isSelected && <Icon name="check-circle" size={20} color={colors.green} />}
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={s.panel}>
                <Text style={s.eyebrow}>{t("RECEIVING TOKEN", "接收代币")}</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
                  {dest.tokens.map((token) => {
                    const isSelected = output.symbol === token.symbol;
                    return (
                      <Pressable
                        key={token.symbol}
                        accessibilityRole="button"
                        onPress={() => setOutSymbol(token.symbol)}
                        style={[
                          {
                            flexDirection: "row",
                            alignItems: "center",
                            paddingVertical: 10,
                            paddingHorizontal: 14,
                            borderRadius: 12,
                            borderWidth: isSelected ? 2 : 1,
                            borderColor: isSelected ? colors.green : colors.line,
                            backgroundColor: isSelected ? colors.tint : colors.wash,
                            gap: 8,
                          },
                        ]}
                      >
                        <TokenIcon symbol={token.symbol} size={28} />
                        <Text
                          style={[s.text, isSelected && { fontWeight: "800", color: colors.green }]}
                        >
                          {token.symbol}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </View>
          )}

          {bridgeStep === 2 && (
            <View style={{ gap: 16 }}>
              <View style={s.panel}>
                <Text style={s.eyebrow}>
                  {t("PAY FROM ROBINHOOD CHAIN", "支付源（ROBINHOOD CHAIN）")}
                </Text>
                <View style={s.wrap}>
                  {bridgeSourceAssets.map((asset) => (
                    <Pressable
                      key={asset.symbol}
                      onPress={() => setAssetSymbol(asset.symbol)}
                      style={[
                        {
                          flexDirection: "row",
                          alignItems: "center",
                          paddingVertical: 8,
                          paddingHorizontal: 12,
                          borderRadius: 12,
                          borderWidth: assetSymbol === asset.symbol ? 2 : 1,
                          borderColor: assetSymbol === asset.symbol ? colors.green : colors.line,
                          backgroundColor: assetSymbol === asset.symbol ? colors.tint : colors.wash,
                          gap: 8,
                        },
                      ]}
                    >
                      <TokenIcon symbol={asset.symbol} size={28} />
                      <Text style={[s.text, assetSymbol === asset.symbol && { fontWeight: "800" }]}>
                        {asset.symbol}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={{ alignItems: "center", gap: 14, paddingVertical: 32 }}>
                <TokenIcon symbol={selectedSource.symbol} size={52} />
                <TextInput
                  autoFocus
                  value={amount}
                  onChangeText={(value) => {
                    setAmount(value);
                    setAmountInvalid(false);
                  }}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={colors.faint}
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
                        balance?.[selectedSource.symbol]
                          ? formatUnits(
                              BigInt(balance[selectedSource.symbol]),
                              selectedSource.decimals,
                            )
                          : "0"
                      } ${selectedSource.symbol}`}
                </Text>
              </View>
            </View>
          )}

          {bridgeStep === 3 && (
            <View style={{ gap: 12 }}>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4 }}
              >
                <ChainIcon name={dest.name} size={28} />
                <Text style={{ fontSize: 16, fontWeight: "700", color: colors.ink }}>
                  {t(`${dest.name} recipient`, `${dest.name} 收款地址`)}
                </Text>
              </View>
              <Field
                label={
                  dest.id === 792703809
                    ? t("Solana wallet address", "Solana 钱包地址")
                    : t(`${dest.name} wallet address (0x…)`, `${dest.name} 钱包地址 (0x…)`)
                }
                value={recipient}
                placeholder={dest.id === 792703809 ? "e.g. EPjF… (Base58 32-byte)" : "0x…"}
                onChangeText={setRecipient}
              />
              <Text style={s.small}>
                {dest.id === 792703809
                  ? t(
                      "Enter the destination Solana wallet address that will receive the tokens.",
                      "请输入接收代币的目标 Solana 钱包地址。",
                    )
                  : t(
                      `Enter the destination ${dest.name} EVM address that will receive the tokens.`,
                      `请输入接收代币的目标 ${dest.name} EVM 地址。`,
                    )}
              </Text>
              {isPrivate && (
                <View style={[s.panel, { backgroundColor: colors.tint, marginTop: 8 }]}>
                  <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                    <Icon name="shield-check" size={20} color={colors.green} />
                    <Text style={{ fontWeight: "700", color: colors.green }}>
                      {t("Private bridge routing", "私密跨链路由")}
                    </Text>
                  </View>
                  <Text style={[s.small, { marginTop: 4 }]}>
                    {t(
                      "Your Robinhood Chain address will NOT be visible on the destination chain or to Relay.",
                      "你的 Robinhood Chain 地址不会在目标链或 Relay 上暴露。",
                    )}
                  </Text>
                </View>
              )}
            </View>
          )}

          {bridgeStep === 4 && (
            <View style={s.panel}>
              <Row
                label={t("Route", "路由方式")}
                value={isPrivate ? t("Private Bridge", "私密跨链") : t("Public Bridge", "公开跨链")}
              />
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingVertical: 10,
                  borderBottomWidth: 1,
                  borderColor: colors.line,
                }}
              >
                <Text style={s.small}>{t("Destination", "目标网络")}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <ChainIcon name={dest.name} size={20} />
                  <Text style={[s.small, { fontWeight: "700", color: colors.ink }]}>
                    {dest.name}
                  </Text>
                </View>
              </View>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingVertical: 10,
                  borderBottomWidth: 1,
                  borderColor: colors.line,
                }}
              >
                <Text style={s.small}>{t("Receiving Token", "接收代币")}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <TokenIcon symbol={output.symbol} size={20} />
                  <Text style={[s.small, { fontWeight: "700", color: colors.ink }]}>
                    {output.symbol}
                  </Text>
                </View>
              </View>
              <Row
                label={t("Pay amount", "支付金额")}
                value={`${amount || "0"} ${selectedSource.symbol}`}
              />
              <Row label={t("Recipient", "收款地址")} value={recipient || "—"} />
              {isPrivate && (
                <>
                  <Row
                    label={t("Routing", "路由路径")}
                    value={t("Bridge Vault → Relay → Recipient", "跨链金库 → Relay → 收款方")}
                  />
                  <Text style={[s.small, { marginTop: 10, lineHeight: 18 }]}>
                    {t(
                      "Private routing severs the direct on-chain link between your Robinhood Chain address and the destination recipient. Funds route through Tera's bridge vault.",
                      "私密路由切断你 Robinhood Chain 地址与目标链收款方之间的直接关联。资金将通过 Tera 跨链金库路由。",
                    )}
                  </Text>
                </>
              )}
            </View>
          )}

          {bridgeStep < 4 ? (
            <Button primary onPress={continueBridge}>
              {t("Continue", "继续")}
            </Button>
          ) : isPrivate ? (
            action("Review private bridge", "审核私密跨链", preparePrivateBridge)
          ) : (
            action("Review live route", "审核实时路线", prepareBridge)
          )}
        </>
      );
    }
    if (page === "leaderboard") {
      const myTagHandle = myTag || "@tera_owner";
      // TODO(leaderboard): these figures are placeholders. They must come from
      // /api/leaderboard before this screen is shown to anyone, because a rank
      // the app made up and labelled as the owner's is a false statement about
      // them, not a placeholder.
      const standing = {
        rank: 1,
        tier: "Grandmaster",
        points: "3,450",
        intents: "142",
        referrals: "38",
      };
      const board = [
        { rank: 1, tag: "@astra", pts: "3,450", badge: "Grandmaster" },
        { rank: 2, tag: "@robin_god", pts: "2,890", badge: "Grandmaster" },
        { rank: 3, tag: "@orbit_whale", pts: "2,150", badge: "Master" },
        { rank: 4, tag: "@cyber_rwa", pts: "1,780", badge: "Master" },
        { rank: 5, tag: "@nexus_alpha", pts: "1,240", badge: "Senior" },
        { rank: 6, tag: "@tera_guard", pts: "980", badge: "Senior" },
      ];
      return (
        <>
          <Header
            title={t("Supervisor ranks", "监督者榜单")}
            onBack={() => setPage("home")}
            backLabel={t("Back", "返回")}
          />
          <Text style={[s.small, { textAlign: "center" }]}>
            {t(
              "Points are earned by reviewing an agent's proposal and signing it yourself.",
              "通过审核代理提议并亲自签名来赚取积分。",
            )}
          </Text>

          <LinearGradient
            colors={[colors.wash, colors.tint, colors.greenPressed]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ borderRadius: 24, padding: 20, gap: 14, overflow: "hidden" }}
          >
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                width: 280,
                height: 280,
                borderRadius: 140,
                borderWidth: 1,
                borderColor: "#ffffff1f",
                right: -110,
                top: -150,
              }}
            />
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                width: 220,
                height: 220,
                borderRadius: 110,
                borderWidth: 1,
                borderColor: "#ffffff19",
                left: -90,
                bottom: -150,
              }}
            />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 28,
                  backgroundColor: "#ffffff14",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon name="trophy" size={28} color={colors.ink} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.small, { color: colors.ink, opacity: 0.7 }]}>
                  {t("Your standing", "你的排名")}
                </Text>
                <Text style={{ color: colors.ink, fontSize: 32, fontWeight: "800" }}>
                  #{standing.rank}
                </Text>
                <Text style={[s.small, { color: colors.ink }]}>
                  {myTagHandle} · {t(`${standing.tier} supervisor`, `${standing.tier} 监督者`)}
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {[
                [t("Points", "积分"), standing.points],
                [t("Intents signed", "已签名意图"), standing.intents],
                [t("Referrals", "推荐人数"), standing.referrals],
              ].map(([label, value]) => (
                <View
                  key={label}
                  style={{
                    flex: 1,
                    backgroundColor: "#00000026",
                    borderRadius: 12,
                    padding: 10,
                    alignItems: "center",
                  }}
                >
                  <Text style={{ color: colors.ink, fontWeight: "700", fontSize: 16 }}>
                    {value}
                  </Text>
                  <Text style={[s.small, { color: colors.ink, opacity: 0.75, fontSize: 11 }]}>
                    {label}
                  </Text>
                </View>
              ))}
            </View>
          </LinearGradient>

          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                const text =
                  `Ranked #${standing.rank} supervising agent actions on Tera.

` +
                  `${standing.points} supervisor points · ${standing.intents} intents reviewed and signed by me, not for me.

` +
                  `https://terawallet.app/dashboard/?ref=${encodeURIComponent(myTagHandle)}`;
                void Linking.openURL(`https://x.com/intent/tweet?text=${encodeURIComponent(text)}`);
              }}
              style={({ pressed }) => [
                s.panel,
                {
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Icon name="share-2" size={16} color={colors.green} />
              <Text style={[s.label, { color: colors.green }]}>{t("Share on X", "分享到 X")}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={async () => {
                await Clipboard.setStringAsync(
                  `https://terawallet.app/dashboard/?ref=${encodeURIComponent(myTagHandle)}`,
                );
                setNotice({
                  title: t("Referral link copied", "推荐链接已复制"),
                  body: t(
                    "The link carries your tag and nothing else. It cannot act on your behalf.",
                    "该链接仅包含你的标签，不能代表你行事。",
                  ),
                  tone: "success",
                });
              }}
              style={({ pressed }) => [
                s.panel,
                {
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Icon name="link-2" size={16} color={colors.green} />
              <Text style={[s.label, { color: colors.green }]}>{t("Copy link", "复制链接")}</Text>
            </Pressable>
          </View>

          <Group title={t("Ranked supervisors", "监督者排行")}>
            {board.map((item) => (
              <View
                key={item.tag}
                style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 }}
              >
                <Image
                  accessibilityLabel={item.tag}
                  source={{
                    uri: `https://api.dicebear.com/9.x/thumbs/png?seed=${encodeURIComponent(item.tag)}&size=76`,
                  }}
                  style={[
                    { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.raised },
                    item.rank <= 3 && {
                      borderWidth: 2,
                      borderColor: item.rank === 1 ? colors.yellow : colors.green,
                    },
                  ]}
                />
                <View style={{ flex: 1 }}>
                  <Text style={s.label}>{item.tag}</Text>
                  <Text style={s.small}>{item.badge}</Text>
                </View>
                <Text style={[s.label, { color: colors.green }]}>
                  {t(`${item.pts} pts`, `${item.pts} 分`)}
                </Text>
              </View>
            ))}
          </Group>
        </>
      );
    }
    if (page === "activity")
      return (
        <>
          <Header title={t("Activity", "记录")} />
          <Text style={[s.small, { textAlign: "center" }]}>
            {t(
              "Source confirmation and destination delivery are tracked separately.",
              "源链确认与目标链到账分别跟踪。",
            )}
          </Text>
          {!combinedHistory.length && (
            <View style={[s.panel, { alignItems: "center", paddingVertical: 28, gap: 8 }]}>
              <Icon name="history" size={32} color={colors.faint} />
              <Text style={s.small}>
                {t("Your signed transactions will appear here.", "已签名的交易将显示在这里。")}
              </Text>
            </View>
          )}
          {combinedHistory.map((r) => {
            const isBridge = Boolean(
              r.bridgeInput ||
              (r.reference && /^0x[\da-f]{64}$/i.test(r.reference)) ||
              r.isPrivateBridge,
            );
            const isSend =
              !isBridge &&
              (!!r.recipient || r.title.startsWith("Sent") || r.title.startsWith("发送"));
            return (
              <Pressable
                key={r.hash}
                accessibilityRole="button"
                onPress={() => {
                  setActivityDetail(r.hash);
                  setPage("activity-detail");
                }}
                style={({ pressed }) => [
                  s.panel,
                  {
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <View style={s.iconDisc}>
                  {isSend ? (
                    <Icon name="arrow-top-right" size={20} color={colors.ink} />
                  ) : (
                    <Icon
                      name={isBridge ? "bridge" : "swap-vertical"}
                      size={20}
                      color={colors.ink}
                    />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.label}>{r.title}</Text>
                  <Text style={s.small}>
                    {t("Step", "步骤")} {r.step}/{r.totalSteps}
                  </Text>
                </View>
                <View
                  style={{
                    borderRadius: 999,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    backgroundColor:
                      r.status === "confirmed"
                        ? colors.tint
                        : r.status === "failed" || r.status === "reverted"
                          ? colors.dangerTint
                          : colors.warnTint,
                  }}
                >
                  <Text
                    style={[
                      s.small,
                      {
                        fontWeight: "600",
                        color:
                          r.status === "confirmed"
                            ? colors.green
                            : r.status === "failed" || r.status === "reverted"
                              ? colors.danger
                              : colors.yellow,
                      },
                    ]}
                  >
                    {r.status}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </>
      );
    if (page === "activity-detail") {
      const r = combinedHistory.find((h) => h.hash === activityDetail);
      if (!r) return null;
      const isBridge = Boolean(
        r.bridgeInput || (r.reference && /^0x[\da-f]{64}$/i.test(r.reference)) || r.isPrivateBridge,
      );
      return (
        <>
          <Header
            title={r.title}
            onBack={() => setPage("activity")}
            backLabel={t("Activity", "记录")}
          />
          {r.payee ? (
            <View style={[s.panel, { gap: 10 }]}>
              <Text selectable style={s.small}>
                {t("To", "发送至")}:{" "}
                {contactsCore.nameFor(book, r.payee)
                  ? `${contactsCore.nameFor(book, r.payee)} · `
                  : ""}
                {r.payee}
              </Text>
              <Button onPress={() => openContact(r.payee)}>
                {contactsCore.nameFor(book, r.payee)
                  ? t("Rename address", "重命名地址")
                  : t("Save to contacts", "保存到联系人")}
              </Button>
            </View>
          ) : null}
          <View style={[s.panel, { gap: 10 }]}>
            <Text style={s.eyebrow}>{t("Transaction hash", "交易哈希")}</Text>
            <Text selectable style={[s.mono, { fontSize: 12, color: colors.muted }]}>
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
          </View>
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
                  h.hash === r.hash ? { ...h, status: sourceStatus, delivery, payoutHash } : h,
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
        </>
      );
    }
    const toSettings = () => setSettingsSection("root");
    if (settingsSection === "root") {
      const active = accounts.find((entry) => entry.active) || { index: 0, name: "" };
      return (
        <>
          <Header
            title={t("Settings", "设置")}
            onBack={() => setPage("home")}
            backLabel={t("Wallet", "钱包")}
          />
          <View style={[s.panel, { flexDirection: "row", alignItems: "center", gap: 14 }]}>
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 28,
                backgroundColor: colors.tint,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name="wallet-outline" size={26} color={colors.green} />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[s.text, { fontSize: 18, fontWeight: "700" }]} numberOfLines={1}>
                {walletName(active)}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("Copy address", "复制地址")}
                onPress={() =>
                  void Clipboard.setStringAsync(owner).then(() =>
                    setNotice({
                      title: t("Address copied", "地址已复制"),
                      body: t(
                        "Your Robinhood Chain wallet address is ready to paste.",
                        "你的 Robinhood Chain 钱包地址已可粘贴。",
                      ),
                      tone: "success",
                    }),
                  )
                }
                style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
              >
                <Text style={[s.mono, { color: colors.muted }]}>{short(owner)}</Text>
                <Icon name="content-copy" size={14} color={colors.muted} />
              </Pressable>
              {tagsAvailable() ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setPage("tag")}
                  style={{
                    alignSelf: "flex-start",
                    backgroundColor: myTag ? colors.tint : colors.raised,
                    borderRadius: 999,
                    paddingHorizontal: 10,
                    paddingVertical: 3,
                  }}
                >
                  <Text style={[s.small, { color: colors.green, fontWeight: "600" }]}>
                    {myTag ? tags.display(myTag) : t("Claim a tag", "领取标签")}
                  </Text>
                </Pressable>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("Edit wallets", "编辑钱包")}
              onPress={() => setSettingsSection("accounts")}
              hitSlop={8}
              style={s.iconDisc}
            >
              <Icon name="pencil-outline" size={18} color={colors.ink} />
            </Pressable>
          </View>
          <Group title={t("Account details", "账户详情")}>
            <ListRow
              icon="wallet-bifold-outline"
              label={t("Wallets", "钱包")}
              detail={t("Add, name and switch between wallets", "新增、命名和切换钱包")}
              onPress={() => setSettingsSection("accounts")}
            />
            <ListRow
              icon="account-multiple-outline"
              label={t("Contacts", "联系人")}
              detail={t("Names for the addresses you send to", "为常用地址添加名称")}
              onPress={() => setSettingsSection("contacts")}
            />
            <ListRow
              icon="shield-lock-outline"
              label={t("Security", "安全")}
              detail={t("Recovery phrase, biometrics and lock", "助记词、生物识别与锁定")}
              onPress={() => setSettingsSection("security")}
            />
            <ListRow
              icon="eye-off-outline"
              label={t("Privacy & data", "隐私与数据")}
              detail={t("Retention and deletion controls", "保留与删除设置")}
              onPress={() => setSettingsSection("privacy")}
            />
            {upd.installedChannel() !== "production" ? (
              <ListRow
                icon="robot-outline"
                label={t("Agent sessions", "代理会话")}
                detail={t(
                  "Connect, create and revoke scoped tokens",
                  "连接、创建和撤销限定权限令牌",
                )}
                onPress={() => setSettingsSection("sessions")}
              />
            ) : null}
            <ListRow
              icon="cellphone-key"
              label={t("Wallet on this device", "本设备钱包")}
              detail={t("Address and device controls", "地址与设备管理")}
              onPress={() => setSettingsSection("device")}
            />
          </Group>
          <Group title={t("Preferences", "偏好设置")}>
            <ListRow
              icon="translate"
              label={t("Language", "语言")}
              onPress={toggleLanguage}
              right={
                <Text style={[s.small, { color: colors.green, fontWeight: "600" }]}>
                  {language === "en" ? "English" : "中文"}
                </Text>
              }
            />
            <ListRow
              icon="compass"
              label={t("Replay app tour", "重新查看引导")}
              onPress={startTour}
            />
            {/*
              The app is dark-mode only for now — toggleTheme/setColorTheme
              still work underneath, so this just needs uncommenting (and a
              real icon name; "weather-night"/"white-balance-sunny" are
              stale Material Community names from before the Lucide switch)
              if light mode comes back.
            */}
            {/* <ListRow
              icon="sun"
              label={t("Dark mode", "深色模式")}
              onPress={toggleTheme}
              right={<Toggle on={theme === "dark"} />}
            /> */}
            {tagsAvailable() ? (
              <ListRow
                icon="at"
                label={t("Your tag", "你的标签")}
                detail={myTag ? tags.display(myTag) : t("Not claimed yet", "尚未领取")}
                onPress={() => setPage("tag")}
              />
            ) : null}
            <ListRow
              icon="trophy-outline"
              label={t("Supervisor ranks", "监督者榜单")}
              onPress={() => setPage("leaderboard")}
            />
          </Group>
          {/*
            Which build is installed, read from the installed package. After an
            update this is how an owner sees that it took: the build number
            changes.
          */}
          <Group title={t("About this app", "关于此应用")}>
            <ListRow
              icon="information-outline"
              label={t("Version", "版本")}
              right={
                <Text style={s.small}>
                  {`${upd.installedVersionName() || "—"} · ${t("build", "构建")} ${upd.installedVersionCode() ?? "—"}`}
                </Text>
              }
            />
            {upd.installedChannel() !== "production" ? (
              <ListRow
                icon="source-branch"
                label={t("Channel", "渠道")}
                right={
                  <Text style={s.small}>
                    {upd.installedChannel() === "preview"
                      ? t("Preview", "预览版")
                      : t("Development", "开发版")}
                  </Text>
                }
              />
            ) : null}
            <ListRow
              icon="update"
              label={t("Updates", "更新")}
              right={
                <Text style={s.small}>
                  {update === null
                    ? t("Not checked", "未检查")
                    : update.state === upd.CURRENT
                      ? t("Up to date", "已是最新")
                      : t(
                          `Build ${update.manifest.versionCode} available`,
                          `构建 ${update.manifest.versionCode} 可用`,
                        )}
                </Text>
              }
            />
          </Group>
          <Group>
            <ListRow icon="lock-outline" label={t("Lock wallet", "锁定钱包")} onPress={forget} />
          </Group>
        </>
      );
    }
    if (settingsSection === "contacts") {
      const list = contactsCore.searchContacts(book, contactQuery);
      return (
        <>
          <Header
            title={t("Contacts", "联系人")}
            onBack={toSettings}
            backLabel={t("Settings", "设置")}
            right={
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("About contacts", "关于联系人")}
                  hitSlop={8}
                  onPress={() => setContactsInfo(true)}
                  style={({ pressed }) => ({
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: pressed ? colors.raised : colors.wash,
                  })}
                >
                  <Icon name="information-outline" size={19} color={colors.ink} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("Add a contact", "添加联系人")}
                  hitSlop={8}
                  onPress={() => openContact("")}
                  style={({ pressed }) => ({
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: pressed ? colors.greenPressed : colors.green,
                  })}
                >
                  <Icon name="plus" size={20} color={colors.paper} />
                </Pressable>
              </View>
            }
          />
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              borderWidth: 1,
              borderColor: colors.line,
              borderRadius: 22,
              backgroundColor: colors.wash,
              paddingHorizontal: 14,
              height: 44,
            }}
          >
            <Icon name="search" size={17} color={colors.muted} />
            <TextInput
              value={contactQuery}
              onChangeText={setContactQuery}
              placeholder={t("Search by name or address", "按名称或地址搜索")}
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              style={{ flex: 1, color: colors.ink, fontSize: 16 }}
            />
          </View>
          {list.length ? (
            <Group>
              {list.map((entry) => (
                <View
                  key={entry.address}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    paddingVertical: 9,
                  }}
                >
                  <Image
                    accessibilityLabel={entry.name}
                    source={{
                      uri: `https://api.dicebear.com/9.x/thumbs/png?seed=${encodeURIComponent(entry.address)}&size=76`,
                    }}
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 21,
                      backgroundColor: colors.raised,
                    }}
                  />
                  <Pressable
                    onPress={() => sendTo(entry.address)}
                    style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.6 : 1 })}
                  >
                    <Text style={[s.text, { fontWeight: "700" }]} numberOfLines={1}>
                      {entry.name}
                    </Text>
                    <Text style={s.small}>{short(entry.address)}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("Contact options", "联系人操作")}
                    hitSlop={10}
                    onPress={() => setContactMenuFor(entry.address)}
                    style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.5 : 1 })}
                  >
                    <Icon name="dots-horizontal" size={20} color={colors.muted} />
                  </Pressable>
                </View>
              ))}
            </Group>
          ) : (
            <Text style={s.small}>
              {contactQuery
                ? t("No contact matches that search.", "没有匹配的联系人。")
                : t(
                    "No saved addresses yet. After you send to an address, you can save it here.",
                    "还没有保存的地址。向某个地址发送后即可在此保存。",
                  )}
            </Text>
          )}
        </>
      );
    }
    if (settingsSection === "accounts")
      return (
        <>
          <Header
            title={t("Your wallets", "你的钱包")}
            onBack={toSettings}
            backLabel={t("Settings", "设置")}
            right={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("How multiple wallets work", "多钱包说明")}
                hitSlop={8}
                onPress={() => setAccountsInfo(true)}
                style={({ pressed }) => ({
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: pressed ? colors.raised : colors.wash,
                })}
              >
                <Icon name="information-outline" size={19} color={colors.ink} />
              </Pressable>
            }
          />
          <Group>
            {accounts.map((entry) => (
              <ListRow
                key={entry.index}
                icon={entry.active ? "wallet" : "wallet-outline"}
                label={walletName(entry)}
                detail={short(entry.address)}
                disabled={busy}
                onPress={
                  entry.active
                    ? undefined
                    : () =>
                        void run(async () => {
                          await switchTo(entry.index);
                        })
                }
                right={
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    {entry.active && <Icon name="check-circle" size={20} color={colors.green} />}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("Wallet options", "钱包操作")}
                      hitSlop={10}
                      disabled={busy}
                      onPress={() => setWalletMenuFor(entry.index)}
                      style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.5 : 1 })}
                    >
                      <Icon name="dots-horizontal" size={20} color={colors.muted} />
                    </Pressable>
                  </View>
                }
              />
            ))}
          </Group>
          {action(
            "Add a wallet",
            "新增钱包",
            async () => {
              const address = (await vault.addAccount()) as Address;
              await adopt(address);
              setNotice({
                title: t("Wallet added", "已新增钱包"),
                body: t(
                  "It is derived from your existing recovery phrase at the standard path, so any wallet app restores it from that phrase alone. There is nothing new to write down.",
                  "该钱包由你现有的助记词按标准路径派生，任何钱包应用仅凭这组助记词即可恢复，无需另外抄写任何内容。",
                ),
                tone: "success",
              });
            },
            false,
          )}
        </>
      );
    if (settingsSection === "security")
      return (
        <>
          <Header
            title={t("Security", "安全")}
            onBack={toSettings}
            backLabel={t("Settings", "设置")}
          />
          <Group>
            <ListRow
              icon="key-variant"
              label={t("Show recovery phrase", "显示助记词")}
              detail={t("Asks for your PIN first", "需要先输入 PIN")}
              disabled={busy}
              onPress={() =>
                authenticate(t("Show recovery phrase", "显示助记词"), async () =>
                  setRevealed(vault.revealPhrase()),
                )
              }
            />
            <ListRow icon="lock-outline" label={t("Lock now", "立即锁定")} onPress={forget} />
            <ListRow
              icon="fingerprint"
              label={t("Biometric unlock", "生物识别解锁")}
              detail={t("Unlock with Face ID or a fingerprint", "使用 Face ID 或指纹解锁")}
              onPress={() => {
                setPassword("");
                setBiometricError("");
                setBiometricSheet(true);
              }}
            />
          </Group>
        </>
      );
    if (settingsSection === "privacy") {
      const days = (d: number) => t(`${d} days`, `${d} 天`);
      return (
        <>
          <Header
            title={t("Privacy & data", "隐私与数据")}
            onBack={toSettings}
            backLabel={t("Settings", "设置")}
          />
          <View style={[s.panel, { gap: 14 }]}>
            <Text style={[s.text, { fontWeight: "700" }]}>
              {t("Keep local history for", "本地记录保留")}
            </Text>
            <Choices
              options={[7, 30, 90, 365].map(days)}
              value={days(data.retention)}
              select={(v) =>
                void run(async () => {
                  const retention = Number(v.match(/\d+/)?.[0] || data.retention);
                  const cutoff = Date.now() - retention * 86400000;
                  await store({
                    ...dataRef.current,
                    retention,
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
                "Drafts and activity are encrypted on this device.",
                "草稿和记录在此设备上加密保存。",
              )}
            </Text>
          </View>
          <Button
            danger
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
    }
    if (settingsSection === "sessions")
      return (
        <>
          <Header
            title={t("Agent sessions", "代理会话")}
            onBack={toSettings}
            backLabel={t("Settings", "设置")}
          />
          {data.token ? (
            <View style={[s.panel, { flexDirection: "row", alignItems: "center", gap: 12 }]}>
              <Icon name="check-circle" size={22} color={colors.green} />
              <Text style={[s.text, { flex: 1 }]}>
                {t("Scoped session connected", "已连接限定权限的会话")}
              </Text>
            </View>
          ) : null}
          <View style={[s.panel, { gap: 14 }]}>
            <Field
              label={t("Connect a scoped token", "连接限定权限令牌")}
              value={tokenInput}
              onChangeText={setTokenInput}
              secureTextEntry
              hint={t(
                "The token can prepare proposals but cannot sign.",
                "令牌可以准备提案，但不能签名。",
              )}
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
          </View>
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
          {data.token ? (
            <Button
              danger
              disabled={busy}
              onPress={() => void run(async () => store({ ...dataRef.current, token: "" }))}
            >
              {t("Disconnect token", "断开令牌")}
            </Button>
          ) : null}
        </>
      );
    if (settingsSection === "device")
      return (
        <>
          <Header
            title={t("This device", "此设备")}
            onBack={toSettings}
            backLabel={t("Settings", "设置")}
          />
          <View style={s.panel}>
            <Text style={s.small}>{t("Wallet address", "钱包地址")}</Text>
            <Text selectable style={s.mono}>
              {owner}
            </Text>
          </View>
          <Button
            danger
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
          <Text style={s.small}>
            {t(
              "This removes the wallet and its encrypted history from this phone. Funds stay on chain; your recovery phrase brings them back.",
              "这将从此手机删除钱包及其加密记录。资金仍在链上，可凭助记词恢复。",
            )}
          </Text>
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
  // Only Wallet and Activity keep the persistent tab bar. Every other
  // screen — Assistant, Settings (root and its sections), and every pushed
  // flow (send, receive, swap, bridge, tag, nfts) — reads as a place you
  // back out of with its own control, not one you tab-jump from.
  const isRootTab = page === "home" || page === "activity";
  return (
    <SafeAreaView
      style={s.page}
      onTouchStart={() => {
        inactivity.current = Date.now();
      }}
    >
      <StatusBar style={theme === "dark" ? "light" : "dark"} />
      {/*
        Every other screen (Activity, Assistant, Settings and its sub-
        sections, and every pushed flow) already shows its own title via
        the shared Header component — repeating the global "Tera Wallet"
        bar there would just be a second, redundant title stacked above it.
        Home is the one screen with no title of its own, so it's the one
        that gets this bar.
      */}
      {owner && page === "home" && (
        <View style={s.header}>
          <Pressable
            onPress={() => setPage("home")}
            style={{ flexDirection: "row", alignItems: "center", gap: 9 }}
          >
            <Image
              source={require("./assets/logo-mark.png")}
              style={{ width: 28, height: 28 }}
              resizeMode="contain"
            />
            <View>
              <Text style={{ color: colors.ink, fontWeight: "800", fontSize: 14 }}>
                Tera Wallet
              </Text>
            </View>
          </Pressable>
          <View
            style={{
              borderWidth: 1,
              borderColor: colors.line,
              borderRadius: 999,
              paddingHorizontal: 12,
              paddingVertical: 7,
            }}
          >
            {languageControl}
          </View>
        </View>
      )}
      <View style={{ flex: 1 }}>
        {/* What the glass bar blurs: everything that scrolls beneath it. */}
        <BlurTargetView ref={glassTarget} style={{ flex: 1, backgroundColor: colors.bg }}>
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            {owner && page === "assistant" ? (
              assistantScreen()
            ) : (
              <ScrollView
                ref={homeScrollRef}
                onScroll={(e) => {
                  homeScrollY.current = e.nativeEvent.contentOffset.y;
                }}
                scrollEventThrottle={32}
                contentContainerStyle={[s.content, owner ? { paddingBottom: 124 } : null]}
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
            )}
          </KeyboardAvoidingView>
        </BlurTargetView>
        {!owner && setupHistory.length > 0 && (
          <View
            {...edgeSwipeBack.panHandlers}
            style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 24 }}
          />
        )}
        {/*
          A floating glass bar, clear of the screen's edges like Safari's on
          iOS 26. It steps aside while the keyboard is up, so it never sits on
          top of the field being typed into.
        */}
        {owner && !keyboardOpen && isRootTab && (
          <View
            ref={tourTabBarRef}
            collapsable={false}
            style={{
              position: "absolute",
              left: 16,
              right: 16,
              bottom: 12,
              borderRadius: 34,
              overflow: "hidden",
              borderWidth: 1,
              borderColor: "#ffffff1f",
              elevation: 14,
              shadowColor: "#000000",
              shadowOpacity: 0.45,
              shadowRadius: 22,
              shadowOffset: { width: 0, height: 10 },
            }}
          >
            <BlurView
              blurTarget={glassTarget}
              blurMethod="dimezisBlurViewSdk31Plus"
              intensity={70}
              tint="dark"
              style={StyleSheet.absoluteFill}
            />
            {/* The glass's own tint, and all of it on phones too old to blur. */}
            <View style={[StyleSheet.absoluteFill, { backgroundColor: "#1d1b20b3" }]} />
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: 6,
                paddingVertical: 6,
              }}
            >
              {[
                ["wallet-outline", "Wallet", "钱包", "home"],
                ["history", "Activity", "记录", "activity"],
                ["", "", "", "actions"],
                ["message-text-outline", "Assistant", "助手", "assistant"],
                ["cog-outline", "Settings", "设置", "settings"],
              ].map(([icon, en, zh, p]) =>
                p === "actions" ? (
                  <View key={p} style={{ flex: 1, alignItems: "center" }}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("All actions", "全部操作")}
                      accessibilityState={{ expanded: sheetOpen }}
                      disabled={busy}
                      onPress={() => setSheetOpen(true)}
                      style={({ pressed }) => ({
                        opacity: busy ? 0.4 : 1,
                        transform: [{ scale: pressed ? 0.9 : 1 }],
                      })}
                    >
                      <Icon name="lightning-bolt-outline" size={30} color={colors.green} />
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    accessibilityRole="tab"
                    accessibilityState={{ selected: page === p }}
                    key={p}
                    disabled={busy}
                    onPress={() => {
                      setError("");
                      if (p === "settings") setSettingsSection("root");
                      setPage(p);
                    }}
                    style={({ pressed }) => ({
                      flex: 1,
                      alignItems: "center",
                      gap: 3,
                      paddingVertical: 7,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Icon name={icon} size={22} color={page === p ? colors.green : colors.muted} />
                    <Text
                      numberOfLines={1}
                      style={[
                        s.small,
                        {
                          fontSize: 10,
                          lineHeight: 13,
                          color: page === p ? colors.green : colors.muted,
                          fontWeight: page === p ? "700" : "500",
                        },
                      ]}
                    >
                      {t(en, zh)}
                    </Text>
                  </Pressable>
                ),
              )}
            </View>
          </View>
        )}
      </View>
      {tourStep !== null &&
        (() => {
          const step = tourSteps[tourStep];
          return (
            <AppTour
              rect={tourRect}
              label={step.label}
              body={step.body}
              extra={step.extra}
              index={tourStep}
              count={tourSteps.length}
              onNext={nextTourStep}
              onBack={prevTourStep}
              onSkip={skipTour}
              nextLabel={tourStep + 1 >= tourSteps.length ? t("Done", "完成") : t("Next", "下一步")}
              backLabel={t("Back", "上一步")}
              skipLabel={t("Skip", "跳过")}
            />
          );
        })()}
      <ActionSheet
        visible={sheetOpen && !!owner}
        onClose={() => setSheetOpen(false)}
        title={t("What do you want to do?", "你想做什么？")}
        actions={[
          {
            key: "send",
            icon: "arrow-top-right",
            label: t("Send", "发送"),
            onPress: () => openFlow("send"),
          },
          {
            key: "receive",
            icon: "arrow-down",
            label: t("Receive", "收款"),
            onPress: () => openFlow("receive"),
          },
          {
            key: "swap",
            icon: "swap-horizontal",
            label: t("Swap", "兑换"),
            onPress: () => openFlow("swap"),
          },
          {
            key: "bridge",
            icon: "bridge",
            label: t("Bridge", "跨链"),
            onPress: () => openFlow("bridge"),
          },
          {
            key: "private",
            icon: "shield-lock-outline",
            label: t("Private", "私密发送"),
            onPress: () => openFlow("send", "private"),
          },
          ...(tagsAvailable()
            ? [
                {
                  key: "tag",
                  icon: "at",
                  label: t("Tag", "标签"),
                  onPress: () => setPage("tag"),
                },
              ]
            : []),
          {
            key: "ranks",
            icon: "trophy-outline",
            label: t("Ranks", "榜单"),
            onPress: () => setPage("leaderboard"),
          },
          {
            key: "contacts",
            icon: "account-multiple-outline",
            label: t("Contacts", "联系人"),
            onPress: () => {
              setSettingsSection("contacts");
              setPage("settings");
            },
          },
        ]}
      />
      <ActionSheet
        visible={walletMenuFor !== null && !!owner}
        onClose={() => setWalletMenuFor(null)}
        onClosed={() => {
          afterWalletMenuCloses.current?.();
          afterWalletMenuCloses.current = null;
        }}
        title={
          walletMenuFor !== null
            ? walletName(
                accounts.find((entry) => entry.index === walletMenuFor) || {
                  index: walletMenuFor,
                  name: "",
                },
              )
            : ""
        }
        actions={(() => {
          const entry = accounts.find((a) => a.index === walletMenuFor);
          if (!entry) return [];
          return [
            // Every action here is deferred to the sheet's onClosed, not run
            // immediately: the sheet itself is a Modal, still present on the
            // native side until its close animation actually finishes, and
            // anything that can open another Modal (rename, or an error
            // notice from `run`) would briefly overlap it and hang iOS.
            ...(entry.active
              ? []
              : [
                  {
                    key: "switch",
                    icon: "check-circle",
                    label: t("Switch to this wallet", "切换到此钱包"),
                    onPress: () => {
                      afterWalletMenuCloses.current = () =>
                        void run(async () => {
                          await switchTo(entry.index);
                        });
                    },
                  },
                ]),
            {
              key: "rename",
              icon: "pencil-outline",
              label: t("Rename", "重命名"),
              onPress: () => {
                afterWalletMenuCloses.current = () => {
                  setRenameError("");
                  setNameInput(entry.name);
                  setRenamingIndex(entry.index);
                };
              },
            },
            {
              key: "copy",
              icon: "content-copy",
              label: t("Copy address", "复制地址"),
              onPress: () =>
                void Clipboard.setStringAsync(entry.address).then(() => {
                  afterWalletMenuCloses.current = () =>
                    setNotice({
                      title: t("Address copied", "地址已复制"),
                      body: t(
                        "The wallet address is on your clipboard.",
                        "钱包地址已复制到剪贴板。",
                      ),
                      tone: "success",
                    });
                }),
            },
          ];
        })()}
      />
      <Modal
        visible={renamingIndex !== null && !!owner}
        transparent
        animationType="slide"
        onRequestClose={() => setRenamingIndex(null)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable
            onPress={() => setRenamingIndex(null)}
            style={{ flex: 1, backgroundColor: colors.scrim, justifyContent: "flex-end" }}
          >
            <Pressable
              onPress={() => {}}
              style={{
                backgroundColor: colors.sheet,
                borderTopLeftRadius: 30,
                borderTopRightRadius: 30,
                padding: 24,
                gap: 14,
              }}
            >
              <Text style={s.title}>{t("Rename wallet", "重命名钱包")}</Text>
              <Field
                label={t("Name", "名称")}
                value={nameInput}
                onChangeText={setNameInput}
                placeholder={renamingIndex !== null ? defaultName(renamingIndex) : ""}
                maxLength={vault.MAX_NAME}
                hint={t(
                  "Stored on this device only — it does not travel with your recovery phrase.",
                  "仅保存在本设备，不随助记词一同迁移。",
                )}
              />
              {renameError ? (
                <Text style={[s.small, { color: colors.danger }]}>{renameError}</Text>
              ) : null}
              {action("Save name", "保存名称", async () => {
                if (renamingIndex === null) return;
                // Caught here rather than left to throw: `run` would route
                // a thrown error to the global `error` state, which opens
                // the shared "Couldn't complete that" notice — another
                // Modal, which would stack on this sheet's still-open one
                // and hang iOS. Shown inline instead, like contactError.
                try {
                  await vault.renameAccount(renamingIndex, nameInput);
                  syncAccounts();
                  setRenamingIndex(null);
                } catch (e) {
                  setRenameError(
                    e instanceof Error
                      ? e.message
                      : t("Couldn't save that name.", "无法保存该名称。"),
                  );
                }
              })}
              <Button
                onPress={() => {
                  setRenameError("");
                  setRenamingIndex(null);
                }}
              >
                {t("Cancel", "取消")}
              </Button>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
      <Modal
        visible={accountsInfo}
        transparent
        animationType="slide"
        onRequestClose={() => setAccountsInfo(false)}
      >
        <Pressable
          onPress={() => setAccountsInfo(false)}
          style={{ flex: 1, backgroundColor: colors.scrim, justifyContent: "flex-end" }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: colors.sheet,
              borderTopLeftRadius: 30,
              borderTopRightRadius: 30,
              padding: 24,
              gap: 14,
            }}
          >
            <Text style={s.title}>{t("How multiple wallets work", "多钱包说明")}</Text>
            <Text style={s.text}>
              {t(
                "Every wallet here comes from the one recovery phrase you already backed up. Adding one does not give you another phrase to keep safe.",
                "这里的每个钱包都由你已备份的同一组助记词派生，新增钱包不会产生需要另外保管的助记词。",
              )}
            </Text>
            <Text style={[s.text, { fontWeight: "700" }]}>
              {t("What a second wallet does not do", "第二个钱包无法做到的事")}
            </Text>
            <Text style={s.text}>
              {t(
                "It does not make you a different person to this app's network. Balances for every wallet here are read over the same connection, from the same device, so the operator answering them can see they belong together. Separate wallets keep your activity apart on-chain; they do not hide that one person holds both.",
                "它不会让你在本应用的网络看来变成另一个人。这里所有钱包的余额都通过同一连接、同一设备读取，因此提供读取服务的一方能看出它们同属一人。独立钱包能在链上区分你的活动，但无法隐藏它们由同一人持有。",
              )}
            </Text>
            <Button primary onPress={() => setAccountsInfo(false)}>
              {t("Got it", "知道了")}
            </Button>
          </Pressable>
        </Pressable>
      </Modal>
      <ActionSheet
        visible={contactMenuFor !== null && !!owner}
        onClose={() => setContactMenuFor(null)}
        onClosed={() => {
          afterContactMenuCloses.current?.();
          afterContactMenuCloses.current = null;
        }}
        title={
          contactMenuFor !== null
            ? contactsCore.nameFor(book, contactMenuFor) || short(contactMenuFor)
            : ""
        }
        actions={
          contactMenuFor === null
            ? []
            : [
                {
                  key: "send",
                  icon: "arrow-top-right",
                  label: t("Send", "发送"),
                  onPress: () => {
                    const address = contactMenuFor;
                    afterContactMenuCloses.current = () => sendTo(address);
                  },
                },
                {
                  key: "rename",
                  icon: "pencil-outline",
                  label: t("Rename", "重命名"),
                  onPress: () => {
                    const address = contactMenuFor;
                    afterContactMenuCloses.current = () => openContact(address);
                  },
                },
                {
                  key: "remove",
                  icon: "trash-2",
                  label: t("Remove", "删除"),
                  danger: true,
                  onPress: () => {
                    const address = contactMenuFor;
                    afterContactMenuCloses.current = () => removeContactNow(address);
                  },
                },
              ]
        }
      />
      <Modal
        visible={contactsInfo}
        transparent
        animationType="slide"
        onRequestClose={() => setContactsInfo(false)}
      >
        <Pressable
          onPress={() => setContactsInfo(false)}
          style={{ flex: 1, backgroundColor: colors.scrim, justifyContent: "flex-end" }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: colors.sheet,
              borderTopLeftRadius: 30,
              borderTopRightRadius: 30,
              padding: 24,
              gap: 14,
            }}
          >
            <Text style={s.title}>{t("About contacts", "关于联系人")}</Text>
            <Text style={s.text}>{contactNote}</Text>
            <Button primary onPress={() => setContactsInfo(false)}>
              {t("Got it", "知道了")}
            </Button>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        visible={swapReceivePicker && !!owner}
        animationType="slide"
        onRequestClose={() => setSwapReceivePicker(false)}
      >
        <SafeAreaView style={s.page}>
          <Header
            title={t("Choose a token", "选择代币")}
            onBack={() => setSwapReceivePicker(false)}
            backLabel={t("Cancel", "取消")}
          />
          <ScrollView contentContainerStyle={s.content}>
            {assets
              .filter((a) => !["ETH", "USDG"].includes(a.symbol))
              .map((a) => (
                <Pressable
                  key={a.symbol}
                  onPress={() => {
                    setAssetSymbol(a.symbol);
                    setSwapReceivePicker(false);
                  }}
                  style={[s.panel, { flexDirection: "row", alignItems: "center", gap: 12 }]}
                >
                  <TokenIcon symbol={a.symbol} size={32} />
                  <Text style={[s.text, { flex: 1, fontWeight: "600" }]}>{a.symbol}</Text>
                  {assetSymbol === a.symbol && <Icon name="check" size={20} color={colors.green} />}
                </Pressable>
              ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
      <Modal
        visible={voiceMode && !!owner}
        animationType="fade"
        transparent
        onDismiss={() => {
          if (pendingVoiceNotice.current) {
            setNotice(pendingVoiceNotice.current);
            pendingVoiceNotice.current = null;
          }
        }}
        onRequestClose={() => {
          ExpoSpeechRecognitionModule.stop();
          setVoiceMode(false);
        }}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: colors.scrim,
            alignItems: "center",
            justifyContent: "center",
            gap: 28,
            paddingHorizontal: 32,
          }}
        >
          <VoiceListening />
          <Text style={[s.text, { color: "#ffffff", textAlign: "center" }]}>
            {liveTranscript || t("Listening…", "正在聆听…")}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("Stop", "停止")}
            onPress={() => {
              ExpoSpeechRecognitionModule.stop();
              setVoiceMode(false);
            }}
            style={({ pressed }) => ({
              width: 56,
              height: 56,
              borderRadius: 28,
              backgroundColor: colors.wash,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Icon name="circle-x" size={26} color={colors.ink} />
          </Pressable>
        </View>
      </Modal>
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
            <View style={s.panel}>
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
        <View style={{ flex: 1, backgroundColor: colors.scrim, justifyContent: "flex-end" }}>
          <SafeAreaView
            edges={["bottom"]}
            style={{
              maxHeight: "88%",
              backgroundColor: colors.sheet,
              borderTopLeftRadius: 30,
              borderTopRightRadius: 30,
              overflow: "hidden",
            }}
          >
            <ScrollView
              ref={reviewScrollRef}
              contentContainerStyle={[s.content, { paddingTop: 24 }]}
            >
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
                  {
                    backgroundColor:
                      review?.simulation === "passed" ? colors.tint : colors.warnTint,
                  },
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
                  <TeraSpinner size={18} />
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
                    { backgroundColor: colors.wash, borderWidth: 1, borderColor: colors.green },
                  ]}
                >
                  <Text style={s.eyebrow}>{t("CONFIRM WITH YOUR WALLET", "使用钱包确认")}</Text>
                  <Text style={s.text}>
                    {t(
                      "Enter your PIN to sign this exact transaction.",
                      "输入 PIN 以签署这笔准确交易。",
                    )}
                  </Text>
                  {authError ? (
                    <Text style={[s.small, { color: colors.danger }]}>{authError}</Text>
                  ) : null}
                  {pinWallet ? (
                    <>
                      <PinInput label={t("Wallet PIN", "钱包 PIN")} value={authPassword} />
                      {busy ? (
                        <View style={{ alignItems: "center", paddingVertical: 12 }}>
                          <TeraSpinner size={36} />
                        </View>
                      ) : (
                        <Keypad
                          onDigit={(d) => {
                            if (authPassword.length >= 6) return;
                            const next = authPassword + d;
                            setAuthPassword(next);
                            if (next.length === 6)
                              void run(async (g) => {
                                try {
                                  await authorize(false, g);
                                } catch (e) {
                                  setAuthPassword("");
                                  setAuthError(
                                    e instanceof Error
                                      ? e.message
                                      : t("Couldn't authorize that.", "无法完成授权。"),
                                  );
                                }
                              });
                          }}
                          onBackspace={() => setAuthPassword((p) => p.slice(0, -1))}
                        />
                      )}
                    </>
                  ) : (
                    <>
                      <Field
                        label={t("Wallet password", "钱包密码")}
                        value={authPassword}
                        onChangeText={setAuthPassword}
                        secureTextEntry
                      />
                      {action("Sign transaction", "签署交易", async (g) => {
                        try {
                          await authorize(false, g);
                        } catch (e) {
                          setAuthError(
                            e instanceof Error
                              ? e.message
                              : t("Couldn't authorize that.", "无法完成授权。"),
                          );
                        }
                      })}
                    </>
                  )}
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() =>
                      void run(async (g) => {
                        try {
                          await authorize(true, g);
                        } catch (e) {
                          setAuthError(
                            e instanceof Error
                              ? e.message
                              : t("Couldn't authorize that.", "无法完成授权。"),
                          );
                        }
                      })
                    }
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      paddingVertical: 10,
                      opacity: busy ? 0.4 : pressed ? 0.6 : 1,
                    })}
                  >
                    <Icon name="fingerprint" size={17} color={colors.green} />
                    <Text style={[s.small, { color: colors.green, fontWeight: "600" }]}>
                      {t("Use biometrics", "使用生物识别")}
                    </Text>
                  </Pressable>
                  <Button
                    disabled={busy}
                    onPress={() => {
                      setAuth(null);
                      setAuthPassword("");
                      setAuthError("");
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
                  <TeraSpinner size={18} />
                ) : auth ? (
                  t("Enter PIN above", "在上方输入 PIN")
                ) : busy ? (
                  <TeraSpinner size={18} />
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
          style={{ flex: 1, backgroundColor: colors.scrim, justifyContent: "flex-end" }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: colors.sheet,
              borderTopLeftRadius: 30,
              borderTopRightRadius: 30,
              padding: 24,
              gap: 14,
            }}
          >
            <View
              style={{
                alignSelf: "center",
                width: 72,
                height: 72,
                borderRadius: 36,
                backgroundColor: notice?.tone === "error" ? colors.danger : colors.green,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon
                name={notice?.tone === "error" ? "alert" : "check-bold"}
                size={36}
                color={colors.paper}
              />
            </View>
            <Text style={[s.title, { fontSize: 22, lineHeight: 28, textAlign: "center" }]}>
              {notice?.title}
            </Text>
            <Text style={[s.text, { color: colors.muted, textAlign: "center" }]}>
              {notice?.body}
            </Text>
            <Button primary onPress={() => setNotice(null)}>
              {t("Done", "完成")}
            </Button>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        visible={!!contactSheet && !!owner}
        transparent
        animationType="slide"
        onRequestClose={() => setContactSheet(null)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable
            onPress={() => setContactSheet(null)}
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
              {contactSheet?.afterSend ? (
                <>
                  <Icon name="check-circle-outline" size={32} color={colors.green} />
                  <Text style={s.title}>{t("Transaction submitted", "交易已提交")}</Text>
                  <Text style={s.text}>
                    {t(
                      "Your signed transaction is now in Activity.",
                      "已签名交易现已显示在记录中。",
                    )}
                  </Text>
                  <Text style={[s.text, { fontWeight: "700", marginTop: 6 }]}>
                    {t("Save this address to contacts?", "将此地址保存到联系人？")}
                  </Text>
                </>
              ) : (
                <Text style={s.title}>
                  {contactSheet?.fixed && contactsCore.nameFor(book, contactSheet.address)
                    ? t("Rename contact", "重命名联系人")
                    : t("Save a contact", "保存联系人")}
                </Text>
              )}
              {contactSheet?.fixed ? (
                <Text selectable style={s.mono}>
                  {contactSheet.address}
                </Text>
              ) : (
                <Field
                  label={t("Robinhood Chain address", "Robinhood Chain 地址")}
                  value={contactAddress}
                  onChangeText={(value) => {
                    setContactAddress(value);
                    setContactError("");
                  }}
                  placeholder="0x…"
                />
              )}
              <Field
                label={t("Name", "名称")}
                value={contactName}
                onChangeText={(value) => {
                  setContactName(value);
                  setContactError("");
                }}
                placeholder={t("e.g. Mum, Rent, Ada", "例如：妈妈、房租、Ada")}
                maxLength={contactsCore.LIMITS.maxLength}
              />
              {contactError ? (
                <Text style={[s.small, { color: colors.danger }]}>{contactError}</Text>
              ) : null}
              <Text style={s.small}>{contactNote}</Text>
              {action("Save contact", "保存联系人", async () => saveContactNow())}
              <Button onPress={() => setContactSheet(null)}>
                {contactSheet?.afterSend ? t("Not now", "暂不") : t("Cancel", "取消")}
              </Button>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
      <Modal
        visible={!!auth && !!owner && !review}
        transparent
        animationType="fade"
        onRequestClose={() => !busy && setAuth(null)}
      >
        <View
          style={{ flex: 1, backgroundColor: colors.scrim, justifyContent: "center", padding: 24 }}
        >
          <View style={[s.panel, { backgroundColor: colors.sheet }]}>
            <Text style={s.text}>{auth?.title}</Text>
            <Field
              label={pinWallet ? t("Wallet PIN", "钱包 PIN") : t("Wallet password", "钱包密码")}
              value={authPassword}
              onChangeText={setAuthPassword}
              secureTextEntry
              keyboardType={pinWallet ? "number-pad" : "default"}
              maxLength={pinWallet ? 6 : undefined}
            />
            {authError ? (
              <Text style={[s.small, { color: colors.danger }]}>{authError}</Text>
            ) : null}
            {action("Authorize", "授权", async (g) => {
              // Caught here, not left to `run`: a thrown error would route
              // through the global `error` state, which opens the shared
              // notice Modal on top of this still-open one and hangs iOS.
              try {
                await authorize(false, g);
              } catch (e) {
                setAuthError(
                  e instanceof Error ? e.message : t("Couldn't authorize that.", "无法完成授权。"),
                );
              }
            })}
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() =>
                void run(async (g) => {
                  try {
                    await authorize(true, g);
                  } catch (e) {
                    setAuthError(
                      e instanceof Error
                        ? e.message
                        : t("Couldn't authorize that.", "无法完成授权。"),
                    );
                  }
                })
              }
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                paddingVertical: 10,
                opacity: busy ? 0.4 : pressed ? 0.6 : 1,
              })}
            >
              <Icon name="fingerprint" size={17} color={colors.green} />
              <Text style={[s.small, { color: colors.green, fontWeight: "600" }]}>
                {t("Use biometrics", "使用生物识别")}
              </Text>
            </Pressable>
            <Button
              disabled={busy}
              onPress={() => {
                setAuth(null);
                setAuthPassword("");
                setAuthError("");
              }}
            >
              {t("Cancel", "取消")}
            </Button>
          </View>
        </View>
      </Modal>
      <Modal
        visible={biometricSheet && !!owner}
        transparent
        animationType="fade"
        onRequestClose={() => !busy && setBiometricSheet(false)}
      >
        <View
          style={{ flex: 1, backgroundColor: colors.scrim, justifyContent: "center", padding: 24 }}
        >
          <View style={[s.panel, { backgroundColor: colors.sheet, gap: 14 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={s.iconDisc}>
                <Icon name="fingerprint" size={20} color={colors.green} />
              </View>
              <Text style={[s.text, { fontWeight: "700", flex: 1 }]}>
                {t("Enable biometric unlock", "启用生物识别解锁")}
              </Text>
            </View>
            <Field
              label={t("Password to enable biometrics", "启用生物识别所需的密码")}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
            {biometricError ? (
              <Text style={[s.small, { color: colors.danger }]}>{biometricError}</Text>
            ) : null}
            {action("Enable biometric unlock", "启用生物识别解锁", async () => {
              // Caught here, not left to `run`: a thrown error would route
              // through the global `error` state, which opens the shared
              // notice Modal on top of this still-open one and hangs iOS.
              try {
                await vault.enableBiometrics(password);
                setPassword("");
                setBiometricSheet(false);
                setNotice({
                  title: t("Biometric unlock enabled", "已启用生物识别解锁"),
                  body: t(
                    "Use Face ID or a fingerprint to unlock next time.",
                    "下次可使用 Face ID 或指纹解锁。",
                  ),
                  tone: "success",
                });
              } catch (e) {
                setBiometricError(
                  e instanceof Error ? e.message : t("Couldn't enable that.", "无法启用该功能。"),
                );
              }
            })}
            <Button
              disabled={busy}
              onPress={() => {
                setBiometricSheet(false);
                setPassword("");
                setBiometricError("");
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
  const [fontsLoaded, fontError] = useFonts(fontFiles);
  // A font that fails to load is not a reason to keep someone out of their
  // wallet: the text falls back to the system font and the app opens anyway.
  setFontsReady(fontsLoaded && !fontError);
  if (!fontsLoaded && !fontError) return <View style={s.page} />;
  return (
    <SafeAreaProvider>
      <Wallet />
    </SafeAreaProvider>
  );
}
