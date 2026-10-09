import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import Svg, {
  Path,
  Defs,
  RadialGradient,
  LinearGradient as SvgLinearGradient,
  Stop,
} from "react-native-svg";
import { BlurTargetView, BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import * as Crypto from "expo-crypto";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "./src/speech";
import { erc20Abi, formatUnits, parseUnits, zeroAddress, isAddress, getAddress, type Address, type Hex } from "viem";
import { api } from "./src/api";
import { Asset, chain, destinations, sources, Tx, USDG } from "./src/config";
import * as tags from "./src/tags";
import * as biz from "./src/business";
import * as payLinks from "./src/paylinks";
import * as notify from "./src/notify";
const tagsAvailable = () => tags.tagsAvailable();
import * as upd from "./src/update";
import { balances, client, confirmation, execute, probeNetwork, transactionStatus } from "./src/network";
import { fetchChainHistory, fetchTransferLegs, type ChainHistoryEntry, type TransferLeg } from "./src/explorer";
import { KNOWN_SPENDERS, scanApprovals, type Grant } from "./src/approvals";
import { policyFor } from "./src/policy";
import { proposalVerdicts, verifyProposal } from "./src/proposals";
import { reviewIntelligence, type IntelligenceInput, type ReviewIntelligence } from "./src/intelligence";
import {
  activitySearch,
  discretion,
  networkSpeed,
  notes as notesCore,
  contacts as contactsCore,
  limits as limitsCore,
  spend as spendCore,
  UNVERIFIABLE,
  value as valueCore,
  slippage as slippageCore,
  schedules as schedulesCore,
  watched as watchedCore,
  limitOrders as limitCore,
  pnl as pnlCore,
  priceImpact as impactCore,
  stakingCore,
  approvals as approvalRules,
} from "./src/core";
import { FIAT_RATES, check, checkChecksum, formatFiat, isTrustedRecipient, parseQrAddress, positive, same, transferTx, verifyBridge, verifyTransfer } from "./src/validation";
import * as vault from "./src/storage";
import { evaluatePriceAlerts, type PriceAlert } from "./src/alerts";
import { screenOrigin } from "./src/viewport";
import { useAppTheme } from "./src/theme";
import { generateActivityCsv, shareText } from "./src/share";
import { calculateMonthlySpending } from "./src/spending";
import { normalizePhrase, walletFromPhrase, walletFromPrivateKey } from "./src/crypto";
import { calculateNetBalanceDelta, type NetBalanceDelta } from "./src/verdict";
import { GAS_SPEEDS, getAllGasTierEstimates, type GasTier } from "./src/gasspeed";
import { getPinnedAssets, togglePinned, sortWithPinned, isPinned } from "./src/watchlist";
import { generateExportCsv, CSV_PRESETS } from "./src/csvexport";
import {
  Button,
  Chips,
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
  Skeleton,
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
  /** Where to land once it is sent. Activity when unset. */
  returnTo?: string;
  /** The estimated network fee in wei for every step, once simulation has read it. */
  feeWei?: string;
  /** A swap's price impact (core/price-impact.js); "confirm" needs the owner's tick to sign. */
  impact?: { level: string; pct: number | null; costUsd: number | null };
  /**
   * A payment's value in dollars (USDG base units), checked against the
   * spending limits again at signing; null when it has no price. Unset for
   * anything that is not a payment — swaps, bridges, NFTs.
   */
  spendUsd?: string | null;
  simulation?: "checking" | "passed" | "needs-attention";
  isPrivateBridge?: boolean;
  /** The address the owner chose to pay. Read by the address book only. */
  payee?: string;
  intelligenceInput?: IntelligenceInput;
  intelligence?: ReviewIntelligence;
  historical?: boolean;
  historyNote?: string;
  activityType?: "send" | "swap" | "bridge" | "revoke";
  /** The owner's private note, saved under the transaction's hash once it is signed. */
  note?: string;
  netBalanceDelta?: NetBalanceDelta;
};
type ReviewSnapshot = Pick<Review, "rows" | "steps">;
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
  BNB: require("./assets/bnb.png"),
  BTC: require("./assets/bitcoin.png"),
  DOGE: require("./assets/dogecoin.png"),
  XRP: require("./assets/xrp.png"),
  ADA: require("./assets/cardano.png"),
  AVAX: require("./assets/avalanche.png"),
  LINK: require("./assets/chainlink.png"),
  ARC: require("./assets/arc.jpg"),
};
const popularTokens = [
  { symbol: "TERA", name: "Tera" },
  { symbol: "ETH", name: "Ethereum" },
  { symbol: "BTC", name: "Bitcoin" },
  { symbol: "SOL", name: "Solana" },
  { symbol: "BNB", name: "BNB" },
  { symbol: "DOGE", name: "Dogecoin" },
  { symbol: "XRP", name: "XRP" },
  { symbol: "ADA", name: "Cardano" },
  { symbol: "AVAX", name: "Avalanche" },
  { symbol: "LINK", name: "Chainlink" },
  // Circle's Arc network (chain ID 5042) — live, but gas is paid in USDC
  // rather than a separate native coin, so there's no "ARC" token or price
  // anywhere to show. Shown for discovery only; see the marketRow/
  // canHoldHere logic for how a symbol with no price source degrades to a
  // name-only "Coming soon" row instead of a broken one.
  { symbol: "ARC", name: "Arc" },
] as const;
const popularSymbols = new Set<string>(popularTokens.map(({ symbol }) => symbol));
const HOLD_TO_SIGN_MS = 700;
// The Activity list with nothing narrowing it.
const NO_ACTIVITY_FILTERS = { kind: "all", asset: "all", status: "all", period: "any", from: "", to: "" };
// Fallback for a token shown before its real logo has been sourced. Empty
// now that every token in popularTokens has a real image in tokenImages —
// kept as the landing place for the next one that doesn't yet.
const tokenMonograms: Record<string, { label: string; background: string; foreground: string }> =
  {};

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
      {tokenMonograms[symbol] && !tokenImages[symbol] ? (
        <View
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: tokenMonograms[symbol].background,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text
            style={{
              color: tokenMonograms[symbol].foreground,
              fontWeight: "800",
              fontSize: size * 0.54,
            }}
          >
            {tokenMonograms[symbol].label}
          </Text>
        </View>
      ) : (
        <Image
          source={tokenImages[symbol] || require("./assets/RH-RWA-Assets-Media/rh-icon.png")}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: colors.wash,
          }}
        />
      )}
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
/** The window width, in CSS pixels, from which the web app uses its desktop layout. */
const WIDE_MIN = 1024;
function Wallet() {
  // A laptop or desktop browser gets a dapp's layout — a top bar, a dock of
  // sections and a wide content area — instead of a phone stretched sideways.
  // Phones, and every native build, keep the mobile layout exactly.
  const { width: windowWidth } = useWindowDimensions();
  const wide = Platform.OS === "web" && windowWidth >= WIDE_MIN;
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
    [swapPayPicker, setSwapPayPicker] = useState(false),
    [voiceMode, setVoiceMode] = useState(false),
    [liveTranscript, setLiveTranscript] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [selectedGasSpeed, setSelectedGasSpeed] = useState<"eco" | "standard" | "fast">("standard"),
    [slippageBps, setSlippageBps] = useState<number>(slippageCore.DEFAULT_SLIPPAGE_BPS),
    // The scheduled payment the send screen was opened for, if any. Signing that
    // send marks this one payment paid; leaving the send screen forgets it.
    [scheduleRun, setScheduleRun] = useState<
      null | { id: string; date: string; label: string; kind: "payment" | "buy"; asset: string; amount: string }
    >(null),
    [scheduleForm, setScheduleForm] = useState<Record<string, string>>({}),
    [scheduleEditId, setScheduleEditId] = useState(""),
    [scheduleError, setScheduleError] = useState(""),
    // Watched wallets: which one is open, the form, and the balances read for
    // each (null while unread or when the read failed). Never the signing account.
    [watchOpen, setWatchOpen] = useState(""),
    [watchForm, setWatchForm] = useState<{ address: string; name: string; editing: boolean }>({
      address: "",
      name: "",
      editing: false,
    }),
    [watchError, setWatchError] = useState(""),
    [watchBalances, setWatchBalances] = useState<Record<string, Record<string, string> | null>>({}),
    [watchHistory, setWatchHistory] = useState<ChainHistoryEntry[] | null>(null),
    // The limit order the swap screen was opened for, the order form, and its error.
    [limitRun, setLimitRun] = useState<
      null | { id: string; side: "buy" | "sell"; asset: string; kind: "limit" | "stop" | "take"; limit: string }
    >(null),
    // The protect form: a stop-loss and/or take-profit on one holding.
    [protectForm, setProtectForm] = useState<Record<string, string>>({}),
    [protectError, setProtectError] = useState(""),
    // Whether the owner has accepted a high price impact on the open review.
    [impactAccepted, setImpactAccepted] = useState(false),
    [limitForm, setLimitForm] = useState<Record<string, string>>({}),
    [limitEditId, setLimitEditId] = useState(""),
    [orderError, setOrderError] = useState(""),
    // Profit and loss and the portfolio chart: the wallet's transfer legs read from
    // the chain, price history by range and symbol, and the chosen chart range.
    [pnlLegs, setPnlLegs] = useState<null | { owner: string; at: number; legs: TransferLeg[]; complete: boolean }>(null),
    [pnlHistory, setPnlHistory] = useState<Record<string, Record<string, { t: number; p: number }[]>>>({}),
    [portfolioRange, setPortfolioRange] = useState<"1D" | "1W" | "1M" | "1Y">("1D"),
    [costEdit, setCostEdit] = useState<{ symbol: string; value: string } | null>(null),
    [pinnedAssets, setPinnedAssetsState] = useState<string[]>(() => getPinnedAssets()),
    [csvModalOpen, setCsvModalOpen] = useState(false),
    [stakingPosition, setStakingPosition] = useState<any>(null),
    // The staking screen's positions, fixed locks and recent payouts; null while reading.
    [stakeData, setStakeData] = useState<
      null | { positions: any[]; locks: any[]; payouts: any[]; epochs: any[]; config: any }
    >(null),
    // Which stake the form makes: flexible, or a fixed lock of 30, 45 or 90 days.
    [stakeTerm, setStakeTerm] = useState<"flexible" | "30" | "45" | "90">("flexible"),
    // The latest crediting state of each pending deposit, by transaction hash.
    [creditState, setCreditState] = useState<Record<string, string>>({}),
    [stakeError, setStakeError] = useState(""),
    [stakingLockTier, setStakingLockTier] = useState<"flexible" | "30d" | "90d">("flexible"),
    [stakeAmount, setStakeAmount] = useState("");
  const { setting: themeSetting, effectiveTheme, updateSetting: updateThemeSetting } = useAppTheme();
  useEffect(() => {
    setColorTheme(effectiveTheme);
  }, [effectiveTheme]);
  const [data, setData] = useState(vault.emptyData());
  // Which wallet this session opens: the personal one, or Tera Business — a
  // separate wallet with its own secret and PIN, web only for now (on the
  // phone biz.mode() is always "personal"). `bizSplash` is the door screen
  // shown while the vault behind it is switched.
  const [bizMode, setBizMode] = useState<biz.Mode>(biz.mode()),
    [bizSplash, setBizSplash] = useState(false),
    [, setEmailOn] = useState(false),
    // The email this business wallet is paid at, if one is linked. Stands where
    // a personal wallet shows its tag.
    [bizEmail, setBizEmail] = useState<string | null>(null);
  const business = bizMode === "business";
  const brand = business ? "Tera Business" : "Tera Wallet";
  const dataRef = useRef(data);
  const holdProgress = useRef(new Animated.Value(0)).current;
  const [balance, setBalance] = useState<Record<string, string> | null>(null),
    [prices, setPrices] = useState<Record<string, number>>({ USDG: 1 }),
    [priceChanges, setPriceChanges] = useState<Record<string, number>>({}),
    // Same-day trend lines for the token list, keyed by symbol. Only ever
    // populated for symbols with a real external market (see the backend
    // comment on coinGeckoSparklines) — absent, not faked, for everything else.
    [sparklines, setSparklines] = useState<Record<string, { t: number; p: number }[]>>({}),
    // Market cap rank, same source and same real-market-only scope as
    // sparklines above.
    [ranks, setRanks] = useState<Record<string, number>>({}),
    [refreshing, setRefreshing] = useState(false),
    [flowStep, setFlowStep] = useState(0),
    [amountInvalid, setAmountInvalid] = useState(false),
    [settingsSection, setSettingsSection] = useState<
      | "root"
      | "security"
      | "privacy"
      | "sessions"
      | "device"
      | "accounts"
      | "contacts"
      | "limits"
      | "alerts"
      | "appearance"
      | "autolock"
      | "currency"
      | "approvals"
    >("root"),
    // Open token approvals, read from the chain when the screen opens. Null
    // until the first scan finishes; never stored.
    [grants, setGrants] = useState<Grant[] | null>(null),
    [grantsBusy, setGrantsBusy] = useState(false),
    [grantsError, setGrantsError] = useState(""),
    // The transaction banner at the top of the screen, and the browser's
    // permission for system notifications as last read.
    [txAlert, setTxAlert] = useState<null | { title: string; body: string; hash: string }>(null),
    [systemAlerts, setSystemAlerts] = useState(() => notify.systemPermission()),
    [limitFields, setLimitFields] = useState<Record<string, string>>({}),
    [limitError, setLimitError] = useState(""),
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
    // What the Activity list is searched and filtered by. Kept while the
    // owner opens a row and comes back.
    [activityQuery, setActivityQuery] = useState(""),
    [activityFilters, setActivityFilters] = useState({ ...NO_ACTIVITY_FILTERS }),
    [activityFiltersOpen, setActivityFiltersOpen] = useState(false),
    // Business notes, read from the Reports book; personal notes are in `data`.
    [bizNotes, setBizNotes] = useState<Record<string, string>>({}),
    // The note being written on the open Activity row, or null when not editing.
    [noteDraft, setNoteDraft] = useState<string | null>(null),
    // The note written on the Send or Pay screen, for the payment about to be reviewed.
    [payNote, setPayNote] = useState(""),
    // The latest reading of the network, for the speed label. null until the first one.
    [netReading, setNetReading] = useState<ReturnType<typeof networkSpeed.reading> | null>(null),
    // Where and when the open Activity row landed, read from its receipt.
    [detailSpeed, setDetailSpeed] = useState<
      | null
      | { hash: string; missing: true }
      | { hash: string; missing?: false; block: number; timestamp: number; feeWei: bigint; ok: boolean }
    >(null),
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
    [listedSymbols, setListedSymbols] = useState<string[]>([]),
    [bridgeTargetSymbol, setBridgeTargetSymbol] = useState("BTC"),
    [tokenDetailSymbol, setTokenDetailSymbol] = useState(""),
    [chartRange, setChartRange] = useState<"1D" | "1W" | "1M" | "1Y">("1D"),
    [chartPoints, setChartPoints] = useState<{ t: number; p: number }[]>([]),
    [chartLoading, setChartLoading] = useState(false),
    [marketReturnPage, setMarketReturnPage] = useState("tokens"),
    [swapReturnPage, setSwapReturnPage] = useState("home"),
    [bridgeReturnPage, setBridgeReturnPage] = useState("home"),
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
  // What the owner is bringing in on the import step. The secret itself goes in
  // `mnemonic` either way; the vault tells a key from a phrase by its shape.
  const [importKind, setImportKind] = useState<"phrase" | "key">("phrase");
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
  const [phraseCopied, setPhraseCopied] = useState(false);
  const [revealedKey, setRevealedKey] = useState<{
    index: number;
    address: string;
    privateKey: string;
  } | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);
  // The backup check picks words rather than typing them: each slot holds the
  // index into `mnemonic`'s own words that was tapped for it (not the bank's
  // shuffled position), so a picked chip can be found and hidden regardless
  // of where it landed in the shuffle.
  const [pickedChips, setPickedChips] = useState<(number | null)[]>([null, null, null]),
    // -1: no slot's word list is open. A slot only opens on tap — nothing
    // is shown until the owner asks for it.
    [activeAnswerSlot, setActiveAnswerSlot] = useState(-1);
  const [amount, setAmount] = useState(""),
    [amountInUsd, setAmountInUsd] = useState(false),
    [usdAmountInput, setUsdAmountInput] = useState(""),
    [recipient, setRecipient] = useState(""),
    [spendAmount, setSpendAmount] = useState(""),
    [spendTo, setSpendTo] = useState(""),
    // A merchant's payment link being paid: it fixes the amount and the payee.
    [spendLink, setSpendLink] = useState<payLinks.PayLink | null>(null),
    [pendingPay, setPendingPay] = useState<string | null>(null),
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
    [reviewDetailsOpen, setReviewDetailsOpen] = useState(false),
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
  // Keeps a recipient's balance current without a manual pull-to-refresh. A
  // plain send settles on-chain the moment it confirms, and a private
  // send/bridge already pays out through its own backend interval job (see
  // backend/src/private-send.ts and private-bridge.ts) — neither depends on
  // anyone tapping "Check status" in the sender's Activity; that button only
  // ever re-reads the sender's own local history entry. What was actually
  // missing was this side ever re-reading its own balance without being
  // told to. Foreground-only, and on the slow side (25s), to avoid
  // multiplying load the way the CoinGecko rate limit already did once this
  // session — this only reduces staleness, not eliminate it; a push/socket
  // channel would be the instant version if that's ever worth building.
  useEffect(() => {
    if (!owner) return;
    const interval = setInterval(() => {
      if (AppState.currentState === "active") void refresh();
    }, 25_000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [owner]);
  // Transaction notifications (core/notify.js). Two listeners feed one
  // announcer: a request held open with Tera, answered the moment a token
  // transfer to or from this wallet lands, and a once-a-minute read of the
  // explorer that catches plain ETH moves and whatever arrived while the app
  // was closed. `alertSeen` keeps one payment from being announced twice.
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const alertSeen = useRef(new Set<string>());
  const alertAssets = useRef<Record<string, { symbol: string; decimals: number }>>({});
  const alertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alertsOn = !!owner && !data.alerts?.off;
  function announce(items: notify.Heard[], since = 0) {
    const own = new Set(
      dataRef.current.history.map((h) => String(h.hash || "").toLowerCase()).filter(Boolean),
    );
    const list = notify.core.fresh(items, { seen: alertSeen.current, own, since }) as notify.Heard[];
    for (const item of items) alertSeen.current.add(item.hash.toLowerCase());
    const shown = notify.core.batch(list);
    if (!shown) return;
    const book = contactsCore.cleanBook(dataRef.current.contacts);
    const who = (address: string) =>
      (isAddress(address) && contactsCore.nameFor(book, address)) ||
      (isAddress(address) ? contactsCore.short(address) : address);
    const lineFor = (item: notify.Heard) => ({
      title:
        item.direction === "receive"
          ? t(`Received ${item.amount} ${item.symbol}`, `收到 ${item.amount} ${item.symbol}`)
          : t(`Sent ${item.amount} ${item.symbol}`, `已发送 ${item.amount} ${item.symbol}`),
      body:
        item.direction === "receive"
          ? t(`From ${who(item.counterparty)}`, `来自 ${who(item.counterparty)}`)
          : t(`To ${who(item.counterparty)}, from another device`, `发往 ${who(item.counterparty)}，来自另一台设备`),
    });
    // Kept for the notifications page: every item, not just what the banner showed.
    const now = Date.now();
    const kept = (shown.items as notify.Heard[]).map((item) => ({
      hash: item.hash.toLowerCase(),
      direction: item.direction,
      ...lineFor(item),
      at: item.timestamp && item.timestamp < now ? item.timestamp : now,
    }));
    const alertsNow = dataRef.current.alerts || {};
    void store({
      ...dataRef.current,
      alerts: { ...alertsNow, items: [...kept, ...(alertsNow.items || [])].slice(0, 100) },
    }).catch(() => {});
    let title: string, body: string;
    if (shown.kind === "summary") {
      title = t("While you were away", "离开期间");
      body = t(
        `${shown.received} received, ${shown.sent} sent. See Activity for each one.`,
        `收到 ${shown.received} 笔，发出 ${shown.sent} 笔。在记录中查看详情。`,
      );
    } else {
      const [first, ...rest] = shown.items as notify.Heard[];
      ({ title, body } = lineFor(first));
      if (rest.length) body += t(` · and ${rest.length} more`, ` · 另有 ${rest.length} 笔`);
    }
    const hash = shown.items[0].hash;
    setTxAlert({ title, body, hash });
    if (alertTimer.current) clearTimeout(alertTimer.current);
    alertTimer.current = setTimeout(() => setTxAlert(null), 6000);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    notify.showSystem(title, body, hash, () => setPage("notifications"));
    void refresh();
  }
  useEffect(() => {
    if (!alertsOn) return;
    let live = true;
    let cursor: string | null = null;
    let failures = 0;
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const address = owner;
    void (async () => {
      while (live) {
        // A phone's JS stops in the background anyway; the web keeps
        // listening so a hidden tab can still raise a browser notification.
        if (!notify.notifyAvailable() || (Platform.OS !== "web" && AppState.currentState !== "active")) {
          await pause(5000);
          continue;
        }
        try {
          const heard = await notify.waitOnce(address, cursor);
          if (!live || address !== ownerRef.current) return;
          failures = 0;
          if (cursor !== null && heard.events.length)
            announce(notify.core.describe(heard.events, alertAssets.current) as notify.Heard[]);
          if (heard.gap) void sweepAlerts();
          cursor = heard.cursor;
        } catch {
          failures += 1;
          await pause(Math.min(60_000, 2000 * 2 ** failures));
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [alertsOn, owner]);
  const sweeping = useRef(false);
  async function sweepAlerts() {
    const address = ownerRef.current;
    if (!address || sweeping.current) return;
    sweeping.current = true;
    try {
      const entries = await fetchChainHistory(address as Address, t);
      if (address !== ownerRef.current) return;
      setChainHistory(entries);
      const alerts = dataRef.current.alerts || {};
      // The first read on a wallet that has never listened announces nothing:
      // its whole history is not news.
      const since = alerts.lastSeen === undefined ? Infinity : alerts.lastSeen + 1;
      announce(
        entries.filter((e) => e.status === "confirmed"),
        since,
      );
      const newest = Math.max(alerts.lastSeen ?? Date.now(), ...entries.map((e) => e.timestamp || 0));
      if (newest !== alerts.lastSeen)
        await store({ ...dataRef.current, alerts: { ...alerts, lastSeen: newest } });
    } catch {
      // The explorer is a convenience; the next read tries again.
    } finally {
      sweeping.current = false;
    }
  }
  useEffect(() => {
    if (!alertsOn) return;
    alertSeen.current = new Set();
    void sweepAlerts();
    const interval = setInterval(() => {
      if (Platform.OS === "web" || AppState.currentState === "active") void sweepAlerts();
    }, 60_000);
    return () => clearInterval(interval);
  }, [alertsOn, owner]);
  // The network label: read the chain every PROBE_MS while the app is in view.
  const inView = () =>
    Platform.OS === "web"
      ? typeof document === "undefined" || document.visibilityState !== "hidden"
      : AppState.currentState === "active";
  const probing = useRef(false);
  const probeNow = async () => {
    if (probing.current) return;
    probing.current = true;
    try {
      setNetReading(await probeNetwork());
    } finally {
      probing.current = false;
    }
  };
  useEffect(() => {
    if (!owner) return;
    void probeNow();
    const interval = setInterval(() => {
      if (inView()) void probeNow();
    }, networkSpeed.PROBE_MS);
    return () => clearInterval(interval);
  }, [owner]);
  // Business notes are re-read on Activity, since Reports may have changed them.
  useEffect(() => {
    if (!business || !owner || !biz.sharesNotesWithReports) return;
    if (page !== "activity" && page !== "activity-detail") return;
    let live = true;
    void biz
      .loadNotes()
      .then((loaded) => live && setBizNotes(loaded))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [business, owner, page]);
  // The open Activity row's block, time and fee, read when it opens.
  useEffect(() => {
    setDetailSpeed(null);
    setNoteDraft(null);
    if (page !== "activity-detail" || !activityDetail) return;
    let live = true;
    const hash = activityDetail;
    void confirmation(hash as `0x${string}`).then((found) => {
      if (live) setDetailSpeed(found ? { hash, ...found } : { hash, missing: true });
    });
    return () => {
      live = false;
    };
  }, [page, activityDetail]);
  // Opening the notifications page marks everything read. The dots on this
  // visit still show what was new as of when it was opened.
  const notificationsReadAt = useRef(0);
  useEffect(() => {
    if (page !== "notifications" || !owner) return;
    notificationsReadAt.current = dataRef.current.alerts?.readAt ?? 0;
    const newest = dataRef.current.alerts?.items?.[0]?.at ?? 0;
    if (newest > notificationsReadAt.current)
      void store({
        ...dataRef.current,
        alerts: { ...dataRef.current.alerts, readAt: Date.now() },
      }).catch(() => {});
  }, [page, owner]);
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
  useEffect(() => {
    if (page !== "token-detail" || !tokenDetailSymbol) return;
    let live = true;
    setChartLoading(true);
    void api(`/api/assets/prices/history?symbol=${tokenDetailSymbol}&range=${chartRange}`)
      .then((result) => live && setChartPoints(result.points || []))
      .catch(() => live && setChartPoints([]))
      .finally(() => live && setChartLoading(false));
    return () => {
      live = false;
    };
  }, [page, tokenDetailSymbol, chartRange]);
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
    if (!ExpoSpeechRecognitionModule) {
      setNotice({
        title: t("Voice input unavailable", "语音输入不可用"),
        body: t(
          "Voice input is available in the installed Tera app. Type your message in Expo Go.",
          "语音输入可在已安装的 Tera 应用中使用。请在 Expo Go 中输入消息。",
        ),
        tone: "error",
      });
      return;
    }
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
    [contactQuery, setContactQuery] = useState(""),
    [alertPriceInput, setAlertPriceInput] = useState(""),
    [alertCondition, setAlertCondition] = useState<"above" | "below">("above");

  useEffect(() => {
    const alertList = data.priceAlerts;
    if (!Array.isArray(alertList) || !alertList.length || !prices || !Object.keys(prices).length) return;
    const { updatedAlerts, triggeredAlerts } = evaluatePriceAlerts(alertList, prices);
    if (triggeredAlerts.length > 0) {
      triggeredAlerts.forEach((alert) => {
        setNotice({
          title: t(`Price Alert: ${alert.symbol}`, `价格预警：${alert.symbol}`),
          body: t(
            `${alert.symbol} target price of $${alert.targetPrice.toLocaleString()} reached! (${alert.condition === "above" ? "≥" : "≤"} current price: ${prices[alert.symbol] ? "$" + prices[alert.symbol].toLocaleString() : ""})`,
            `${alert.symbol} 目标价格 $${alert.targetPrice.toLocaleString()} 已到达！（${alert.condition === "above" ? "≥" : "≤"} 当前价格：${prices[alert.symbol] ? "$" + prices[alert.symbol].toLocaleString() : ""}）`,
          ),
          tone: "success",
        });
      });
      void run(() => store({ ...dataRef.current, priceAlerts: updatedAlerts }));
    }
  }, [prices, data.priceAlerts]);
  // Limit orders are checked against every price the wallet reads. An order that
  // reaches its price becomes ready and is announced once; it fills only when
  // the owner signs.
  useEffect(() => {
    if (!owner || !Array.isArray(data.limitOrders) || !data.limitOrders.length) return;
    if (!prices || Object.keys(prices).length < 2) return;
    const result = limitCore.evaluate(data.limitOrders, prices);
    if (!result.changed) return;
    void store({ ...dataRef.current, limitOrders: result.orders }).catch(() => {});
    for (const order of result.ready) {
      const body = limitCore.readyText(order);
      const title =
        order.kind === "stop"
          ? t("Stop-loss reached", "已触及止损")
          : order.kind === "take"
            ? t("Take-profit reached", "已触及止盈")
            : t("Limit order ready", "限价单已就绪");
      setNotice({ title, body, tone: order.kind === "stop" ? "error" : "success" });
      notify.showSystem(title, body, `limit:${order.id}`, () => setPage("limit-orders"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prices, data.limitOrders, owner]);
  useEffect(() => {
    if (page !== "swap") setLimitRun(null);
  }, [page]);
  // Saved names, cleaned on every read: the stored list is whatever the file held.
  const book = contactsCore.cleanBook(data.contacts);
  const watchedList = watchedCore.sortedWatched(data.watched);
  const watchedKey = watchedList.map((entry: any) => entry.address).join(",");
  /** What a watched wallet holds is valued with the same rule as the owner's, and never added to it. */
  function watchedValuation(address: string) {
    const held = watchBalances[address];
    return held
      ? valueCore.totalValue(
          assets.map((asset) => ({
            symbol: asset.symbol,
            amount: formatUnits(BigInt(held[asset.symbol] || "0"), asset.decimals),
          })),
          prices,
        )
      : null;
  }
  async function readWatched(addresses: string[]) {
    const rows = await Promise.all(
      addresses.map(async (address) => {
        try {
          return [address, await balances(address as Address, assets)] as const;
        } catch {
          return [address, null] as const;
        }
      }),
    );
    setWatchBalances((current) => ({ ...current, ...Object.fromEntries(rows) }));
  }
  useEffect(() => {
    if (!owner || !watchedKey || (page !== "home" && page !== "watching")) return;
    void readWatched(watchedKey.split(","));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, watchedKey, owner, assets.length]);
  useEffect(() => {
    if (page !== "watch-view" || !watchOpen) return;
    let live = true;
    setWatchHistory(null);
    void readWatched([watchOpen]);
    void fetchChainHistory(watchOpen as Address, t)
      .then((entries) => live && setWatchHistory(entries))
      .catch(() => live && setWatchHistory([]));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, watchOpen]);
  function openWatchForm(address = "") {
    const existing = address ? watchedCore.watchedFor(dataRef.current.watched, address) : null;
    setWatchError("");
    setWatchForm({
      address: existing ? existing.address : "",
      name: existing?.name || "",
      editing: !!existing,
    });
    setPage("watch-add");
  }
  async function saveWatchForm(guard: () => void) {
    setWatchError("");
    let address = watchForm.address.trim();
    let tag = "";
    if (address.startsWith("@")) {
      const found = await tags.resolveTag(address);
      guard();
      tag = found.tag;
      address = found.address;
    }
    const result = watchedCore.watch(dataRef.current.watched, {
      address,
      name: watchForm.name,
      tag,
      own: [owner, ...accounts.map((entry) => entry.address)].filter(Boolean),
    });
    if (!result.ok) {
      setWatchError(result.reason);
      return;
    }
    await store({ ...dataRef.current, watched: result.list });
    guard();
    setWatchOpen(result.entry.address);
    setPage("watch-view");
  }
  const scheduleToday = schedulesCore.today();
  const dueScheduled = owner ? schedulesCore.duePayments(data.schedules, scheduleToday) : [];
  const dueScheduledKey = dueScheduled.map(schedulesCore.reminderKey).join(",");
  const scheduleAnnounced = useRef(new Set<string>());
  useEffect(() => {
    if (page !== "send" && page !== "swap") setScheduleRun(null);
  }, [page]);
  // One reminder per due payment per session, from the browser's own
  // notifications when the app is in the background. The home card shows them
  // regardless, until each is paid or skipped.
  useEffect(() => {
    for (const due of dueScheduled) {
      const key = schedulesCore.reminderKey(due);
      if (scheduleAnnounced.current.has(key)) continue;
      scheduleAnnounced.current.add(key);
      notify.showSystem(
        due.schedule.kind === "buy"
          ? t("Recurring buy due", "定期买入到期")
          : t("Scheduled payment due", "定期付款到期"),
        schedulesCore.reminderText(due, scheduleToday, scheduleName(due.schedule)),
        key,
        () => setPage("scheduled"),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dueScheduledKey]);
  function scheduleName(schedule: any) {
    return (
      contactsCore.nameFor(book, schedule.recipient) ||
      (schedule.tag ? tags.display(schedule.tag) || "" : `${schedule.recipient.slice(0, 6)}…${schedule.recipient.slice(-4)}`)
    );
  }
  function openScheduleForm(id = "", kind: "payment" | "buy" = "payment") {
    const existing = id ? schedulesCore.scheduleFor(dataRef.current.schedules, id) : null;
    setScheduleEditId(existing ? existing.id : "");
    setScheduleError("");
    const formKind = existing?.kind || kind;
    setScheduleForm({
      kind: formKind,
      label: existing?.label || "",
      recipient: existing
        ? (existing.tag && tagsAvailable() ? tags.display(existing.tag) || "" : existing.recipient)
        : "",
      asset: existing?.asset || (formKind === "buy" ? "TERA" : "USDG"),
      amount: existing?.amount || "",
      frequency: existing?.frequency || (formKind === "buy" ? "weekly" : "monthly"),
      start: existing?.start || schedulesCore.today(),
      end: existing?.end || "",
    });
    setPage("schedule-edit");
  }
  async function saveScheduleForm(guard: () => void) {
    setScheduleError("");
    const existing = scheduleEditId
      ? schedulesCore.scheduleFor(dataRef.current.schedules, scheduleEditId)
      : null;
    let recipientAddress = (scheduleForm.recipient || "").trim();
    let tag = "";
    // A tag is resolved now so the schedule holds an address, and again when
    // each payment is made, because a tag can change hands in between.
    if (scheduleForm.kind !== "buy" && recipientAddress.startsWith("@")) {
      const found = await tags.resolveTag(recipientAddress);
      guard();
      tag = found.tag;
      recipientAddress = found.address;
    }
    const result = schedulesCore.parseSchedule(
      { ...scheduleForm, recipient: recipientAddress, tag },
      { owner, existing },
    );
    if (!result.ok) {
      setScheduleError(result.reason);
      return;
    }
    const saved = schedulesCore.saveSchedule(dataRef.current.schedules, result.schedule);
    if (!saved.ok) {
      setScheduleError(saved.reason);
      return;
    }
    await store({ ...dataRef.current, schedules: saved.schedules });
    guard();
    setPage("scheduled");
    setNotice({
      title: existing
        ? t("Schedule updated", "定期计划已更新")
        : result.schedule.kind === "buy"
          ? t("Recurring buy set", "已设置定期买入")
          : t("Payment scheduled", "已设置定期付款"),
      body: t(
        `${result.schedule.label}: ${schedulesCore.describeFrequency(result.schedule).toLowerCase()}, first on ${result.schedule.start}. You'll be reminded when it's due, and you sign each payment.`,
        `${result.schedule.label}：首次付款日期 ${result.schedule.start}。到期时会提醒你，每笔付款都需你签名。`,
      ),
      tone: "success",
    });
  }
  async function settleScheduled(
    id: string,
    date: string,
    status: "paid" | "skipped",
    hash = "",
    fill: { spent?: string; received?: string; estimated?: boolean } = {},
  ) {
    const result = schedulesCore.settle(dataRef.current.schedules, id, date, { status, hash, ...fill });
    if (!result.ok) throw new Error(result.reason);
    await store({ ...dataRef.current, schedules: result.schedules });
  }
  const limitList = limitCore.sortedOrders(data.limitOrders);
  const readyOrders = limitList.filter((order: any) => order.status === "ready");
  const limitTradable = (symbol: string) =>
    symbol !== "USDG" && (symbol === "ETH" || symbol === "TERA" || listedSymbols.includes(symbol));
  function openLimitForm(id = "", preset: { asset?: string; side?: string } = {}) {
    const existing = id ? limitCore.orderFor(dataRef.current.limitOrders, id) : null;
    setLimitEditId(existing ? existing.id : "");
    setOrderError("");
    const asset = existing?.asset || (preset.asset && limitTradable(preset.asset) ? preset.asset : "TERA");
    setLimitForm({
      side: existing?.side || preset.side || "buy",
      asset,
      amount: existing?.amount || "",
      limit: existing?.limit || "",
      expiry: existing?.expiry || "week",
    });
    setPage("limit-edit");
  }
  async function saveLimitForm(guard: () => void) {
    setOrderError("");
    const existing = limitEditId ? limitCore.orderFor(dataRef.current.limitOrders, limitEditId) : null;
    const parsed = limitCore.parseOrder(limitForm, { existing });
    if (!parsed.ok) {
      setOrderError(parsed.reason);
      return;
    }
    // An order whose price is already met is ready at once, rather than waiting for the next refresh.
    const evaluated = limitCore.evaluate([parsed.order], prices).orders[0] || parsed.order;
    const saved = limitCore.saveOrder(dataRef.current.limitOrders, evaluated);
    if (!saved.ok) {
      setOrderError(saved.reason);
      return;
    }
    await store({ ...dataRef.current, limitOrders: saved.orders });
    guard();
    setPage("limit-orders");
    setNotice({
      title: evaluated.status === "ready" ? t("Limit order ready", "限价单已就绪") : t("Limit order placed", "已设置限价单"),
      body:
        evaluated.status === "ready"
          ? t(
              `${limitCore.describeOrder(evaluated)}. The price is already there, so it's ready to sign now.`,
              `${limitCore.describeOrder(evaluated)}。价格已达到，可立即签名。`,
            )
          : t(
              `${limitCore.describeOrder(evaluated)}. You'll be told when the price gets there, and you sign it then.`,
              `${limitCore.describeOrder(evaluated)}。价格到达时会通知你，届时由你签名。`,
            ),
      tone: "success",
    });
  }
  /** Read this wallet's staking positions, fixed locks and recent payouts. */
  async function loadStaking() {
    if (!owner) return;
    setStakeError("");
    try {
      const [positions, locks, payouts, epochs, config] = await Promise.all([
        api(`/api/staking/position/${owner}`),
        api(`/api/staking/locks/${owner}`).catch(() => ({ locks: [] })),
        api(`/api/staking/payouts/${owner}`).catch(() => ({ payouts: [] })),
        api("/api/staking/epochs").catch(() => ({ epochs: [] })),
        api("/api/staking/config").catch(() => null),
      ]);
      setStakeData({
        positions: positions.positions || [],
        locks: locks.locks || [],
        payouts: payouts.payouts || [],
        epochs: epochs.epochs || [],
        config,
      });
    } catch (error) {
      setStakeData(null);
      setStakeError(error instanceof Error ? error.message : t("Staking is unavailable right now.", "质押服务暂不可用。"));
    }
  }
  /**
   * Ask the staking service to credit a signed deposit, retrying while it waits
   * for confirmations. Each hash is worked on once at a time; a deposit that is
   * still not credited stays pending and is tried again next time.
   */
  const crediting = useRef(new Set<string>());
  async function creditPending(entry: any) {
    const key = entry.txHash.toLowerCase();
    if (crediting.current.has(key)) return;
    crediting.current.add(key);
    try {
      const request = stakingCore.creditRequest(entry);
      for (let attempt = 0; attempt < 20; attempt += 1) {
        let outcome = "error";
        let reason = "";
        try {
          outcome = stakingCore.creditOutcome(await api(request.path, request.body));
        } catch (error) {
          reason = error instanceof Error ? error.message : String(error);
        }
        if (outcome === "credited") {
          await store({
            ...dataRef.current,
            stakingPending: stakingCore.resolvePending(dataRef.current.stakingPending, entry.txHash),
          });
          setCreditState((current) => ({ ...current, [key]: "credited" }));
          setNotice({
            title: t("Stake credited", "质押已记入"),
            body:
              entry.kind === "fixed"
                ? t(`Your ${entry.termDays}-day lock is active.`, `你的 ${entry.termDays} 天锁定已生效。`)
                : t("Your flexible stake is earning rewards.", "你的活期质押已开始赚取奖励。"),
            tone: "success",
          });
          void loadStaking();
          return;
        }
        setCreditState((current) => ({ ...current, [key]: outcome === "waiting" ? "waiting" : reason || "error" }));
        await new Promise((resolve) => setTimeout(resolve, 12_000));
      }
    } finally {
      crediting.current.delete(key);
    }
  }
  useEffect(() => {
    if (page !== "staking" || !owner) return;
    for (const entry of stakingCore.pendingFor(dataRef.current.stakingPending, owner)) void creditPending(entry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, owner]);
  /** Stake TERA: prepare the transfer, check it on the device, review and sign it, then credit it. */
  async function stakeNow(guard: () => void) {
    const config = stakeData?.config;
    check(config?.poolAddress && config?.tokenAddress, t("Staking is unavailable right now.", "质押服务暂不可用。"));
    const amount = BigInt(units(stakeAmount, 18));
    check(amount > 0n, t("Enter an amount of TERA to stake.", "请输入要质押的 TERA 数量。"));
    const held = BigInt(balance?.TERA || "0");
    check(amount <= held, t(`You have ${tera(held)} TERA.`, `你有 ${tera(held)} TERA。`));
    const fixed = stakeTerm !== "flexible";
    const epoch = stakingCore.activeEpoch(stakeData?.epochs);
    check(fixed || epoch, t("There is no active staking epoch to join right now.", "目前没有可加入的质押周期。"));
    const prepared = await api("/api/staking/prepare-deposit", {
      amount: amount.toString(),
      ...(fixed ? { termDays: Number(stakeTerm) } : {}),
    });
    guard();
    const tx = prepared.preparedTransaction;
    const want = { token: config.tokenAddress, pool: config.poolAddress, amount, chainId: chain.id };
    const issue = stakingCore.depositIssue(tx, want);
    check(!issue, issue);
    check(same(prepared.poolAddress, config.poolAddress), t("The staking pool changed. Try again.", "质押池已变更，请重试。"));
    const reward = fixed ? stakingCore.fixedReward(amount, Number(stakeTerm)) : 0n;
    const apr = fixed ? null : stakingCore.flexibleApr(epoch, amount);
    void presentReview({
      title: t("Review stake", "审核质押"),
      rows: [
        [t("Amount", "金额"), `${tera(amount)} TERA`],
        [
          t("Type", "类型"),
          fixed
            ? t(`Fixed ${stakeTerm}-day lock`, `固定 ${stakeTerm} 天锁定`)
            : t("Flexible — unstake any time", "活期——随时解押"),
        ],
        fixed
          ? [t("Guaranteed reward", "保证奖励"), `${tera(reward)} TERA`]
          : [t("Current rate (variable)", "当前利率（浮动）"), apr === null ? "—" : `≈ ${apr.toFixed(2)}% / yr`],
        ...(fixed
          ? [[t("Unlocks", "解锁时间"), new Date(Date.now() + Number(stakeTerm) * 86_400_000).toLocaleDateString()] as [string, string]]
          : []),
        [t("Sent to", "发送至"), config.poolAddress],
      ],
      steps: [tx],
      verify: () => {
        const again = stakingCore.depositIssue(tx, want);
        if (again) throw new Error(again);
      },
      recipient: config.poolAddress,
      activityType: "send",
      returnTo: "staking",
      afterSubmitted: async (hash: string) => {
        const entry = {
          kind: fixed ? "fixed" : "flexible",
          termDays: fixed ? Number(stakeTerm) : undefined,
          epochId: fixed ? undefined : epoch.id,
          txHash: hash,
          owner,
          amount: amount.toString(),
        };
        await store({
          ...dataRef.current,
          stakingPending: stakingCore.addPending(dataRef.current.stakingPending, entry),
        });
        setStakeAmount("");
        void creditPending(entry);
      },
    });
  }
  const tera = (value: string | number | bigint | null | undefined) =>
    shortAmount(formatUnits(BigInt(String(value ?? "0").split(".")[0] || "0"), 18));
  useEffect(() => {
    if (page !== "staking" || !owner) return;
    void loadStaking();
    // Payouts move from requested to paid within a minute or two; keep the screen current.
    const timer = setInterval(() => void loadStaking(), 20_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, owner]);
  /** Protect a holding with a stop-loss and/or take-profit, suggested from the average cost when known. */
  function openProtect(symbol: string) {
    const heldNow = allHeld.find(({ asset }) => asset.symbol === symbol);
    const row = pnlSummary?.rows.find((entry: any) => entry.symbol === symbol);
    const levels = limitCore.suggestLevels({ average: row?.average ?? null, price: prices[symbol] ?? null });
    setProtectError("");
    setProtectForm({
      asset: symbol,
      amount: heldNow ? heldNow.amount : "",
      stop: levels.stop,
      take: levels.take,
      useStop: "yes",
      useTake: "yes",
      from: levels.from,
      expiry: "never",
    });
    setPage("protect");
  }
  async function saveProtect(guard: () => void) {
    setProtectError("");
    const result = limitCore.protect(dataRef.current.limitOrders, {
      asset: protectForm.asset,
      amount: protectForm.amount,
      stop: protectForm.useStop === "yes" ? protectForm.stop : "",
      take: protectForm.useTake === "yes" ? protectForm.take : "",
      expiry: protectForm.expiry,
      price: prices[protectForm.asset],
    });
    if (!result.ok) {
      setProtectError(result.reason);
      return;
    }
    await store({ ...dataRef.current, limitOrders: result.orders });
    guard();
    setPage("limit-orders");
    setNotice({
      title: t("Holding protected", "已设置保护"),
      body: t(
        `${result.created.map((order: any) => limitCore.describeOrder(order)).join(". ")}.${result.created.length === 2 ? " Whichever is reached first cancels the other." : ""} You'll be told when one is ready, and you sign the sale.`,
        `${result.created.map((order: any) => limitCore.describeOrder(order)).join("。")}。${result.created.length === 2 ? "先触发的一方会自动取消另一方。" : ""}就绪时会通知你，卖出由你签名。`,
      ),
      tone: "success",
    });
  }
  /** Open the swap screen with a ready order written out; the limit is enforced when it is prepared. */
  function executeLimit(order: any) {
    check(order.status === "ready", t("This order isn't ready yet.", "此订单尚未就绪。"));
    check(
      assets.some((a) => a.symbol === order.asset),
      t(`${order.asset} is not available to trade right now.`, `${order.asset} 目前无法交易。`),
    );
    setError("");
    setSwapReturnPage("limit-orders");
    setSwapReceivePicker(false);
    setTrade(order.side === "buy" ? "BUY" : "SELL");
    setAssetSymbol(order.asset);
    clearAmount();
    setAmount(order.amount);
    setPage("swap");
    setLimitRun({ id: order.id, side: order.side, asset: order.asset, kind: order.kind, limit: order.limit });
  }
  /** Open the normal send screen with this payment written out. Nothing is sent until the owner signs. */
  function payScheduled(schedule: any) {
    const next = schedulesCore.nextPayment(schedule);
    check(next, t("This schedule has no payments left.", "此定期付款已无剩余付款。"));
    if (schedule.kind === "buy") {
      check(
        assets.some((a) => a.symbol === schedule.asset),
        t(`${schedule.asset} is not available to buy right now.`, `${schedule.asset} 目前无法买入。`),
      );
      // The swap screen, filled in. The owner reads the live quote and signs.
      setError("");
      setSwapReturnPage("scheduled");
      setSwapReceivePicker(false);
      setTrade("BUY");
      setAssetSymbol(schedule.asset);
      clearAmount();
      setAmount(schedule.amount);
      setPage("swap");
      setScheduleRun({
        id: schedule.id,
        date: next!.date,
        label: schedule.label,
        kind: "buy",
        asset: schedule.asset,
        amount: schedule.amount,
      });
      return;
    }
    check(
      assets.some((a) => a.symbol === schedule.asset),
      t(`${schedule.asset} is not available to send right now.`, `${schedule.asset} 目前无法发送。`),
    );
    setError("");
    setAssetSymbol(schedule.asset);
    clearAmount();
    setAmount(schedule.amount);
    if (schedule.tag && tagsAvailable()) {
      setRecipient(tags.display(schedule.tag) || "");
      setRecipientKind("tag");
    } else {
      setRecipient(schedule.recipient);
      setRecipientKind("address");
    }
    setTagLookup({ state: "idle" });
    setPayNote(schedule.label);
    setSendMode("public");
    // The recipient step, so a tag is resolved again and lookalike checks run.
    setFlowStep(3);
    setPage("send");
    setScheduleRun({
      id: schedule.id,
      date: next!.date,
      label: schedule.label,
      kind: "payment",
      asset: schedule.asset,
      amount: schedule.amount,
    });
  }
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
    setRevealedKey(null);
    setKeyCopied(false);
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
    setUsdAmountInput("");
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
    setBizEmail(null);
    if (!business || !owner || !biz.emailAvailable()) return;
    let live = true;
    void biz
      .linkedEmail(owner)
      .then((found) => live && setBizEmail(found?.email ?? null))
      .catch(() => {});
    return () => {
      live = false;
    };
    // Re-read when the email screen is left, so a new link shows at once.
  }, [business, owner, page === "biz-email"]);
  /**
   * Close this wallet and open the other one's door. The vault is switched
   * after locking and before forget() re-reads it, so the unlock screen that
   * follows asks for the other wallet's PIN, or offers to create it.
   */
  function switchMode(next: biz.Mode) {
    if (next === "business") setBizSplash(true);
    vault.lock();
    biz.setMode(next);
    setBizMode(next);
    forget();
  }
  useEffect(() => {
    // Asked once, on launch, and never retried in a loop: an update is not
    // urgent enough to keep a phone talking to the network about it.
    // Preview only: production is distributed through Google Play, which
    // does not grant the install-packages permission this flow needs and
    // handles updates itself (see app.config.js).
    if (upd.installedChannel() === "preview") void upd.checkForUpdate().then(setUpdate);
    // Whether this deployment keeps a tag register at all. Off until it says
    // yes, so a failed call hides the controls rather than offering ones that
    // cannot work.
    void tags.loadTagConfig().then(setTagsOn);
    // Whether a business can be paid at an email here. Web only; off on the phone.
    void biz.loadEmailConfig().then(setEmailOn);
    void biz.loadTeamsConfig();
    void payLinks.loadPayLinksConfig();
    void notify.loadNotifyConfig();
    // A payment link opened on the web arrives as ?pay=…. It is taken off the
    // address bar at once and opened on the Spend screen after unlock.
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const id = payLinks.parseLink(window.location.search);
      if (id) {
        setPendingPay(id);
        const url = new URL(window.location.href);
        url.searchParams.delete("pay");
        window.history.replaceState(null, "", url.toString());
      }
    }
  }, []);
  useEffect(() => {
    if (!owner || !pendingPay) return;
    const id = pendingPay;
    setPendingPay(null);
    openPayLink(id);
  }, [owner, pendingPay]);
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
        const lockMins = dataRef.current.autoLockMinutes ?? 15;
        if (lockMins > 0) {
          backgroundLock.current = setTimeout(() => {
            if (AppState.currentState === "background" && !pending.current) forget();
          }, Math.min(lockMins * 60_000, 60_000));
        }
      }
    });
    const timer = setInterval(() => {
      const lockMins = dataRef.current.autoLockMinutes ?? 15;
      if (
        lockMins > 0 &&
        vault.isUnlocked() &&
        !pending.current &&
        Date.now() - inactivity.current > lockMins * 60_000
      )
        forget();
    }, 10_000);
    return () => {
      subscription.remove();
      clearInterval(timer);
      if (backgroundLock.current) clearTimeout(backgroundLock.current);
      vault.lock();
    };
  }, []);
  useEffect(() => {
    // Fast Refresh can preserve screen state while the effect cleanup locks the
    // vault. Never leave a transaction review visible for a locked session.
    if (owner && !vault.isUnlocked()) forget();
  }, [owner]);
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
      ref.current.measureInWindow((x, y, width, height) => {
        const origin = screenOrigin();
        resolve({ x: x - origin.x, y: y - origin.y, width, height });
      });
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
          // The tour points at the personal home screen, which a business wallet does not show.
          if (!business) startTour();
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
    const sparklinesPromise = api("/api/assets/prices/sparklines").catch(() => ({
      sparklines: {},
      ranks: {},
    }));
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
    ].sort((a, b) => {
      const priority = ["TERA", "ETH", "USDG", "WETH", "BTC", "SOL"];
      const ai = priority.indexOf(a.symbol.toUpperCase());
      const bi = priority.indexOf(b.symbol.toUpperCase());
      return (
        (ai < 0 ? priority.length : ai) - (bi < 0 ? priority.length : bi) ||
        a.symbol.localeCompare(b.symbol)
      );
    });
    // What a transfer heard from Tera is named by: its token's contract.
    alertAssets.current = Object.fromEntries(
      supported
        .filter((a) => a.address && a.address !== zeroAddress)
        .map((a) => [a.address.toLowerCase(), { symbol: a.symbol, decimals: a.decimals }]),
    );
    const [balanceResult, pricesResult, sparklinesResult, tagResult] = await Promise.allSettled([
      balances(address, supported),
      pricesPromise,
      sparklinesPromise,
      tagPromise,
    ]);
    if (version !== vault.sessionVersion()) return;
    setListedSymbols(registry.map((asset) => asset.symbol.toUpperCase()));
    if (balanceResult.status === "fulfilled") setBalance(balanceResult.value);
    else
      setError(
        t("Could not refresh balances. Pull again when connected.", "无法刷新余额，请联网后重试。"),
      );
    if (pricesResult.status === "fulfilled") {
      setPrices(pricesResult.value.prices || { USDG: 1 });
      setPriceChanges(pricesResult.value.change24h || {});
    }
    if (sparklinesResult.status === "fulfilled") {
      setSparklines(sparklinesResult.value.sparklines || {});
      setRanks(sparklinesResult.value.ranks || {});
    }
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
  const allHeld = balance
    ? assets
        .map((asset) => ({
          asset,
          amount: formatUnits(BigInt(balance[asset.symbol] || "0"), asset.decimals),
        }))
        .filter(({ amount }) => Number(amount) > 0)
    : [];
  // Hiding small balances changes the list, never the total: what is held back
  // is still owned, still counted, and still stated as a count underneath. A
  // holding nobody could price is never treated as small — core/discretion.js
  // has the reasoning.
  const privacyOn = !!data.privacy;
  const smallHidden = discretion.partitionSmall(
    allHeld.map((row) => ({
      ...row,
      symbol: row.asset.symbol,
      value: valueCore.valueOf(row.amount, prices[row.asset.symbol]),
    })),
    { on: !!data.hideSmall, threshold: data.hideSmallThreshold },
  );
  const [showHidden, setShowHidden] = useState(false);
  const held = showHidden ? allHeld : smallHidden.shown;
  // ---- Profit and loss, and the real portfolio chart (core/pnl.js) ----
  const pnlFresh = !!pnlLegs && pnlLegs.owner === owner;
  const pnlEvents = React.useMemo(
    () => (pnlFresh ? pnlCore.groupEvents(pnlLegs!.legs) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pnlLegs, owner],
  );
  const pnlHoldings: Record<string, number> = Object.fromEntries(
    allHeld.map(({ asset, amount }) => [asset.symbol, Number(amount)]),
  );
  const pnlPriceAt = (symbol: string, t: number) => {
    for (const range of ["1D", "1W", "1M", "1Y"] as const) {
      const price = pnlCore.priceNear(pnlHistory[range]?.[symbol], t, pnlCore.RANGES[range].gap);
      if (price !== null) return price;
    }
    return null;
  };
  const pnlSummary = pnlFresh
    ? pnlCore.summarise({
        book: pnlCore.positions(pnlEvents, pnlPriceAt),
        holdings: pnlHoldings,
        prices,
        overrides: data.pnlOverrides || {},
      })
    : null;
  const portfolioChart = pnlFresh
    ? pnlCore.portfolioSeries({
        holdings: pnlHoldings,
        events: pnlEvents,
        series: pnlHistory[portfolioRange] || {},
        range: portfolioRange,
      })
    : null;
  async function loadPnlHistory(range: string, symbols: string[]) {
    const missing = symbols.filter((symbol) => symbol !== "USDG" && !pnlHistory[range]?.[symbol]);
    if (!missing.length) return;
    const rows = await Promise.all(
      missing.map(async (symbol) => {
        try {
          const result = await api(`/api/assets/prices/history?symbol=${symbol}&range=${range}`);
          return [symbol, (result.points || []) as { t: number; p: number }[]] as const;
        } catch {
          return [symbol, [] as { t: number; p: number }[]] as const;
        }
      }),
    );
    setPnlHistory((current) => ({
      ...current,
      [range]: { ...(current[range] || {}), ...Object.fromEntries(rows) },
    }));
  }
  useEffect(() => {
    if (!owner || !["home", "pnl", "token-detail"].includes(page)) return;
    if (pnlLegs && pnlLegs.owner === owner && Date.now() - pnlLegs.at < 5 * 60_000) return;
    let live = true;
    const known = Object.fromEntries(
      assets.filter((a) => a.address && a.address !== zeroAddress).map((a) => [a.address.toLowerCase(), a.symbol]),
    );
    void fetchTransferLegs(owner as Address, known)
      .then((result) => live && setPnlLegs({ owner, at: Date.now(), ...result }))
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, owner, assets.length]);
  // Prices for every symbol the history touches: a year of daily prices for costs,
  // and the chart's own range for the line.
  const pnlSymbolsKey = pnlFresh
    ? [...new Set([...Object.keys(pnlHoldings), ...pnlLegs!.legs.map((leg) => leg.symbol)])].sort().join(",")
    : "";
  useEffect(() => {
    if (!pnlSymbolsKey) return;
    const symbols = pnlSymbolsKey.split(",");
    void loadPnlHistory("1Y", symbols);
    void loadPnlHistory(portfolioRange, symbols);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pnlSymbolsKey, portfolioRange]);
  /** "+$42.10" / "−$3.00", in the display currency. */
  const signedFiat = (value: number) =>
    `${pnlCore.sign(value)}${formatFiat(Math.abs(value), data.fiatCurrency || "USD")}`;
  const signedPct = (value: number | null) =>
    value === null ? "" : `${pnlCore.sign(value)}${Math.abs(value).toFixed(1)}%`;
  /** A figure as the owner has asked to see it. Never used where they sign. */
  const shownValue = (text: string, context = "") =>
    discretion.conceal(text, { on: privacyOn, context });
  // Local history first (it has the richer detail — payee, bridge/relay
  // reference, delivery status — none of which exists on chain), then
  // whatever confirmed on-chain activity isn't already in it. That gap is
  // exactly what's missing on a second device or a fresh install of this
  // same wallet.
  const combinedHistory = [
    ...data.history.filter((h) => !h.totalSteps || h.step === h.totalSteps),
    ...(chainHistory || [])
      .filter((c) => !data.history.some((h) => h.hash === c.hash))
      .map((c) => ({
        hash: c.hash,
        title: c.title,
        direction: c.direction,
        amount: c.amount,
        symbol: c.symbol,
        counterparty: c.counterparty,
        counterpartyAddress: c.counterpartyAddress,
        fromChain: true,
        step: 1,
        totalSteps: 1,
        status: c.status,
        createdAt: c.timestamp,
      })),
  ].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  // Notes on transactions. In Business they are the Reports notes, so either
  // screen shows what the other wrote; in the wallet they sit in its own data.
  const sharedNotes = business && biz.sharesNotesWithReports;
  const txNotes: Record<string, string> = sharedNotes ? bizNotes : data.notes || {};
  async function saveTxNote(hash: string, text: string) {
    if (sharedNotes) {
      await biz.saveNote(hash, text);
      setBizNotes(await biz.loadNotes());
    } else {
      await store({ ...dataRef.current, notes: notesCore.setNote(dataRef.current.notes, hash, text) });
    }
  }
  function activityKind(row: any): "send" | "receive" | "swap" | "bridge" {
    if (row.direction === "send" || row.direction === "receive") return row.direction;
    if (row.activityType === "send" || row.activityType === "swap" || row.activityType === "bridge") return row.activityType;
    if (row.bridgeInput || row.isPrivateBridge) return "bridge";
    if (row.payee || (row.recipient && row.recipient.toLowerCase() !== owner.toLowerCase())) return "send";
    if (row.actionHash || row.title?.includes("proposal") || row.title?.includes("提案")) return "swap";
    return "send";
  }
  function activityTitle(row: any) {
    if (!/^(Review |审核)/.test(row.title || "")) return row.title;
    const kind = activityKind(row);
    return kind === "bridge" ? t("Bridged assets", "已跨链转移")
      : kind === "swap" ? t("Swapped assets", "已兑换资产")
      : t("Sent assets", "已发送资产");
  }
  function activityStatus(status: string) {
    return status === "confirmed" ? t("Completed", "已完成")
      : status === "broadcasting" ? t("Sending", "发送中")
      : status === "pending" ? t("Pending", "待确认")
      : status === "failed" || status === "reverted" ? t("Failed", "失败")
      : status;
  }
  function openActivityReview(row: any) {
    const snapshot = row.reviewSnapshot as ReviewSnapshot | undefined;
    setReviewDetailsOpen(false);
    setReview({
      title: t("Transaction review", "交易审核"),
      historical: true,
      historyNote: snapshot
        ? t("Saved review from before this transaction was signed.", "此交易签名前保存的审核记录。")
        : t("The original proposal is not saved on this device. These are the recorded transaction details.", "此设备没有保存原始提案。以下为已记录的交易详情。"),
      rows: snapshot?.rows ?? [
        [t("Transaction", "交易"), activityTitle(row)],
        [t("Status", "状态"), row.status],
        [t("Hash", "交易哈希"), row.hash],
      ],
      steps: snapshot?.steps ?? [],
      verify: () => {},
    });
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
  function clearAmount() {
    setAmount("");
    setUsdAmountInput("");
    setAmountInUsd(false);
    setAmountInvalid(false);
  }
  function amountDisplay() {
    return amountInUsd ? usdAmountInput : amount;
  }
  function usablePrice(symbol: string) {
    const price = prices[symbol];
    return Number.isFinite(price) && price > 0 && Number(price.toFixed(12)) > 0 ? price : null;
  }
  function setAmountDisplay(symbol: string, decimals: number, value: string) {
    if (!amountInUsd) {
      setAmount(value);
      return;
    }
    const input = value.replace(",", ".");
    if (!/^\d*(\.\d{0,8})?$/.test(input)) return;
    setUsdAmountInput(input);
    const price = usablePrice(symbol);
    if (!price || !input || input === ".") {
      setAmount("");
      return;
    }
    const usdUnits = parseUnits(input.endsWith(".") ? `${input}0` : input, 12);
    const priceUnits = parseUnits(price.toFixed(12), 12);
    const tokenUnits = (usdUnits * 10n ** BigInt(decimals)) / priceUnits;
    setAmount(formatUnits(tokenUnits, decimals));
  }
  function selectAmountMode(symbol: string, useUsd: boolean) {
    if (useUsd === amountInUsd || (useUsd && !usablePrice(symbol))) return;
    if (useUsd) {
      const estimate = Number(amount || 0) * (usablePrice(symbol) || 0);
      setUsdAmountInput(
        amount && Number.isFinite(estimate) ? String(Number(estimate.toFixed(8))) : "",
      );
    }
    setAmountInUsd(useUsd);
  }
  function amountModeToggle(symbol: string) {
    const priceAvailable = !!usablePrice(symbol);
    return (
      <View
        style={{
          flexDirection: "row",
          padding: 4,
          borderRadius: 14,
          backgroundColor: colors.wash,
          gap: 4,
        }}
      >
        {([false, true] as const).map((useUsd) => (
          <Pressable
            key={useUsd ? "usd" : "token"}
            accessibilityRole="button"
            accessibilityState={{
              selected: amountInUsd === useUsd,
              disabled: useUsd && !priceAvailable,
            }}
            disabled={useUsd && !priceAvailable}
            onPress={() => selectAmountMode(symbol, useUsd)}
            style={{
              minWidth: 66,
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: 10,
              alignItems: "center",
              backgroundColor: amountInUsd === useUsd ? colors.raised : "transparent",
              opacity: useUsd && !priceAvailable ? 0.4 : 1,
            }}
          >
            <Text
              style={[
                s.small,
                { fontWeight: "700", color: amountInUsd === useUsd ? colors.ink : colors.muted },
              ]}
            >
              {useUsd ? "USD" : symbol}
            </Text>
          </Pressable>
        ))}
      </View>
    );
  }
  function usdEstimate(symbol: string, tokenAmount: string) {
    const price = usablePrice(symbol);
    const value = Number(tokenAmount) * (price || 0);
    return price && Number.isFinite(value) ? valueCore.format(value) : null;
  }
  function amountCounterpart(symbol: string) {
    if (amountInUsd) return `${amount || "0"} ${symbol}`;
    const estimate = usdEstimate(symbol, amount || "0");
    return estimate
      ? `\u2248 ${estimate}`
      : t("USD value unavailable", "\u7f8e\u5143\u4f30\u503c\u6682\u4e0d\u53ef\u7528");
  }
  /** A payment's value in dollars, as USDG base units; null when it has no price. */
  function paymentUsd(symbol: string, raw: string | bigint, decimals: number): string | null {
    if (symbol === spendCore.STABLE) return BigInt(raw).toString();
    const price = usablePrice(symbol);
    if (!price) return null;
    const priceUnits = parseUnits(price.toFixed(12), 12);
    return ((BigInt(raw) * priceUnits) / 10n ** BigInt(decimals) / 10n ** 6n).toString();
  }
  /** Why a payment breaks a limit, in words, or "" when it fits. */
  function limitProblem(usd: string | null) {
    const result = limitsCore.check({
      limits: dataRef.current.limits,
      amount: usd === null ? null : BigInt(usd),
      rows: combinedHistory,
    });
    if (result.ok) return "";
    const dollars = spendCore.formatDollars;
    if (result.kind === "unpriced")
      return t(
        "This asset has no price right now, so it can't be checked against your spending limits. Nothing was sent.",
        "此资产当前没有价格，无法按你的消费限额检查。未发送任何内容。",
      );
    if (result.kind === "perPayment")
      return t(
        `This payment is ${dollars(result.after)}, over your ${dollars(result.limit)} limit per payment.`,
        `此笔付款为 ${dollars(result.after)}，超过你的单笔限额 ${dollars(result.limit)}。`,
      );
    return result.kind === "daily"
      ? t(
          `This would take today's payments to ${dollars(result.after)}, over your ${dollars(result.limit)} daily limit (${dollars(result.used)} paid so far).`,
          `这将使今日付款达到 ${dollars(result.after)}，超过每日限额 ${dollars(result.limit)}（今日已付 ${dollars(result.used)}）。`,
        )
      : t(
          `This would take this month's payments to ${dollars(result.after)}, over your ${dollars(result.limit)} monthly limit (${dollars(result.used)} paid so far).`,
          `这将使本月付款达到 ${dollars(result.after)}，超过每月限额 ${dollars(result.limit)}（本月已付 ${dollars(result.used)}）。`,
        );
  }
  /** Stop here when a payment breaks a limit. */
  function enforceLimits(usd: string | null) {
    const problem = limitProblem(usd);
    if (problem) throw new Error(problem);
  }
  function usdReviewRow(symbol: string, tokenAmount: string): [string, string] {
    return [
      t("Estimated USD", "\u9884\u8ba1\u7f8e\u5143\u4ef7\u503c"),
      usdEstimate(symbol, tokenAmount) ||
        t("Price unavailable", "\u4ef7\u683c\u6682\u4e0d\u53ef\u7528"),
    ];
  }
  /**
   * Check the destination before the review sheet, on the screen where it was
   * typed. An address is checked for shape; a tag is resolved against the
   * registry and the address it resolved to is shown, because that address is
   * what the owner is actually agreeing to.
   */
  /** A tag, or on the web a business email: whichever the owner typed. */
  const resolveName = (input: string) =>
    biz.isEmail(input) ? biz.resolveEmail(input) : tags.resolveTag(input);
  const nameLabel = (name: string) => (biz.isEmail(name) ? name : tags.display(name));
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
      const found = await resolveName(typed);
      setTagLookup({ state: "found", tag: found.tag, address: found.address });
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : t("Lookup failed.", "查询失败。");
      setTagLookup({ state: "error", message });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setNotice({
        title: biz.isEmail(typed) ? t("Email not found", "未找到邮箱") : t("Tag not found", "未找到标签"),
        body: message,
        tone: "error",
      });
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
      recipientKind === "tag" ? (await resolveName(recipient)).address : recipient.trim();
    guard();
    if (dataRef.current.trustedOnlyMode) {
      check(
        isTrustedRecipient(destination, book),
        t(
          "Trusted only mode is active. Recipient address must be saved in your contacts.",
          "受信任模式已启用。收款地址必须保存到联系人中。",
        ),
      );
    }
    const input = {
      ownerAddress: owner,
      accountAddress: owner,
      assetAddress: selectedAsset.address,
      actionType: "TRANSFER",
      recipient: destination,
      amount: units(amount, selectedAsset.decimals),
    };
    enforceLimits(paymentUsd(selectedAsset.symbol, input.amount, selectedAsset.decimals));
    transferTx(input.assetAddress as Address, input.recipient as Address, input.amount);
    const checked = await policyFor(input);
    guard();
    const result = await api("/api/intent/prepare", checked);
    guard();
    const proposal = { ...result, intent: checked, createdAt: Date.now() };
    await store({ ...dataRef.current, drafts: [...dataRef.current.drafts, proposal] });
    guard();
    const run = scheduleRun?.kind === "payment" ? scheduleRun : null;
    showProposal(proposal, {
      note: notesCore.cleanNote(payNote) || undefined,
      ...(run
        ? {
            afterSubmitted: async (hash: string) => {
              await settleScheduled(run.id, run.date, "paid", hash).catch(() => {});
            },
          }
        : {}),
    });
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
  function showProposal(p: any, extra: Partial<Review> = {}) {
    const steps = verifyProposal(p, owner);
    const i = p.intent || p.preparedTransaction.intent;
    const asset = assets.find((a) => a.address.toLowerCase() === i.assetAddress.toLowerCase());
    check(asset, t("Load the asset registry first.", "请先加载资产列表。"));
    const teraTrade = asset.symbol === "TERA";
    const input = i.actionType === "BUY" ? (teraTrade ? sources[1] : sources[0]) : asset;
    const q = p.preparedTransaction.quote;
    if (q) check(q.decimalsOut === (i.actionType === "BUY" ? asset.decimals : teraTrade ? 18 : 6));
    const isBatch = i.actionType === "TRANSFER" && Array.isArray(i.transfers) && i.transfers.length > 1;
    const rows: [string, string][] = [
      [t("Action", "操作"), isBatch ? t("Batch Transfer (Multicall3)", "批量转账 (Multicall3)") : i.actionType],
      [t("Send", "发送"), `${formatUnits(BigInt(i.amount), input.decimals)} ${input.symbol}`],
      usdReviewRow(input.symbol, formatUnits(BigInt(i.amount), input.decimals)),
      [t("Recipient", "收款地址"), isBatch ? t(`${i.transfers.length} recipients (Multicall3)`, `${i.transfers.length} 位收款人 (Multicall3)`) : (i.recipient || owner)],
    ];
    if (isBatch) {
      i.transfers.forEach((tr: any, idx: number) => {
        const trTag = tr.tag || (tr.recipient ? `${tr.recipient.slice(0, 6)}…${tr.recipient.slice(-4)}` : `#${idx + 1}`);
        rows.push([
          `${t("Recipient", "收款人")} ${idx + 1}`,
          `${trTag} · ${formatUnits(BigInt(tr.amount), input.decimals)} ${input.symbol}`,
        ]);
      });
    }
    const payee = i.actionType === "TRANSFER" ? i.recipient : undefined;
    const savedAs = payee ? contactsCore.nameFor(book, payee) : "";
    if (savedAs) rows.push([t("Saved as", "已保存为"), savedAs]);
    if (p.expiresAt) {
      const expDate = new Date(p.expiresAt);
      const isExp = expDate.getTime() <= Date.now();
      rows.push([
        t("Auto-Expires", "自动过期"),
        isExp
          ? t("Expired", "已过期")
          : `${expDate.toLocaleTimeString()} (${Math.max(1, Math.round((expDate.getTime() - Date.now()) / 3600000))}h)`,
      ]);
    }
    const swapSlippage = i.slippageBps ?? slippageCore.DEFAULT_SLIPPAGE_BPS;
    const swapMinimumOut = q ? formatUnits(slippageCore.swapMinimum(q, swapSlippage), q.decimalsOut) : "";
    const impact = q
      ? impactCore.assess(
          q.priceImpactPct,
          valueCore.valueOf(formatUnits(BigInt(i.amount), input.decimals), prices[input.symbol]),
        )
      : undefined;
    // A pool too thin for this amount is refused before the review opens.
    if (impact) check(impact.level !== "blocked", impactCore.message(impact));
    if (q) {
      rows.push([
        t("Expected output", "预计收到"),
        `${formatUnits(BigInt(q.amountOutWei), q.decimalsOut)} ${i.actionType === "BUY" ? asset.symbol : teraTrade ? "ETH" : "USDG"}`,
      ]);
      rows.push([t("Slippage limit", "滑点上限"), slippageCore.slippageLabel(swapSlippage)]);
      if (impact) rows.push([t("Price impact", "价格影响"), impactCore.rowText(impact)]);
      rows.push([t("Minimum output", "最低收到"), swapMinimumOut]);
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
      activityType: i.actionType === "TRANSFER" ? "send" : "swap",
      rows,
      steps,
      intelligenceInput: {
        language,
        action: language === "zh"
          ? i.actionType === "TRANSFER" ? "发送" : i.actionType === "BUY" ? `买入 ${asset.symbol}，支付` : `卖出 ${asset.symbol}，数量`
          : i.actionType === "TRANSFER" ? "send" : `${i.actionType.toLowerCase()} ${asset.symbol} using`,
        send: `${formatUnits(BigInt(i.amount), input.decimals)} ${input.symbol}`,
        recipient: payee,
        owner,
        knownRecipient: !!savedAs || !!data.history.some((h) => h.payee?.toLowerCase() === payee?.toLowerCase()),
        steps: steps.length,
        quote: q ? {
          route: q.route,
          comparedRoutes: q.comparedRoutes,
          priceImpactPct: q.priceImpactPct,
          amountOut: `${q.amountOut} ${i.actionType === "BUY" ? asset.symbol : teraTrade ? "ETH" : "USDG"}`,
          minimumOut: `${swapMinimumOut} ${i.actionType === "BUY" ? asset.symbol : teraTrade ? "ETH" : "USDG"}`,
          slippage: slippageCore.slippageLabel(swapSlippage),
        } : undefined,
      },
      verify: () => {
        verifyProposal(p, owner);
      },
      ...(impact ? { impact } : {}),
      recipient: i.recipient || owner,
      payee,
      actionHash: p.preparedTransaction.actionHash,
      draftId: p.createdAt,
      ...(i.actionType === "TRANSFER"
        ? { spendUsd: paymentUsd(input.symbol, i.amount, input.decimals) }
        : {}),
      ...extra,
    });
  }
  /**
   * Pay a dollar amount in USDG. The payee is resolved again here, for the
   * same reason as a send: the address signed is the one the register holds now.
   */
  async function preparePayment(guard: () => void) {
    const units = spendCore.dollarsToUnits(spendAmount);
    check(units !== null, t("Enter a dollar amount, to the cent.", "请输入美元金额，精确到分。"));
    const typed = spendTo.trim();
    const destination = isAddress(typed) ? typed : (await resolveName(typed)).address;
    guard();
    const link = spendLink;
    if (link) {
      // Read again: the merchant may have cancelled it, or someone paid it, since it opened.
      const fresh = await payLinks.viewLink(link.id);
      guard();
      check(
        fresh.status === "open",
        fresh.status === "paid"
          ? t("This link has already been paid.", "此链接已付款。")
          : t("The merchant cancelled this link.", "商家已取消此链接。"),
      );
      check(
        destination.toLowerCase() === fresh.merchant.toLowerCase() &&
          units === BigInt(fresh.amount),
        t("This payment no longer matches the link. Open the link again.", "此付款与链接不一致，请重新打开链接。"),
      );
    }
    const stable = assets.find((a) => a.symbol === spendCore.STABLE)?.address ?? USDG;
    const input = {
      ownerAddress: owner,
      accountAddress: owner,
      assetAddress: stable,
      actionType: "TRANSFER",
      recipient: destination,
      amount: units!.toString(),
    };
    enforceLimits(units!.toString());
    transferTx(input.assetAddress as Address, input.recipient as Address, input.amount);
    const checked = await policyFor(input);
    guard();
    const result = await api("/api/intent/prepare", checked);
    guard();
    const proposal = { ...result, intent: checked, createdAt: Date.now() };
    await store({ ...dataRef.current, drafts: [...dataRef.current.drafts, proposal] });
    guard();
    showProposal(proposal, {
      note: notesCore.cleanNote(payNote) || undefined,
      ...(link ? { afterSubmitted: (hash: string) => settleLink(link.id, hash) } : {}),
    });
  }
  /**
   * Tell Tera which transaction paid a link, once it is on chain — Tera reads
   * it there before marking the link paid. Tried twice; a failure never
   * undoes the payment, which has already gone.
   */
  async function settleLink(id: string, hash: string) {
    try {
      await client.waitForTransactionReceipt({ hash: hash as `0x${string}`, timeout: 60000 });
    } catch {
      // Reported anyway: the service answers "not on chain yet" if so.
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await payLinks.reportPaid(id, hash);
        setSpendLink(null);
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 4000));
      }
    }
  }
  // Not through run(): a link from the address bar opens as unlock finishes,
  // while run() is still busy with the unlock and would drop it.
  function openPayLink(id: string) {
    const version = vault.sessionVersion();
    payLinks
      .viewLink(id)
      .then((link) => {
        if (version !== vault.sessionVersion()) return;
        setError("");
        setSpendLink(link);
        setPayNote(notesCore.cleanNote(link.note));
        setSpendAmount(spendCore.unitsToAmount(BigInt(link.amount)));
        setSpendTo(link.merchant);
        setPage("spend");
      })
      .catch((e) => {
        if (version !== vault.sessionVersion()) return;
        setNotice({
          title: t("Payment link", "收款链接"),
          body: e instanceof Error ? e.message : t("This link could not be opened.", "无法打开此链接。"),
          tone: "error",
        });
      });
  }
  /**
   * Sell enough ETH for USDG to cover a payment — its own swap, reviewed and
   * signed on its own. It waits for the swap to confirm so the balance the
   * spend screen comes back to already holds the dollars.
   */
  async function prepareTopUp(guard: () => void, wei: bigint) {
    const input = {
      ownerAddress: owner,
      accountAddress: owner,
      assetAddress: assets.find((a) => a.symbol === "ETH")?.address ?? sources[1].address,
      actionType: "SELL",
      amount: wei.toString(),
    };
    const checked = await policyFor(input);
    guard();
    const result = await api("/api/intent/prepare", checked);
    guard();
    const p = { ...result, intent: checked, createdAt: Date.now() };
    await store({ ...dataRef.current, drafts: [...dataRef.current.drafts, p] });
    guard();
    showProposal(p, {
      title: t("Review top-up", "审核充值"),
      returnTo: "spend",
      afterSubmitted: async (hash) => {
        try {
          await client.waitForTransactionReceipt({ hash: hash as `0x${string}`, timeout: 60000 });
        } catch {
          // Still pending: the screen shows the balance as it stands, and it
          // updates on the next refresh.
        }
      },
    });
  }
  function openSpend() {
    setError("");
    setPayNote("");
    setSpendLink(null);
    setSpendAmount("");
    setSpendTo("");
    setPage("spend");
  }
  async function prepareTrade(guard: () => void) {
    const prepareWith = async (bps: number) => {
      const input = {
        ownerAddress: owner,
        accountAddress: owner,
        assetAddress: selectedAsset.address,
        actionType: trade,
        amount: units(
          amount,
          trade === "BUY" ? (selectedAsset.symbol === "TERA" ? 18 : 6) : selectedAsset.decimals,
        ),
        slippageBps: bps,
      };
      const checked = await policyFor(input);
      guard();
      const result = await api("/api/intent/prepare", checked);
      guard();
      return { ...result, intent: checked, createdAt: Date.now() };
    };
    // A ready limit order, if this swap is still the trade it describes.
    const limitOrder =
      limitRun &&
      selectedAsset.symbol === limitRun.asset &&
      trade === (limitRun.side === "buy" ? "BUY" : "SELL")
        ? limitCore.orderFor(dataRef.current.limitOrders, limitRun.id)
        : null;
    let p = await prepareWith(slippageBps);
    let limitTight = false;
    if (limitOrder && limitOrder.status === "ready" && limitOrder.kind !== "stop") {
      // The minimum output is set from the limit price, so a price that moved back
      // past the limit makes the swap revert instead of filling worse.
      const q = p.preparedTransaction?.quote;
      check(q, t("No live quote is available right now.", "目前没有可用的实时报价。"));
      const minimum = limitCore.limitMinimum({
        side: limitOrder.side,
        asset: limitOrder.asset,
        amount,
        limit: limitOrder.limit,
        decimalsOut: q.decimalsOut,
        ethPrice: prices.ETH || 0,
      });
      const plan = limitCore.slippageForLimit(q.amountOutWei, minimum, slippageBps);
      check(plan.ok, plan.reason);
      if (plan.bps !== slippageBps) {
        p = await prepareWith(plan.bps);
        const q2 = p.preparedTransaction?.quote;
        check(
          q2 && (plan.tight || slippageCore.swapMinimum(q2, plan.bps) >= minimum),
          t("The price moved while preparing. Try again.", "准备期间价格变动，请重试。"),
        );
      }
      limitTight = plan.tight;
    }
    await store({ ...dataRef.current, drafts: [...dataRef.current.drafts, p] });
    guard();
    // Tied to the recurring buy only while it is still the buy it describes.
    const run =
      scheduleRun?.kind === "buy" && trade === "BUY" && selectedAsset.symbol === scheduleRun.asset
        ? scheduleRun
        : null;
    const quote = p.preparedTransaction?.quote;
    const tokenOut = selectedAsset.address;
    const spent = amount;
    if (limitOrder && limitOrder.status === "ready" && quote) {
      if (limitTight)
        setNotice({
          title: t("Very close to your limit", "非常接近你的限价"),
          body: t(
            "The live price is within 0.1% of your limit, so the swap's minimum may be up to 0.1% below it.",
            "实时价格与限价相差不到 0.1%，兑换的最低收到可能比限价低至多 0.1%。",
          ),
          tone: "success",
        });
      // What a sell receives is the pair: USDG, or ETH (no token transfer to read) for TERA.
      const outToken =
        limitOrder.side === "buy" ? tokenOut : limitOrder.pair === "ETH" ? zeroAddress : USDG;
      showProposal(p, {
        afterSubmitted: async (hash: string) => {
          const quoted = formatUnits(BigInt(quote.amountOutWei), quote.decimalsOut);
          const filled = limitCore.fillOrder(dataRef.current.limitOrders, limitOrder.id, {
            hash,
            spent,
            received: quoted,
            estimated: true,
          });
          if (filled.ok) await store({ ...dataRef.current, limitOrders: filled.orders }).catch(() => {});
          void readReceived(hash, outToken, quote.decimalsOut).then((received) => {
            if (!received) return;
            void store({
              ...dataRef.current,
              limitOrders: limitCore.recordFill(dataRef.current.limitOrders, limitOrder.id, hash, received),
            }).catch(() => {});
          });
        },
      });
      return;
    }
    showProposal(
      p,
      run && quote
        ? {
            afterSubmitted: async (hash: string) => {
              const quoted = formatUnits(BigInt(quote.amountOutWei), quote.decimalsOut);
              await settleScheduled(run.id, run.date, "paid", hash, {
                spent,
                received: quoted,
                estimated: true,
              }).catch(() => {});
              void recordBuyFill(run.id, hash, tokenOut, quote.decimalsOut);
            },
          }
        : {},
    );
  }
  /**
   * Replace a recurring buy's quoted amount with what the transaction actually
   * delivered: the token transfers to this wallet in its receipt. Runs in the
   * background after signing; if the receipt cannot be read, the quoted amount
   * stays and stays marked as an estimate.
   */
  async function recordBuyFill(id: string, hash: string, token: string, decimals: number) {
    const received = await readReceived(hash, token, decimals);
    if (!received) return;
    await store({
      ...dataRef.current,
      schedules: schedulesCore.recordFill(dataRef.current.schedules, id, hash, received),
    }).catch(() => {});
  }
  /**
   * What a confirmed swap actually delivered to this wallet: the sum of the
   * token transfers to it in the receipt. "" when it cannot be read — native
   * ETH has no transfer to read, and a receipt can time out — in which case
   * the quoted figure stays, marked as an estimate.
   */
  async function readReceived(hash: string, token: string, decimals: number) {
    try {
      if (token === zeroAddress) return "";
      const receipt = await client.waitForTransactionReceipt({ hash: hash as Hex, timeout: 180_000 });
      if (receipt.status !== "success") return "";
      const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
      const toTopic = `0x${owner.slice(2).toLowerCase().padStart(64, "0")}`;
      let total = 0n;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== token.toLowerCase()) continue;
        if (log.topics[0]?.toLowerCase() !== transferTopic || log.topics[2]?.toLowerCase() !== toTopic) continue;
        total += BigInt(log.data);
      }
      return total > 0n ? formatUnits(total, decimals) : "";
    } catch {
      return "";
    }
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
      recipientKind === "tag" ? (await resolveName(recipient)).address : recipient.trim();
    guard();
    check(isAddress(destination), t("Enter a valid recipient address.", "请输入有效收款地址。"));
    const spendUsd = paymentUsd(asset, raw, decimals);
    enforceLimits(spendUsd);
    const created = await api("/api/private-send/jobs", {
      asset,
      amount: raw,
      senderAddress: owner,
      recipientAddress: destination,
    });
    guard();
    const tx = created.preparedDeposit;
    await presentReview({
      note: notesCore.cleanNote(payNote) || undefined,
      title: t("Review private route", "审核私密路由"),
      rows: [
        [t("Asset", "资产"), asset],
        [t("Amount", "金额"), `${amount} ${asset}`],
        usdReviewRow(asset, amount),
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
      spendUsd,
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
        usdReviewRow(source.symbol, amount),
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
        usdReviewRow(source.symbol, amount),
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
  async function loadApprovals() {
    if (!owner) return;
    setGrantsBusy(true);
    setGrantsError("");
    try {
      setGrants(await scanApprovals(owner as Address, assets));
    } catch {
      setGrantsError(t("Could not read approvals from the network. Try again.", "无法从网络读取授权，请重试。"));
    } finally {
      setGrantsBusy(false);
    }
  }
  function spenderLabel(spender: string) {
    const name = approvalRules.spenderName(spender, KNOWN_SPENDERS);
    return name ? t(name[0], name[1]) : `${spender.slice(0, 6)}…${spender.slice(-4)}`;
  }
  function grantAmount(grant: Grant) {
    if (grant.kind === "collection") return t("Every item in the collection", "该合集的全部藏品");
    if (approvalRules.isUnlimited(grant.amount ?? 0n)) return t(`Unlimited ${grant.symbol}`, `无限 ${grant.symbol}`);
    return `${formatUnits(grant.amount ?? 0n, grant.decimals)} ${grant.symbol}`;
  }
  function revokeApproval(grant: Grant) {
    try {
      const step = { ...approvalRules.revokeCall(grant), chainId: chain.id } as Tx;
      approvalRules.checkRevoke(step, grant);
      void presentReview({
        title: t("Revoke approval", "撤销授权"),
        rows: [
          [grant.kind === "collection" ? t("Collection", "合集") : t("Token", "代币"), grant.symbol],
          [t("Spender", "被授权方"), spenderLabel(grant.spender)],
          [t("Spender address", "被授权方地址"), grant.spender],
          [t("Can spend now", "当前可花费"), grantAmount(grant)],
          [t("After revoking", "撤销后"), t("Nothing", "无")],
        ],
        steps: [step],
        activityType: "revoke",
        returnTo: "settings",
        // No tokens move: only the network fee is paid.
        intent: { actionType: "REVOKE" },
        verify: () => approvalRules.checkRevoke(step, grant),
        afterSubmitted: async () => {
          setGrants((current) =>
            current?.filter((g) => !(g.kind === grant.kind && g.token === grant.token && g.spender === grant.spender)) ?? current,
          );
        },
      } as Review);
    } catch (e) {
      Alert.alert(t("Cannot revoke", "无法撤销"), String((e as Error)?.message || e));
    }
  }
  async function presentReview(next: Review) {
    setReviewDetailsOpen(false);
    setImpactAccepted(false);
    holdProgress.setValue(0);
    const shownRecipient = next.rows.find(([label]) =>
      label === t("Recipient", "收款地址") || label === t("Recipient", "收款方"))?.[1];
    const intelligenceRecipient = next.payee || shownRecipient || next.recipient;
    const input = next.intelligenceInput ?? {
      language,
      action: next.title === t("Review private route", "审核私密路由")
        ? t("send privately", "私密发送")
        : next.title === t("Review private bridge", "审核私密跨链")
          ? t("bridge privately", "私密跨链")
          : next.title === t("Review bridge", "审核跨链")
            ? t("bridge", "跨链转移")
            : next.title === t("Send NFT", "发送 NFT")
              ? t("send NFT", "发送 NFT")
              : next.title.replace(/^Review\s+/i, ""),
      send: next.rows.find(([label]) => label === t("Send", "发送") || label === t("Amount", "金额"))?.[1],
      recipient: intelligenceRecipient,
      owner,
      checkRecipientContract: next.title !== t("Review bridge", "审核跨链") && next.title !== t("Review private bridge", "审核私密跨链"),
      knownRecipient: !!intelligenceRecipient && (!!contactsCore.nameFor(book, intelligenceRecipient) || data.history.some((h) => h.payee?.toLowerCase() === intelligenceRecipient.toLowerCase())),
      steps: next.steps.length,
    };
    const tx0 = next.steps[0];
    const assetFound = assets.find((a) => same(a.address, tx0?.to) || next.rows.some(([l, v]) => v.includes(a.symbol)));
    const delta = calculateNetBalanceDelta({
      tx: tx0,
      intent: (next as any).intent || { actionType: next.activityType === "swap" ? "BUY" : "TRANSFER" },
      asset: assetFound,
      gasEstimate: "0.0001",
    });
    setReview({ ...next, netBalanceDelta: delta, simulation: "checking", intelligence: reviewIntelligence({ ...input, simulation: "checking" }) });
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
      const [codeResult, gasResult] = await Promise.allSettled([
        input.checkRecipientContract !== false && input.recipient && input.recipient.toLowerCase() !== owner.toLowerCase() && isAddress(input.recipient)
          ? client.getCode({ address: input.recipient as Address }) : Promise.resolve(undefined),
        Promise.all([
          client.getGasPrice(),
          Promise.all(next.steps.map((tx) => client.estimateGas({ account: owner as Address, to: tx.to, data: tx.data, value: BigInt(tx.value) }))),
        ]),
      ]);
      const feeWei = gasResult.status === "fulfilled"
        ? gasResult.value[0] * gasResult.value[1].reduce((sum, gas) => sum + gas, 0n)
        : undefined;
      const estimatedFeeEth = feeWei !== undefined ? (Number(feeWei) / 1e18).toFixed(6) : undefined;
      const recipientHasCode = codeResult.status === "fulfilled" && !!codeResult.value && codeResult.value !== "0x";
      const updatedDelta = calculateNetBalanceDelta({
        tx: tx0,
        intent: (next as any).intent || { actionType: next.activityType === "swap" ? "BUY" : "TRANSFER" },
        asset: assetFound,
        gasEstimate: estimatedFeeEth || "0.0001",
      });
      setReview({
        ...next,
        ...(feeWei !== undefined ? { feeWei: feeWei.toString() } : {}),
        netBalanceDelta: updatedDelta,
        simulation: "passed",
        intelligence: reviewIntelligence({
          ...input,
          simulation: "passed",
          recipientHasCode,
          recipientCodeUnavailable: codeResult.status === "rejected",
          estimatedFeeEth,
          gasEstimateUnavailable: gasResult.status === "rejected",
        }),
      });
    } catch {
      setReview({ ...next, netBalanceDelta: delta, simulation: "needs-attention", intelligence: reviewIntelligence({ ...input, simulation: "needs-attention" }) });
    }
  }
  async function signReview(r: Review) {
    if (!vault.isUnlocked()) {
      forget();
      setNotice({
        title: t("Wallet locked", "钱包已锁定"),
        body: t(
          "Unlock your wallet and review the transaction again.",
          "请解锁钱包并重新审核交易。",
        ),
        tone: "error",
      });
      return;
    }
    // A high price impact is signed only after the owner has accepted it.
    check(
      r.impact?.level !== "confirm" || impactAccepted,
      t("Accept the price impact before signing.", "签名前请先确认价格影响。"),
    );
    // Consume the review before broadcasting so a timeout cannot lead to a
    // second tap resending a bridge or transfer.
    r.verify();
    // Checked again here, not only when the payment was prepared: a review can
    // sit open while another payment goes out, or a limit is lowered.
    if (r.spendUsd !== undefined) {
      const problem = limitProblem(r.spendUsd);
      if (problem) {
        setReview(null);
        setNotice({ title: t("Over your spending limit", "超出消费限额"), body: problem, tone: "error" });
        return;
      }
    }
    setSigning(true);
    try {
      let submittedHash = "";
      const activityType = r.activityType ?? (r.bridgeInput || r.isPrivateBridge ? "bridge" : "send");
      const amountLabel = r.rows.find(([label]) =>
        label === t("Send", "发送") || label === t("Amount", "金额"))?.[1]
        ?? r.rows.find(([label]) => label === t("NFT", "NFT"))?.[1];
      const activityTitle = activityType === "revoke"
        ? t("Revoked approval", "已撤销授权")
        : activityType === "swap"
        ? t(`Swapped${amountLabel ? ` ${amountLabel}` : ""}`, `已兑换${amountLabel ? ` ${amountLabel}` : ""}`)
        : activityType === "bridge"
          ? t(`Bridged${amountLabel ? ` ${amountLabel}` : ""}`, `已跨链转移${amountLabel ? ` ${amountLabel}` : ""}`)
          : t(`Sent${amountLabel ? ` ${amountLabel}` : ""}`, `已发送${amountLabel ? ` ${amountLabel}` : ""}`);
      const displayedRecipient = r.payee ?? r.rows.find(([label]) =>
        label === t("Recipient", "收款地址") || label === t("Recipient", "收款方"))?.[1];
      await execute(
        r.steps,
        r.verify,
        async (record) => {
          if (record.step === record.totalSteps) submittedHash = record.hash;
          const row = {
            ...record,
            title: record.step === record.totalSteps ? activityTitle : t("Approval", "授权"),
            activityType: record.step === record.totalSteps ? activityType : "approval",
            activityAmount: record.step === record.totalSteps ? amountLabel : undefined,
            counterparty: record.step === record.totalSteps ? displayedRecipient : undefined,
            reviewSnapshot: record.step === record.totalSteps
              ? ({ rows: r.rows, steps: r.steps } satisfies ReviewSnapshot) : undefined,
            recipient: r.recipient,
            reference: record.step === record.totalSteps ? r.reference : undefined,
            bridgeInput: record.step === record.totalSteps ? r.bridgeInput : undefined,
            actionHash: record.step === record.totalSteps ? r.actionHash : undefined,
            isPrivateBridge: record.step === record.totalSteps ? r.isPrivateBridge : undefined,
            payee: record.step === record.totalSteps ? r.payee : undefined,
            spendUsd: record.step === record.totalSteps ? (r.spendUsd ?? undefined) : undefined,
          };
          // The note rides in the same write as the row, so neither can undo the other.
          const withNote =
            r.note && !sharedNotes && record.step === record.totalSteps
              ? notesCore.setNote(dataRef.current.notes, record.hash, r.note)
              : dataRef.current.notes;
          await store({
            ...dataRef.current,
            notes: withNote,
            history: [row, ...dataRef.current.history.filter((h) => h.hash !== row.hash)],
            drafts: dataRef.current.drafts.filter((d) => !r.draftId || d.createdAt !== r.draftId),
          });
        },
      );
      // Business notes live in the Reports book, a separate file, so they are written here.
      if (r.note && sharedNotes && submittedHash) await saveTxNote(submittedHash, r.note).catch(() => {});
      if (r.afterSubmitted && submittedHash) await r.afterSubmitted(submittedHash);
      setPage(r.returnTo ?? "activity");
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
      let prepared = result.preparedTransaction;
      let checked = result.intent;
      try {
        checked = await policyFor(result.intent);
      } catch {
        // Fall back to unchecked intent if policy bundle is unavailable
      }
      guard();
      if (!prepared) {
        prepared = await api("/api/intent/prepare", checked);
        guard();
      }
      const p = {
        ...prepared,
        intent: checked,
        createdAt: Date.now(),
        expiresAt:
          prepared?.expiresAt ||
          result?.expiresAt ||
          new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      };
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
  function requestPrivateKey(index: number) {
    authenticate(t("Show private key", "显示私钥"), async () => {
      setKeyCopied(false);
      setRevealedKey({ index, ...vault.exportPrivateKey(index) });
    });
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
  // On the web, `flex: 1` means a zero basis and views may shrink below their
  // content, so on a short window the header collapsed under the PIN pad.
  // Growing from its own height keeps the same centring without the overlap.
  const fillSpace =
    Platform.OS === "web" ? { flexGrow: 1, flexShrink: 0 } : { flex: 1 };
  const authHeader = (hero: React.ReactNode, titleNode: React.ReactNode, fill = true) => (
    <View
      style={fill ? { ...fillSpace, justifyContent: "center", gap: 24 } : { gap: 24, paddingTop: 4 }}
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
  const unreadAlerts = (data.alerts?.items || []).filter(
    (item) => item.at > (data.alerts?.readAt ?? 0),
  ).length;
  const netLevel = netReading?.level ?? null;
  const netColor =
    netLevel === "fast"
      ? colors.green
      : netLevel === "normal"
        ? colors.yellow
        : netLevel === "slow"
          ? colors.copper
          : netLevel === "down"
            ? colors.danger
            : colors.faint;
  const netWord =
    netLevel === "fast"
      ? t("Fast", "快速")
      : netLevel === "normal"
        ? t("Normal", "正常")
        : netLevel === "slow"
          ? t("Slow", "缓慢")
          : netLevel === "down"
            ? t("Offline", "离线")
            : t("Checking", "检测中");
  const netLatency = networkSpeed.formatLatency(netReading?.latencyMs);
  const duration = (ms: number | null | undefined) => {
    const text = networkSpeed.formatDuration(ms);
    return text === "under 1s" ? t("under 1s", "不到 1 秒") : text;
  };
  const networkControl = (compact: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(
        `Network: ${netWord}${netLatency ? `, ${netLatency}` : ""}`,
        `网络：${netWord}${netLatency ? `，${netLatency}` : ""}`,
      )}
      onPress={() => setPage("network")}
      hitSlop={6}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 34,
        paddingHorizontal: 11,
        borderRadius: 17,
        borderWidth: 1,
        borderColor: colors.line,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: netColor }} />
      <Text style={s.mono} numberOfLines={1}>
        {compact
          ? netLevel === "down" || !netLatency
            ? netWord
            : netLatency
          : netLatency && netLevel !== "down"
            ? `${netWord} · ${netLatency}`
            : netWord}
      </Text>
    </Pressable>
  );
  const bellControl = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        unreadAlerts
          ? t(`Notifications, ${unreadAlerts} new`, `通知，${unreadAlerts} 条新消息`)
          : t("Notifications", "通知")
      }
      onPress={() => setPage("notifications")}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 34,
        height: 34,
        borderRadius: 17,
        borderWidth: 1,
        borderColor: colors.line,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Icon name="bell" size={16} color={colors.ink} />
      {unreadAlerts ? (
        <View
          style={{
            position: "absolute",
            top: -4,
            right: -4,
            minWidth: 18,
            height: 18,
            paddingHorizontal: 4,
            borderRadius: 9,
            backgroundColor: colors.green,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: colors.paper, fontSize: 10, fontWeight: "800" }}>
            {unreadAlerts > 9 ? "9+" : unreadAlerts}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
  const languageControl = (
    <Pressable accessibilityRole="button" onPress={toggleLanguage}>
      <Text style={s.mono}>{language === "en" ? "中文" : "EN"}</Text>
    </Pressable>
  );
  // Tera Business opens on its own door; this is the way back to the personal one.
  const backToPersonal = business ? (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={() => switchMode("personal")}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        paddingVertical: 8,
        opacity: busy ? 0.4 : pressed ? 0.6 : 1,
      })}
    >
      <Icon name="wallet-outline" size={16} color={colors.green} />
      <Text style={[s.small, { color: colors.green, fontWeight: "600" }]}>
        {t("Back to Tera Wallet", "返回 Tera 钱包")}
      </Text>
    </Pressable>
  ) : null;
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
            business
              ? title(
                  "Tera Business.",
                  "Tera 商业版。",
                  t("Unlock your business wallet on this device.", "在此设备上解锁你的商业钱包。"),
                )
              : title(
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
          {vault.biometricsSupported && (
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
          )}
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
          {backToPersonal}
        </>
      );
    if (setup === "start")
      return (
        <>
          {authHeader(
            <WelcomeHero />,
            business
              ? title(
                  "Your business.\nYour treasury.",
                  "你的业务。\n你的资金库。",
                  t(
                    "A separate wallet for your business, with its own recovery phrase and PIN. It never mixes with your personal wallet.",
                    "为业务单独设立的钱包，拥有独立的助记词和 PIN，与个人钱包完全分开。",
                  ),
                )
              : title(
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
            {business ? t("Create business wallet", "创建商业钱包") : t("Create wallet", "创建钱包")}
          </Button>
          <Button onPress={() => goSetup("import")}>
            {business
              ? t("Import an existing wallet", "导入现有钱包")
              : t("I already have a wallet", "我已有钱包")}
          </Button>
          {backToPersonal}
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
    if (setup === "import") {
      const byKey = importKind === "key";
      const secretLabel = byKey ? t("Private key", "私钥") : t("Recovery phrase", "助记词");
      return (
        <>
          {authHeader(
            <Illustration />,
            title(
              "Welcome back.",
              "欢迎回来。",
              byKey
                ? t(
                    "Import the private key of one Ethereum account. A key opens that account only, so this wallet has no recovery phrase and cannot add more accounts.",
                    "导入一个以太坊账户的私钥。私钥只能打开该账户，因此此钱包没有助记词，也无法添加更多账户。",
                  )
                : t(
                    "Import a standard English recovery phrase. Uses the first Ethereum account; BIP-39 passphrases are not supported in this version.",
                    "导入标准英文助记词，使用第一个以太坊账户，此版本不支持 BIP-39 附加口令。",
                  ),
            ),
            false,
          )}
          <Choices
            options={[t("Recovery phrase", "助记词"), t("Private key", "私钥")]}
            value={secretLabel}
            select={(o) => {
              const next = o === t("Private key", "私钥") ? "key" : "phrase";
              if (next === importKind) return;
              // A phrase half-typed into the key field, or the reverse, is
              // never what the owner meant to import.
              setMnemonic("");
              setError("");
              setImportKind(next);
            }}
          />
          <View style={s.field}>
            <Text style={s.eyebrow}>{secretLabel}</Text>
            <View style={[s.input, { padding: 0, overflow: "hidden" }]}>
              <TextInput
                accessibilityLabel={secretLabel}
                placeholder={byKey ? "0x…" : undefined}
                placeholderTextColor={colors.muted}
                autoCorrect={false}
                autoCapitalize="none"
                value={mnemonic}
                onChangeText={setMnemonic}
                multiline={!byKey}
                secureTextEntry={false}
                autoComplete="off"
                importantForAutofill="noExcludeDescendants"
                style={{
                  minHeight: byKey ? 60 : mnemonic ? 110 : 60,
                  textAlignVertical: "top",
                  padding: 15,
                  color: colors.ink,
                  fontSize: 16,
                }}
              />
              {!mnemonic && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    byKey ? t("Paste private key", "粘贴私钥") : t("Paste recovery phrase", "粘贴助记词")
                  }
                  onPress={() =>
                    void Clipboard.getStringAsync()
                      .then((text) => {
                        if (text) setMnemonic(text);
                        else
                          setNotice({
                            title: t("Nothing to paste", "剪贴板为空"),
                            body: byKey
                              ? t(
                                  "Copy your private key first, then try again.",
                                  "请先复制私钥，然后重试。",
                                )
                              : t(
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
                if (byKey) {
                  walletFromPrivateKey(mnemonic);
                  setMnemonic(mnemonic.trim());
                } else {
                  walletFromPhrase(mnemonic);
                  setMnemonic(normalizePhrase(mnemonic));
                }
                goSetup("password");
              } catch {
                setError(
                  byKey
                    ? t(
                        "That is not a private key. It is 64 characters of 0–9 and a–f, with or without 0x.",
                        "这不是有效的私钥。私钥由 64 个 0–9 和 a–f 字符组成，可带 0x 前缀。",
                      )
                    : t("Check the phrase and word order.", "请检查助记词及顺序。"),
                );
              }
            }}
          >
            {t("Continue", "继续")}
          </Button>
        </>
      );
    }
    return (
      <>
        {authHeader(
          <Illustration />,
          password.length < 6
            ? title(
                "Protect this wallet.",
                "保护此钱包。",
                importKind === "key" && setupHistory.includes("import")
                  ? t(
                      "Choose a six-digit PIN. Use your private key if you forget it.",
                      "设置六码 PIN，忘记时可使用私钥恢复。",
                    )
                  : t(
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
    setPayNote("");
    if (p === "swap") setSwapReturnPage(page);
    if (p === "bridge") setBridgeReturnPage(page);
    setAssetSymbol(p === "swap" ? "ETH" : "USDG");
    clearAmount();
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
  function openTokenBuy(symbol: string) {
    if (symbol === "USDG") {
      openFlow("receive");
      return;
    }
    if (symbol !== "ETH" && symbol !== "TERA" && !listedSymbols.includes(symbol)) {
      if (!popularSymbols.has(symbol)) {
        setNotice({
          title: t("Trading unavailable", "\u4ea4\u6613\u6682\u4e0d\u53ef\u7528"),
          body: t(
            `There is no verified trade route for ${symbol} yet.`,
            `\u76ee\u524d\u6ca1\u6709 ${symbol} \u7684\u53ef\u9a8c\u8bc1\u4ea4\u6613\u8def\u7ebf\u3002`,
          ),
        });
        return;
      }
      setMarketReturnPage(page);
      setBridgeTargetSymbol(symbol);
      setPage("bridge-pending");
      return;
    }
    setAssetSymbol(symbol);
    setTrade("BUY");
    clearAmount();
    setSwapReturnPage(page);
    setPage("swap");
  }
  function openTokenDetail(symbol: string) {
    // Jumping to another token from the "More tokens" carousel while
    // already on a detail page must not overwrite where Back goes to with
    // "token-detail" itself — that's what made Back loop in place instead
    // of returning to wherever the flow was first opened from.
    if (page !== "token-detail") setMarketReturnPage(page);
    setTokenDetailSymbol(symbol);
    setChartRange("1D");
    setPage("token-detail");
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
    clearAmount();
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
          onLayout={() => {
            if (keyboardOpen) chatScrollRef.current?.scrollToEnd({ animated: true });
          }}
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
                  {d.expiresAt ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginVertical: 4 }}>
                      <View
                        style={{
                          paddingHorizontal: 8,
                          paddingVertical: 2,
                          borderRadius: 6,
                          backgroundColor:
                            new Date(d.expiresAt).getTime() <= Date.now()
                              ? colors.warnTint
                              : colors.tint,
                        }}
                      >
                        <Text
                          style={[
                            s.small,
                            {
                              color:
                                new Date(d.expiresAt).getTime() <= Date.now()
                                  ? colors.danger
                                  : colors.green,
                              fontWeight: "600",
                            },
                          ]}
                        >
                          {new Date(d.expiresAt).getTime() <= Date.now()
                            ? t("Expired", "已过期")
                            : t(
                                `Expires in ${Math.max(1, Math.round((new Date(d.expiresAt).getTime() - Date.now()) / 3600000))}h`,
                                `${Math.max(1, Math.round((new Date(d.expiresAt).getTime() - Date.now()) / 3600000))}小时后过期`,
                              )}
                        </Text>
                      </View>
                      <Text style={[s.small, { color: colors.muted }]}>
                        {t(
                          `Window: 24h · ${new Date(d.expiresAt).toLocaleTimeString()}`,
                          `窗口: 24小时 · ${new Date(d.expiresAt).toLocaleTimeString()}`,
                        )}
                      </Text>
                    </View>
                  ) : null}
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
  // A hand-rolled line chart (no charting library — react-native-svg is
  // already a dependency, and a plain line + gradient fill is all this
  // needs) for the token detail page. Coming-soon catalog coins get real
  // CoinGecko history; every other token's chart is only as long as this
  // server has actually been observing its on-chain quote, so a freshly
  // deployed backend or a token nobody's viewed before can look sparse —
  // that's a real limit of deriving history from a live process rather
  // than a data warehouse, not a bug to hide.
  function TokenChart({ points, up }: { points: { t: number; p: number }[]; up: boolean }) {
    if (chartLoading)
      return (
        <View style={{ height: 120, alignItems: "center", justifyContent: "center" }}>
          <TeraSpinner size={22} />
        </View>
      );
    if (points.length < 2)
      return (
        <View style={{ height: 120, alignItems: "center", justifyContent: "center" }}>
          <Text style={s.small}>{t("Not enough history yet", "历史数据尚不足")}</Text>
        </View>
      );
    const width = 320;
    const height = 120;
    const prices = points.map((point) => point.p);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const spanPrice = maxPrice - minPrice || 1;
    const minTime = points[0].t;
    const spanTime = points[points.length - 1].t - minTime || 1;
    const coords = points.map((point) => ({
      x: ((point.t - minTime) / spanTime) * width,
      y: height - ((point.p - minPrice) / spanPrice) * height,
    }));
    const linePath = coords
      .map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
      .join(" ");
    const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;
    const color = up ? colors.green : colors.danger;
    return (
      <Svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
      >
        <Defs>
          <SvgLinearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <Stop offset="100%" stopColor={color} stopOpacity={0} />
          </SvgLinearGradient>
        </Defs>
        <Path d={areaPath} fill="url(#chartFill)" stroke="none" />
        <Path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </Svg>
    );
  }
  // A placeholder row shaped like assetRow/marketRow, shown in their place
  // while the first balance/price fetch is still in flight.
  function tokenRowSkeleton(key: string | number, first: boolean) {
    return (
      <View
        key={`skeleton-${key}`}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingVertical: 12,
          borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
          borderColor: colors.line + "4d",
        }}
      >
        <Skeleton width={38} height={38} borderRadius={19} />
        <View style={{ flex: 1, gap: 6 }}>
          <Skeleton width={64} height={13} />
          <Skeleton width={44} height={11} />
        </View>
        <Skeleton width={56} height={13} />
      </View>
    );
  }
  // A tiny same-day line, drawn from real hourly points — never from just
  // the two endpoints of the 24h change, which would draw a straight
  // diagonal that looks like data but isn't.
  function Sparkline({
    points,
    up,
    width = 40,
    height = 20,
  }: {
    points: { t: number; p: number }[];
    up: boolean;
    width?: number;
    height?: number;
  }) {
    if (points.length < 2) return null;
    const values = points.map((point) => point.p);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const stepX = width / (points.length - 1);
    const path = points
      .map(
        (point, i) =>
          `${i === 0 ? "M" : "L"} ${(i * stepX).toFixed(1)} ${(height - ((point.p - min) / span) * height).toFixed(1)}`,
      )
      .join(" ");
    return (
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <Path
          d={path}
          fill="none"
          stroke={up ? colors.green : colors.danger}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </Svg>
    );
  }
  // Shared by the activity list row and its detail page, so a status badge
  // never reads differently depending on which screen drew it.
  function statusTone(status: string) {
    return status === "confirmed"
      ? { bg: colors.tint, color: colors.green }
      : status === "failed" || status === "reverted"
        ? { bg: colors.dangerTint, color: colors.danger }
        : { bg: colors.warnTint, color: colors.yellow };
  }
  // A small colored up/down indicator next to a token's price, from the
  // backend's rolling 24h change, with a same-day sparkline beside it when
  // one is available (real markets only — see the sparklines state comment).
  // Omitted (not zero) when there's no change data yet, e.g. right after the
  // server restarts.
  function trendTag(symbol: string) {
    const change = priceChanges[symbol];
    if (!Number.isFinite(change)) return null;
    const up = change >= 0;
    const points = sparklines[symbol];
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        {points?.length > 1 ? <Sparkline points={points} up={up} /> : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 1 }}>
          <Icon
            name={up ? "arrow-up" : "arrow-down"}
            size={11}
            color={up ? colors.green : colors.danger}
          />
          <Text style={[s.small, { color: up ? colors.green : colors.danger, fontWeight: "700" }]}>
            {Math.abs(change).toFixed(2)}%
          </Text>
        </View>
      </View>
    );
  }
  // Shared by the Home screen's compact list and the full Tokens screen, so
  // a held asset looks identical whichever one it's read from. Rows sit in
  // one shared panel from the caller, separated by a top hairline rather
  // than each being its own card — tapping the row opens the token's detail
  // page.
  function assetRow(asset: Asset, amount: string, first: boolean) {
    const pinned = isPinned(asset.symbol, pinnedAssets);
    return (
      <Pressable
        key={asset.symbol}
        accessibilityRole="button"
        onPress={() => openTokenDetail(asset.symbol)}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingVertical: 12,
          borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
          borderColor: colors.line + "4d",
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <TokenIcon symbol={asset.symbol} size={38} chainBadge />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={s.label}>{asset.symbol}</Text>
            <Pressable
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={pinned ? t(`Unpin ${asset.symbol}`, `取消置顶 ${asset.symbol}`) : t(`Pin ${asset.symbol}`, `置顶 ${asset.symbol}`)}
              onPress={(e: any) => {
                e?.stopPropagation?.();
                const next = togglePinned(asset.symbol);
                setPinnedAssetsState(next);
              }}
            >
              <Text style={{ fontSize: 15, color: pinned ? "#eab308" : colors.muted }}>
                {pinned ? "★" : "☆"}
              </Text>
            </Pressable>
          </View>
          <Text style={s.small} numberOfLines={1}>
            {shownValue(shortAmount(amount))}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 2 }}>
          <Text style={s.label}>
            {shownValue(formatFiat(valueCore.valueOf(amount, prices[asset.symbol]), data.fiatCurrency || "USD"))}
          </Text>
          {trendTag(asset.symbol)}
        </View>
      </Pressable>
    );
  }
  /**
   * What the list is not showing.
   *
   * A wallet that quietly stops mentioning something its owner holds is wrong
   * about what they hold, so hiding small balances always says how many and
   * what they come to, and the row is the control that shows them again.
   * Renders nothing when nothing is hidden.
   */
  function hiddenBalancesRow() {
    if (!smallHidden.hidden.length) return null;
    const worth = shownValue(formatFiat(smallHidden.hiddenValue, data.fiatCurrency || "USD"));
    return (
      <Pressable
        key="hidden-balances"
        accessibilityRole="button"
        accessibilityLabel={
          showHidden
            ? t("Hide small balances again", "重新隐藏小额余额")
            : t("Show hidden small balances", "显示隐藏的小额余额")
        }
        onPress={() => setShowHidden((on) => !on)}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingVertical: 12,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderColor: colors.line + "4d",
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text style={[s.small, { flex: 1 }]}>
          {smallHidden.hidden.length === 1
            ? t(`1 small balance hidden · ${worth}`, `已隐藏 1 项小额余额 · ${worth}`)
            : t(
                `${smallHidden.hidden.length} small balances hidden · ${worth}`,
                `已隐藏 ${smallHidden.hidden.length} 项小额余额 · ${worth}`,
              )}
        </Text>
        <Text style={[s.small, { color: colors.green }]}>
          {showHidden ? t("Hide", "隐藏") : t("Show", "显示")}
        </Text>
      </Pressable>
    );
  }
  // Rows sit in one shared panel from the caller (same convention as
  // assetRow above), not one card per token. Tapping the row opens the
  // token's detail page; tapping Buy — a nested Pressable — goes straight
  // to the buy flow without also opening the detail page underneath it.
  function marketRow(token: { symbol: string; name: string }, first: boolean) {
    const isListed =
      token.symbol === "ETH" || token.symbol === "TERA" || listedSymbols.includes(token.symbol);
    const canHoldHere =
      token.symbol === "TERA" || assets.some((asset) => asset.symbol === token.symbol);
    const price = prices[token.symbol];
    const actionLabel =
      token.symbol === "USDG"
        ? t("Add", "\u6dfb\u52a0")
        : isListed
          ? t("Buy", "\u4e70\u5165")
          : t("Coming soon", "\u5373\u5c06\u4e0a\u7ebf");
    // The Robinhood Chain badge on the icon already says where this token
    // lives; spelling it out again in text here was redundant. Only the
    // not-yet-tradable states still need words, since there's no icon cue
    // for those.
    const detail =
      isListed || token.symbol === "TERA"
        ? ""
        : canHoldHere
          ? t("Trading coming soon", "\u4ea4\u6613\u5373\u5c06\u4e0a\u7ebf")
          : t(
              "In-wallet support coming soon",
              "\u94b1\u5305\u5185\u652f\u6301\u5373\u5c06\u4e0a\u7ebf",
            );
    return (
      <Pressable
        key={"market-" + token.symbol}
        accessibilityRole="button"
        onPress={() => openTokenDetail(token.symbol)}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingVertical: 12,
          borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
          borderColor: colors.line + "4d",
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <TokenIcon symbol={token.symbol} size={38} chainBadge={canHoldHere} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={s.label} numberOfLines={1}>
              {token.name}
              {/* Market cap rank, only for the not-yet-tradable catalog coins —
                  real ones sourced from CoinGecko alongside the sparkline, not
                  shown for ETH/TERA (already tradable) or Arc (no market yet). */}
              {!isListed && ranks[token.symbol] ? (
                <Text style={{ color: colors.faint, fontWeight: "600" }}>
                  {" "}
                  · #{ranks[token.symbol]}
                </Text>
              ) : null}
            </Text>
            <Pressable
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={
                isPinned(token.symbol, pinnedAssets)
                  ? t(`Unpin ${token.symbol}`, `取消自选 ${token.symbol}`)
                  : t(`Pin ${token.symbol}`, `加入自选 ${token.symbol}`)
              }
              onPress={(e: any) => {
                e?.stopPropagation?.();
                const next = togglePinned(token.symbol);
                setPinnedAssetsState(next);
              }}
            >
              <Text
                style={{
                  fontSize: 16,
                  color: isPinned(token.symbol, pinnedAssets) ? "#eab308" : colors.muted,
                }}
              >
                {isPinned(token.symbol, pinnedAssets) ? "★" : "☆"}
              </Text>
            </Pressable>
          </View>
          <Text style={s.small} numberOfLines={1}>
            {[Number.isFinite(price) && price > 0 ? valueCore.format(price) : "", detail]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </View>
        {trendTag(token.symbol)}
        {isListed || token.symbol === "USDG" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${actionLabel} ${token.symbol}`}
            onPress={() => openTokenBuy(token.symbol)}
            style={({ pressed }) => ({
              minWidth: 64,
              paddingVertical: 9,
              paddingHorizontal: 14,
              borderRadius: 14,
              alignItems: "center",
              backgroundColor: colors.tint,
              opacity: pressed ? 0.65 : 1,
            })}
          >
            <Text style={{ color: colors.green, fontWeight: "800" }}>{actionLabel}</Text>
          </Pressable>
        ) : (
          <Text style={[s.small, { color: colors.muted, minWidth: 80, textAlign: "right" }]}>
            {actionLabel}
          </Text>
        )}
      </Pressable>
    );
  }
  // On the web a business can be paid at its email, typed in the same field as a tag.
  const nameChoice = biz.emailAvailable() ? t("Tag or email", "标签或邮箱") : t("Tera tag", "Tera 标签");
  function main() {
    if (business && (page === "home" || page.startsWith("biz-")))
      return (
        <biz.Screens
          page={page}
          go={setPage}
          t={t}
          wide={wide}
          owner={owner as Address}
          accounts={accounts}
          assets={assets}
          prices={prices}
          onFlow={(flow: string) => openFlow(flow)}
          onSwitch={switchTo}
          onAdopt={adopt}
          onAccountsChanged={syncAccounts}
          notify={setNotice}
        />
      );
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
          {pinnedAssets.length > 0 && (
            <View style={{ gap: 10, marginTop: 16 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={{ fontSize: 14, color: "#eab308" }}>★</Text>
                <Text style={s.eyebrow}>
                  {t(
                    `Pinned Watchlist (${pinnedAssets.length})`,
                    `置顶关注 (${pinnedAssets.length})`,
                  )}
                </Text>
              </View>
              <View style={[s.panel, { paddingVertical: 4, gap: 0 }]}>
                {pinnedAssets.map((sym, i) => {
                  const matched =
                    assets.find((a) => a.symbol === sym) ||
                    popularTokens.find((pt) => pt.symbol === sym) || {
                      symbol: sym,
                      name: sym,
                    };
                  return marketRow({ symbol: sym, name: (matched as any).name || sym }, i === 0);
                })}
              </View>
            </View>
          )}
          <View style={{ gap: 10, marginTop: 16 }}>
            <Text style={s.eyebrow}>{t("Popular tokens", "\u70ed\u95e8\u4ee3\u5e01")}</Text>
            <View style={[s.panel, { paddingVertical: 4, gap: 0 }]}>
              {sortWithPinned(popularTokens, pinnedAssets).map((token, i) =>
                marketRow(token, i === 0),
              )}
            </View>
          </View>
          <View style={{ gap: 10, marginTop: 16 }}>
            <Text style={s.eyebrow}>{t("Your assets", "\u4f60\u7684\u8d44\u4ea7")}</Text>
            {held.length ? (
              <View style={[s.panel, { paddingVertical: 4, gap: 0 }]}>
                {sortWithPinned(held, pinnedAssets).map(({ asset, amount }, i) =>
                  assetRow(asset, amount, i === 0),
                )}
                {hiddenBalancesRow()}
              </View>
            ) : (
              <View style={[s.panel, { alignItems: "center", paddingVertical: 22 }]}>
                <Text style={s.small}>
                  {t("No balances on this wallet yet.", "此钱包暂无余额。")}
                </Text>
              </View>
            )}
          </View>
          <View style={{ gap: 10, marginTop: 16 }}>
            <Text style={s.eyebrow}>{t("All tokens", "\u6240\u6709\u4ee3\u5e01")}</Text>
            <View style={[s.panel, { paddingVertical: 4, gap: 0 }]}>
              {sortWithPinned(
                assets.filter((asset) => !popularSymbols.has(asset.symbol)),
                pinnedAssets,
              ).map((asset, i) =>
                marketRow({ symbol: asset.symbol, name: asset.name || asset.symbol }, i === 0),
              )}
            </View>
          </View>
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
    if (page === "home") {
      // Custom Watchlist and Popular tokens
      const watchlistSection = (
        <View style={{ gap: 10 }}>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={{ fontSize: 16, color: "#eab308" }}>★</Text>
              <Text style={[s.text, { fontWeight: "700" }]}>
                {t(`Watchlist (${pinnedAssets.length})`, `自选关注 (${pinnedAssets.length})`)}
              </Text>
            </View>
            <Pressable accessibilityRole="button" onPress={() => setPage("tokens")}>
              <Text style={[s.small, { color: colors.green, fontWeight: "600" }]}>
                {t("Manage ↗", "管理 ↗")}
              </Text>
            </Pressable>
          </View>
          <View style={[s.panel, { paddingVertical: 4, gap: 0 }]}>
            {pinnedAssets.length > 0 ? (
              pinnedAssets.map((sym, i) => {
                const matched =
                  assets.find((a) => a.symbol === sym) ||
                  popularTokens.find((pt) => pt.symbol === sym) || {
                    symbol: sym,
                    name: sym,
                  };
                return marketRow({ symbol: sym, name: (matched as any).name || sym }, i === 0);
              })
            ) : (
              <View style={{ paddingVertical: 14, alignItems: "center" }}>
                <Text style={s.small}>
                  {t(
                    "No pinned tokens yet. Tap ☆ on any token to add it to your watchlist.",
                    "暂无自选代币。点击任意代币旁的 ☆ 即可加入自选。",
                  )}
                </Text>
              </View>
            )}
          </View>
        </View>
      );
      const popular = (
        <View style={{ gap: 10 }}>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Text style={[s.text, { fontWeight: "700" }]}>
              {t("Popular tokens", "\u70ed\u95e8\u4ee3\u5e01")}
            </Text>
            <Pressable accessibilityRole="button" onPress={() => setPage("tokens")}>
              <Text style={[s.small, { color: colors.green, fontWeight: "600" }]}>
                {t("View all", "\u67e5\u770b\u5168\u90e8")}
              </Text>
            </Pressable>
          </View>
          <View style={[s.panel, { paddingVertical: 4, gap: 0 }]}>
            {!balance
              ? [0, 1, 2, 3, 4].map((i) => tokenRowSkeleton(i, i === 0))
              : sortWithPinned(popularTokens.slice(0, 5), pinnedAssets).map((token, i) =>
                  marketRow(token, i === 0),
                )}
          </View>
        </View>
      );
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
          <View style={wide ? { flexDirection: "row", gap: 40, alignItems: "flex-start" } : { gap: 18 }}>
            <View style={wide ? { flex: 6, minWidth: 0, gap: 22 } : { gap: 18 }}>
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
                    {!balance ? (
                      <Skeleton
                        width={140}
                        height={38}
                        borderRadius={8}
                        style={{ marginVertical: 4, backgroundColor: "#ffffff26" }}
                      />
                    ) : (
                      <Text
                        style={{
                          color: colors.ink,
                          fontSize: 38,
                          lineHeight: 46,
                          fontWeight: "700",
                          letterSpacing: -1,
                        }}
                      >
                        {shownValue(formatFiat(valuation.total, data.fiatCurrency || "USD"))}
                      </Text>
                    )}
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
                    {pnlSummary && pnlSummary.total.costBasis > 0 ? (
                      <Pressable accessibilityRole="button" onPress={() => setPage("pnl")} hitSlop={8}>
                        <Text
                          style={[
                            s.small,
                            {
                              color: pnlSummary.total.unrealized >= 0 ? colors.green : colors.danger,
                              fontWeight: "700",
                              textAlign: "center",
                            },
                          ]}
                        >
                          {shownValue(
                            `${signedFiat(pnlSummary.total.unrealized)} (${signedPct(pnlSummary.total.percent)})`,
                          )}{" "}
                          {t("unrealized", "未实现")}
                          {pnlSummary.total.estimated ? t(" · est.", " · 估算") : ""} ›
                        </Text>
                      </Pressable>
                    ) : null}
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
              {balance && allHeld.length ? (
                <View style={[s.panel, { gap: 10 }]}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={[s.text, { fontWeight: "700" }]}>{t("Portfolio", "投资组合")}</Text>
                    {portfolioChart && portfolioChart.points.length > 1 ? (
                      (() => {
                        const first = portfolioChart.points[0].p;
                        const last = portfolioChart.points[portfolioChart.points.length - 1].p;
                        const change = last - first;
                        return (
                          <Text style={[s.small, { fontWeight: "700", color: change >= 0 ? colors.green : colors.danger }]}>
                            {shownValue(`${signedFiat(change)} (${signedPct(first > 0 ? (change / first) * 100 : null)})`)}
                          </Text>
                        );
                      })()
                    ) : null}
                  </View>
                  {portfolioChart ? (
                    <TokenChart
                      points={portfolioChart.points}
                      up={
                        portfolioChart.points.length < 2 ||
                        portfolioChart.points[portfolioChart.points.length - 1].p >= portfolioChart.points[0].p
                      }
                    />
                  ) : (
                    <View style={{ height: 120, alignItems: "center", justifyContent: "center" }}>
                      <TeraSpinner size={22} />
                    </View>
                  )}
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    {(["1D", "1W", "1M", "1Y"] as const).map((range) => (
                      <Pressable
                        key={range}
                        accessibilityRole="button"
                        accessibilityState={{ selected: range === portfolioRange }}
                        onPress={() => setPortfolioRange(range)}
                        style={({ pressed }) => ({
                          flex: 1,
                          marginHorizontal: 3,
                          paddingVertical: 7,
                          borderRadius: 10,
                          alignItems: "center",
                          backgroundColor: range === portfolioRange ? colors.tint : "transparent",
                          opacity: pressed ? 0.7 : 1,
                        })}
                      >
                        <Text style={[s.small, { fontWeight: "700", color: range === portfolioRange ? colors.green : colors.muted }]}>
                          {range}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  {portfolioChart && portfolioChart.excluded.length ? (
                    <Text style={s.small}>
                      {t(
                        `Without ${portfolioChart.excluded.join(", ")}: no price history for this range.`,
                        `未包含 ${portfolioChart.excluded.join("、")}：此时间段无价格历史。`,
                      )}
                    </Text>
                  ) : null}
                </View>
              ) : null}
              {readyOrders.length ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setPage("limit-orders")}
                  style={({ pressed }) => [
                    s.panel,
                    {
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                      borderColor: colors.lime,
                      borderWidth: 1,
                      backgroundColor: colors.tint,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <View style={s.quickIcon}>
                    <Icon name="target" color={colors.lime} size={22} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.text, { fontWeight: "700", color: colors.lime }]}>
                      {t(
                        `${readyOrders.length} limit order${readyOrders.length === 1 ? " is" : "s are"} ready`,
                        `${readyOrders.length} 个限价单已就绪`,
                      )}
                    </Text>
                    <Text style={s.small}>{limitCore.readyText(readyOrders[0])}</Text>
                  </View>
                  <Icon name="chevron-right" size={18} color={colors.lime} />
                </Pressable>
              ) : null}
              {watchedList.length ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setPage("watching")}
                  style={({ pressed }) => [
                    s.panel,
                    { flexDirection: "row", alignItems: "center", gap: 12, opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <View style={s.quickIcon}>
                    <Icon name="eye-outline" color={colors.lime} size={22} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.text, { fontWeight: "700" }]}>
                      {t(
                        `Watching ${watchedList.length} wallet${watchedList.length === 1 ? "" : "s"}`,
                        `正在观察 ${watchedList.length} 个钱包`,
                      )}
                    </Text>
                    <Text style={s.small}>
                      {(() => {
                        const values = watchedList.map((entry: any) => watchedValuation(entry.address));
                        if (values.some((v: any) => v === null)) return t("Reading balances…", "正在读取余额…");
                        const sum = values.reduce((acc: number, v: any) => acc + (v.total || 0), 0);
                        return t(
                          `${shownValue(formatFiat(sum, data.fiatCurrency || "USD"))} watched · not counted in your total`,
                          `观察总值 ${shownValue(formatFiat(sum, data.fiatCurrency || "USD"))} · 不计入你的总资产`,
                        );
                      })()}
                    </Text>
                  </View>
                  <Icon name="chevron-right" size={18} color={colors.muted} />
                </Pressable>
              ) : null}
              {dueScheduled.length ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setPage("scheduled")}
                  style={({ pressed }) => [
                    s.panel,
                    {
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                      borderColor: colors.lime,
                      borderWidth: 1,
                      backgroundColor: colors.tint,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <View style={s.quickIcon}>
                    <Icon name="calendar-clock" color={colors.lime} size={22} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.text, { fontWeight: "700", color: colors.lime }]}>
                      {(() => {
                        const total = dueScheduled.reduce((sum: number, item: any) => sum + item.count, 0);
                        return t(
                          `${total} scheduled ${total === 1 ? "item is" : "items are"} due`,
                          `${total} 项定期计划到期`,
                        );
                      })()}
                    </Text>
                    <Text style={s.small}>
                      {schedulesCore.reminderText(dueScheduled[0], scheduleToday, scheduleName(dueScheduled[0].schedule))}
                    </Text>
                  </View>
                  <Icon name="chevron-right" size={18} color={colors.lime} />
                </Pressable>
              ) : null}
              {data.history?.some((item: any) => item?.status === "pending") ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setPage("activity")}
                  style={({ pressed }) => [
                    s.panel,
                    {
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                      borderColor: colors.lime,
                      borderWidth: 1,
                      backgroundColor: colors.tint,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <View style={s.quickIcon}>
                    <Icon name="clock" color={colors.lime} size={22} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.text, { fontWeight: "700", color: colors.lime }]}>
                      {t(
                        `${data.history.filter((i: any) => i?.status === "pending").length} transaction pending confirmation`,
                        `${data.history.filter((i: any) => i?.status === "pending").length} 笔交易等待确认`,
                      )}
                    </Text>
                    <Text style={s.small}>
                      {t("Tap to view status and receipt details", "点击查看状态与收据详情")}
                    </Text>
                  </View>
                  <Icon name="chevron-right" size={18} color={colors.lime} />
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                onPress={openSpend}
                style={({ pressed }) => [
                  s.panel,
                  { flexDirection: "row", alignItems: "center", gap: 12, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <View style={s.quickIcon}>
                  <Icon name="wallet" color={colors.lime} size={22} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.text, { fontWeight: "700" }]}>{t("Spend dollars", "用美元消费")}</Text>
                  <Text style={s.small}>
                    {balance
                      ? t(
                          `${spendCore.formatDollars(BigInt(balance[spendCore.STABLE] || "0"))} ready in USDG`,
                          `${spendCore.formatDollars(BigInt(balance[spendCore.STABLE] || "0"))} USDG 可用`,
                        )
                      : t("Pay anyone an exact dollar amount", "向任何人支付精确的美元金额")}
                  </Text>
                </View>
                <Icon name="chevron-right" size={18} color={colors.muted} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => setPage("staking")}
                style={({ pressed }) => [
                  s.panel,
                  { flexDirection: "row", alignItems: "center", gap: 12, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <View style={[s.quickIcon, { backgroundColor: colors.tint }]}>
                  <Icon name="trending-up" color={colors.green} size={22} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.text, { fontWeight: "700" }]}>{t("TERA Staking", "TERA 质押")}</Text>
                  <Text style={s.small}>
                    {t("Your positions, rewards and claims", "你的仓位、奖励与领取")}
                  </Text>
                </View>
                <Icon name="chevron-right" size={18} color={colors.muted} />
              </Pressable>
              {!wide && watchlistSection}
              {!wide && popular}
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
                  <View style={[s.panel, { paddingVertical: 4, gap: 0 }]}>
                    {[0, 1].map((i) => tokenRowSkeleton(i, i === 0))}
                  </View>
                ) : held.length ? (
                  <View style={[s.panel, { paddingVertical: 4, gap: 0 }]}>
                    {sortWithPinned(held, pinnedAssets).map(({ asset, amount }, i) => assetRow(asset, amount, i === 0))}
                    {hiddenBalancesRow()}
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
            </View>
            <View style={wide ? { flex: 5, minWidth: 0, gap: 22 } : { gap: 18 }}>
              {wide && watchlistSection}
              {wide && popular}
              <View style={{ gap: 10 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={[s.text, { fontWeight: "700" }]}>
                    {t("Recent activity", "最近记录")}
                  </Text>
                  {combinedHistory.length ? (
                    <Pressable accessibilityRole="button" onPress={() => setPage("activity")}>
                      <Text style={[s.small, { color: colors.green, fontWeight: "600" }]}>
                        {t("View all", "查看全部")}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
                {combinedHistory.length ? (
                  combinedHistory.slice(0, 3).map((r) => {
                    const kind = activityKind(r);
                    return (
                      <Pressable
                        key={r.hash}
                        accessibilityRole="button"
                        onPress={() => setPage("activity")}
                        style={[s.panel, { flexDirection: "row", alignItems: "center", gap: 12 }]}
                      >
                        <View style={s.iconDisc}>
                          <Icon name={kind === "send" ? "arrow-top-right" : kind === "receive" ? "arrow-down" : kind === "bridge" ? "bridge" : "swap-vertical"} size={20} color={colors.ink} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={s.label} numberOfLines={1}>
                            {activityTitle(r)}
                          </Text>
                          <Text style={s.small}>
                            {r.createdAt ? new Date(r.createdAt).toLocaleString() : t("On-chain transaction", "链上交易")}
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
                            {activityStatus(r.status)}
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
            </View>
          </View>
        </>
      );
    }
    if (page === "tag") {
      const activeTag = myTag ? String(myTag).replace(/^@+/, "") : (claimInput && tags.isTag(claimInput) ? claimInput.replace(/^@+/, "") : "astra");
      let cardData = {
        handle: "@" + activeTag,
        intentUrl: "https://x.com/intent/tweet?text=Pay%20me%20via%20Tera%20tag",
        paymentUrl: "https://terawallet.app/pay/@" + activeTag,
      };
      try {
        cardData = tags.tagReceiveCardData({ tag: activeTag, address: owner });
      } catch {
        // Fallback
      }
      return (
        <>
          <Header
            title={t("Your tag", "您的标签")}
            onBack={() => setPage("home")}
            backLabel={t("Back", "返回")}
          />
          {/* Branded Emerald Tag Receive Card & Social Graphic */}
          <View
            style={[
              s.panel,
              {
                borderRadius: 22,
                padding: 20,
                gap: 14,
                backgroundColor: "#0a140e",
                borderColor: colors.green,
                borderWidth: 1.5,
                overflow: "hidden",
              },
            ]}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 13,
                    backgroundColor: colors.green,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ color: "#0a140e", fontWeight: "900", fontSize: 15 }}>T</Text>
                </View>
                <View>
                  <Text style={{ color: "#ffffff", fontWeight: "800", fontSize: 14 }}>TERA WALLET</Text>
                  <Text style={{ color: colors.lime, fontWeight: "700", fontSize: 9, letterSpacing: 0.8 }}>
                    ROBINHOOD CHAIN
                  </Text>
                </View>
              </View>
              <View
                style={{
                  backgroundColor: "#00c85322",
                  borderColor: colors.green,
                  borderWidth: 1,
                  borderRadius: 999,
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                }}
              >
                <Text style={{ color: colors.lime, fontWeight: "700", fontSize: 10 }}>✓ VERIFIED TAG</Text>
              </View>
            </View>

            <View style={{ marginVertical: 8 }}>
              <Text style={{ color: colors.faint, fontSize: 10, fontWeight: "700", letterSpacing: 0.8 }}>
                CLAIMED IDENTITY
              </Text>
              <Text style={{ color: "#ffffff", fontSize: 32, fontWeight: "800", marginTop: 2 }}>
                {cardData.handle}
              </Text>
              <Text style={{ color: colors.lime, fontSize: 12, fontFamily: "monospace", marginTop: 4 }}>
                {short(owner)}
              </Text>
            </View>

            <Text style={{ color: colors.muted, fontSize: 11 }}>
              {t("Scan or send directly via @tags on Robinhood Chain", "在 Robinhood Chain 上通过 @标签 直接扫码或付款")}
            </Text>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
              <Pressable
                accessibilityRole="button"
                onPress={() => void Linking.openURL(cardData.intentUrl)}
                style={{
                  backgroundColor: "#000",
                  borderColor: colors.line,
                  borderWidth: 1,
                  borderRadius: 12,
                  paddingHorizontal: 14,
                  paddingVertical: 9,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 12 }}>Share to X ↗</Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  void Clipboard.setStringAsync(cardData.paymentUrl).then(() =>
                    setNotice({
                      title: t("Payment link copied", "收款链接已复制"),
                      body: cardData.paymentUrl,
                      tone: "success",
                    }),
                  )
                }
                style={{
                  backgroundColor: colors.tint,
                  borderColor: colors.green,
                  borderWidth: 1,
                  borderRadius: 12,
                  paddingHorizontal: 14,
                  paddingVertical: 9,
                }}
              >
                <Text style={{ color: colors.green, fontWeight: "700", fontSize: 12 }}>
                  {t("Copy payment link", "复制收款链接")}
                </Text>
              </Pressable>
            </View>
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
                {business && bizEmail
                  ? bizEmail
                  : !business && tagsAvailable() && myTag
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
    if (page === "spend") {
      const stable = BigInt(balance?.[spendCore.STABLE] || "0");
      const plan = spendCore.plan({
        amount: spendAmount,
        stable,
        eth: BigInt(balance?.ETH || "0"),
        ethPrice: usablePrice("ETH") ?? NaN,
      });
      const topUp = plan.state === "top-up" ? plan.topUp : undefined;
      const spent = spendCore.spentThisMonth(combinedHistory);
      const dollars = spendCore.formatDollars;
      const link = spendLink;
      const overLimit = plan.state !== "invalid" && plan.units ? limitProblem(plan.units.toString()) : "";
      const left = limitsCore.hasAny(data.limits)
        ? limitsCore.remaining(data.limits, combinedHistory)
        : null;
      const ready =
        plan.state === "ready" &&
        !!spendTo.trim() &&
        (!link || link.status === "open") &&
        !overLimit;
      const leaveLink = () => {
        setSpendLink(null);
        setSpendAmount("");
        setSpendTo("");
      };
      return (
        <>
          <Header title={t("Spend", "消费")} onBack={() => setPage("home")} backLabel={t("Back", "返回")} />
          <View style={[s.panel, { gap: 6 }]}>
            <Text style={s.eyebrow}>{t("READY TO SPEND", "可消费")}</Text>
            <Text style={{ fontSize: 36, fontWeight: "800", color: colors.ink }}>
              {balance ? dollars(stable) : "—"}
            </Text>
            <Text style={s.small}>
              {t(
                `Held as ${spendCore.unitsToAmount(stable)} USDG, counted at $1.00 each.`,
                `以 ${spendCore.unitsToAmount(stable)} USDG 持有，每枚按 $1.00 计算。`,
              )}
            </Text>
            <Text style={s.small}>
              {spent.count
                ? t(
                    `Spent this month: ${dollars(spent.units)} across ${spent.count} payment${spent.count === 1 ? "" : "s"}.`,
                    `本月已消费：${dollars(spent.units)}，共 ${spent.count} 笔。`,
                  )
                : t("Nothing spent this month yet.", "本月尚未消费。")}
            </Text>
            {left && (
              <Text style={s.small}>
                {[
                  left.perPayment !== null &&
                    t(`${dollars(left.perPayment)} per payment`, `单笔 ${dollars(left.perPayment)}`),
                  left.daily !== null &&
                    t(`${dollars(left.daily)} left today`, `今日剩余 ${dollars(left.daily)}`),
                  left.monthly !== null &&
                    t(`${dollars(left.monthly)} left this month`, `本月剩余 ${dollars(left.monthly)}`),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            )}
          </View>
          <View style={{ alignItems: "center", gap: 6, paddingVertical: 18 }}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text style={{ fontSize: 44, fontWeight: "700", color: colors.muted }}>$</Text>
              <TextInput
                value={spendAmount}
                editable={!link}
                onChangeText={(value) => setSpendAmount(value.replace(",", "."))}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={colors.faint}
                accessibilityLabel={t("Amount in dollars", "美元金额")}
                style={{
                  color: plan.state === "invalid" && spendAmount ? colors.danger : colors.ink,
                  fontWeight: "700",
                  fontSize: 56,
                  minWidth: 180,
                  textAlign: "center",
                }}
              />
            </View>
            <Text style={s.small}>
              {plan.state === "invalid" && spendAmount
                ? t("Enter a dollar amount, to the cent.", "请输入美元金额，精确到分。")
                : t("They receive exactly this, in USDG.", "对方将收到等额 USDG。")}
            </Text>
          </View>
          {link ? (
            <View style={[s.panel, { gap: 8 }]}>
              <Text style={s.eyebrow}>{t("PAYMENT REQUEST", "收款请求")}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Icon
                  name={link.email ? "shield-check" : "alert"}
                  size={18}
                  color={link.email ? colors.green : colors.copper}
                />
                <Text style={[s.text, { fontWeight: "700", flex: 1 }]}>
                  {link.email
                    ? link.name || link.email
                    : t("Unverified merchant", "未验证商家")}
                </Text>
              </View>
              <Text style={s.small}>
                {link.email
                  ? t(
                      `${link.email} · a business email this wallet proved to Tera`,
                      `${link.email} · 此钱包已向 Tera 证明的商业邮箱`,
                    )
                  : t(
                      "This wallet has not proved a business email. Check the address with whoever sent you the link before you pay.",
                      "此钱包尚未证明商业邮箱。付款前请与发送链接的人核对地址。",
                    )}
              </Text>
              <Text style={[s.small, { color: colors.ink }]} selectable>
                {link.merchant}
              </Text>
              {link.note ? (
                <Text style={[s.text, { fontStyle: "italic" }]}>{`“${link.note}”`}</Text>
              ) : null}
              {link.status !== "open" && (
                <Text style={[s.small, { color: colors.danger, fontWeight: "700" }]}>
                  {link.status === "paid"
                    ? t("This link has already been paid.", "此链接已付款。")
                    : t("The merchant cancelled this link.", "商家已取消此链接。")}
                </Text>
              )}
              <Pressable accessibilityRole="button" onPress={leaveLink} hitSlop={6}>
                <Text style={[s.small, { color: colors.green, fontWeight: "600" }]}>
                  {t("Pay someone else instead", "改为向他人付款")}
                </Text>
              </Pressable>
            </View>
          ) : (
            <Field
              label={t("Pay", "付款给")}
              value={spendTo}
              onChangeText={(value) => {
                // A pasted payment link opens that request rather than being read as a name.
                const id = /[?&]pay=/.test(value) ? payLinks.parseLink(value) : null;
                if (id) openPayLink(id);
                else setSpendTo(value);
              }}
              autoCapitalize="none"
              placeholder={
                biz.emailAvailable()
                  ? t("0x… · @astra · pay@acme.com · or a payment link", "0x… · @astra · pay@acme.com · 或收款链接")
                  : tagsAvailable()
                    ? t("0x… · @astra · or a payment link", "0x… · @astra · 或收款链接")
                    : t("0x… or a payment link", "0x… 或收款链接")
              }
            />
          )}
          {overLimit ? (
            <View style={s.error}>
              <Text style={s.text}>{overLimit}</Text>
            </View>
          ) : null}
          {!overLimit && plan.state !== "invalid" && plan.state !== "ready" && (
            <View style={[s.panel, { gap: 10 }]}>
              <Text style={[s.text, { fontWeight: "700" }]}>
                {t(
                  `${dollars(plan.shortfall)} short`,
                  `还差 ${dollars(plan.shortfall)}`,
                )}
              </Text>
              {topUp ? (
                <>
                  <Text style={s.small}>
                    {t(
                      `Top up ${dollars(topUp.dollars)} first by selling about ${Number(formatUnits(topUp.wei, 18)).toFixed(6)} ETH for USDG. That's its own swap, reviewed and signed on its own — then you come back here and pay. Anything left over stays in USDG.`,
                      `先卖出约 ${Number(formatUnits(topUp.wei, 18)).toFixed(6)} ETH 换成 USDG，充值 ${dollars(topUp.dollars)}。这是一笔单独审核和签名的兑换，完成后返回此处付款。多余部分保留为 USDG。`,
                    )}
                  </Text>
                  <Button
                    onPress={() => void run((guard) => prepareTopUp(guard, topUp.wei))}
                  >
                    {t(`Top up ${dollars(topUp.dollars)} from ETH`, `从 ETH 充值 ${dollars(topUp.dollars)}`)}
                  </Button>
                </>
              ) : (
                <>
                  <Text style={s.small}>
                    {plan.reason === "no-price"
                      ? t(
                          "ETH has no price right now, so Tera won't guess how much to sell. Try again shortly, or add USDG.",
                          "ETH 当前没有价格，Tera 不会猜测卖出数量。请稍后再试，或充入 USDG。",
                        )
                      : t(
                          "There isn't enough ETH to top up the difference (Tera keeps 0.0005 ETH for fees). Add USDG to this wallet to pay.",
                          "ETH 不足以补足差额（Tera 保留 0.0005 ETH 用于手续费）。请向此钱包充入 USDG 后付款。",
                        )}
                  </Text>
                  <Button onPress={() => openFlow("receive")}>{t("Receive USDG", "接收 USDG")}</Button>
                </>
              )}
            </View>
          )}
          <Field
            label={t("Note (optional, only you see it)", "备注（可选，仅你可见）")}
            value={payNote}
            onChangeText={setPayNote}
            maxLength={notesCore.LIMITS.maxLength}
            autoCapitalize="sentences"
            placeholder={
              business
                ? t("Invoice number, client, purpose…", "发票号、客户、用途…")
                : t("What's this for?", "这笔付款是做什么的？")
            }
          />
          <Button
            primary
            disabled={!ready}
            onPress={() => void run((guard) => preparePayment(guard))}
          >
            {plan.state === "ready"
              ? t(`Review payment of ${dollars(plan.units)}`, `审核付款 ${dollars(plan.units)}`)
              : t("Review payment", "审核付款")}
          </Button>
          <Text style={[s.small, { textAlign: "center" }]}>
            {t(
              "Payments leave as USDG on Robinhood Chain. USDG is counted at $1.00 here — that's a definition, not a guarantee.",
              "付款以 Robinhood Chain 上的 USDG 发出。此处 USDG 按 $1.00 计算——这是约定，并非担保。",
            )}
          </Text>
        </>
      );
    }
    if (page === "staking") {
      // TERA staking, read from the same ledger the staking site uses. Claims and
      // unstakes are signed requests: the wallet signs the exact request text the
      // service returns, and the treasury executor sends the TERA. Deposits need an
      // on-chain transfer that the service verifies, which this screen does not
      // make yet, so it sends people to the staking site for that.
      const signedPayout = async (kind: "claim" | "unstake", position: any) => {
        const request = {
          kind,
          walletAddress: owner,
          epochId: position.epoch_id,
          amount: kind === "unstake" ? String(position.active_stake) : "0",
          idempotencyKey: Crypto.randomUUID(),
        };
        const auth = await api("/api/staking/payout-authorization", request);
        const signature = await vault.currentAccount().signMessage({ message: auth.message });
        await api("/api/staking/payouts", { ...request, signature });
      };
      const unlockLock = async (lock: any) => {
        const request = { walletAddress: owner, lockId: lock.id, idempotencyKey: Crypto.randomUUID() };
        const auth = await api("/api/staking/locks/unlock-authorization", request);
        const signature = await vault.currentAccount().signMessage({ message: auth.message });
        await api("/api/staking/locks/unlock", { ...request, signature });
      };
      const statusLabel: Record<string, [string, string]> = {
        requested: ["Requested", "已提交"],
        signed: ["Sending", "发送中"],
        broadcast: ["Sending", "发送中"],
        confirmed: ["Paid", "已到账"],
        failed: ["Failed", "失败"],
      };
      const positions = (stakeData?.positions || []).filter(
        (position: any) => BigInt(position.active_stake || "0") > 0n || BigInt(position.claimable_rewards || "0") > 0n,
      );
      return (
        <>
          <Header title={t("TERA staking", "TERA 质押")} onBack={() => setPage("home")} backLabel={t("Home", "首页")} />
          {stakeData === null ? (
            <View style={[s.panel, { alignItems: "center", paddingVertical: 28, gap: 10 }]}>
              {stakeError ? (
                <Text style={[s.small, { color: colors.danger }]}>{stakeError}</Text>
              ) : (
                <>
                  <TeraSpinner size={22} />
                  <Text style={s.small}>{t("Reading your staking positions…", "正在读取你的质押仓位…")}</Text>
                </>
              )}
            </View>
          ) : (
            <>
              {positions.length === 0 && !(stakeData.locks || []).length ? (
                <View style={[s.panel, { gap: 8 }]}>
                  <Text style={[s.text, { fontWeight: "700" }]}>{t("No staking positions yet", "暂无质押仓位")}</Text>
                  <Text style={s.small}>
                    {t("Positions you open on the staking site appear here, where you can claim and unstake.", "你在质押网站开立的仓位会显示在这里，可在此领取和解押。")}
                  </Text>
                </View>
              ) : null}
              {positions.map((position: any) => {
                const claimable = BigInt(position.claimable_rewards || "0");
                const staked = BigInt(position.active_stake || "0");
                return (
                  <View key={position.epoch_id} style={[s.panel, { gap: 8, borderColor: colors.green, borderWidth: 1 }]}>
                    <Text style={s.eyebrow}>
                      {position.lock_tier && position.lock_tier !== "flexible"
                        ? t(`STAKED · ${position.lock_tier}`, `质押 · ${position.lock_tier}`)
                        : t("FLEXIBLE STAKE", "活期质押")}
                    </Text>
                    <Row label={t("Staked", "质押数量")} value={`${tera(staked)} TERA`} />
                    <Row label={t("Rewards to claim", "可领取奖励")} value={`${tera(claimable)} TERA`} />
                    {position.is_locked ? (
                      <Text style={s.small}>
                        {t(
                          `Locked for another ${Math.ceil(Number(position.remaining_lock_seconds || 0) / 86400)} days. Rewards can still be claimed.`,
                          `仍锁定 ${Math.ceil(Number(position.remaining_lock_seconds || 0) / 86400)} 天，奖励仍可领取。`,
                        )}
                      </Text>
                    ) : null}
                    <View style={s.wrap}>
                      <Button
                        primary
                        disabled={busy || claimable <= 0n}
                        onPress={() =>
                          void run(async (guard) => {
                            await signedPayout("claim", position);
                            guard();
                            setNotice({
                              title: t("Claim requested", "已提交领取"),
                              body: t(
                                `${tera(claimable)} TERA is being sent to your wallet by the staking treasury. It usually arrives within a minute.`,
                                `质押金库正在将 ${tera(claimable)} TERA 发送到你的钱包，通常一分钟内到账。`,
                              ),
                              tone: "success",
                            });
                            await loadStaking();
                          })
                        }
                      >
                        {t("Claim rewards", "领取奖励")}
                      </Button>
                      <Button
                        danger
                        disabled={busy || staked <= 0n || Boolean(position.is_locked)}
                        onPress={() =>
                          confirm(
                            t("Unstake everything?", "全部解押？"),
                            t(
                              `${tera(staked)} TERA and any unclaimed rewards will be sent back to your wallet.`,
                              `${tera(staked)} TERA 及未领取奖励将发回你的钱包。`,
                            ),
                            () =>
                              void run(async (guard) => {
                                await signedPayout("unstake", position);
                                guard();
                                setNotice({
                                  title: t("Unstake requested", "已提交解押"),
                                  body: t("Your TERA is being sent back to your wallet by the staking treasury.", "质押金库正在将你的 TERA 发回钱包。"),
                                  tone: "success",
                                });
                                await loadStaking();
                              }),
                          )
                        }
                      >
                        {t("Unstake all", "全部解押")}
                      </Button>
                    </View>
                  </View>
                );
              })}
              {(stakeData.locks || []).map((lock: any) => (
                <View key={lock.id} style={[s.panel, { gap: 8 }]}>
                  <Text style={s.eyebrow}>{t(`${lock.term_days}-DAY LOCK`, `${lock.term_days} 天锁定`)}</Text>
                  <Row label={t("Principal", "本金")} value={`${tera(lock.principal_amount)} TERA`} />
                  <Row label={t("Reward at maturity", "到期奖励")} value={`${tera(lock.reward_amount)} TERA`} />
                  <Row
                    label={t("Status", "状态")}
                    value={
                      lock.effectiveStatus === "claimed"
                        ? t("Claimed", "已领取")
                        : lock.isMatured
                          ? t("Matured — ready to claim", "已到期，可领取")
                          : t(`Unlocks in ${Math.ceil(Number(lock.secondsRemaining || 0) / 86400)} days`, `${Math.ceil(Number(lock.secondsRemaining || 0) / 86400)} 天后解锁`)
                    }
                  />
                  {lock.isMatured ? (
                    <Button
                      primary
                      disabled={busy}
                      onPress={() =>
                        void run(async (guard) => {
                          await unlockLock(lock);
                          guard();
                          setNotice({
                            title: t("Unlock requested", "已提交解锁"),
                            body: t("Your principal and reward are being sent to your wallet by the staking treasury.", "质押金库正在将本金和奖励发送到你的钱包。"),
                            tone: "success",
                          });
                          await loadStaking();
                        })
                      }
                    >
                      {t("Unlock & claim", "解锁并领取")}
                    </Button>
                  ) : null}
                </View>
              ))}
              {(stakeData.payouts || []).length ? (
                <View style={[s.panel, { gap: 6 }]}>
                  <Text style={s.eyebrow}>{t("RECENT PAYOUTS", "近期发放")}</Text>
                  {(stakeData.payouts || []).slice(0, 6).map((payout: any) => (
                    <Row
                      key={payout.id}
                      label={`${payout.kind === "claim" ? t("Claim", "领取") : t("Unstake", "解押")} · ${new Date(payout.created_at).toLocaleDateString()}`}
                      value={`${tera(BigInt(payout.principal_amount || "0") + BigInt(payout.reward_amount || "0"))} TERA · ${t(...(statusLabel[payout.status] || ["—", "—"]))}`}
                    />
                  ))}
                </View>
              ) : null}
            </>
          )}
          {(() => {
            const pending = stakingCore.pendingFor(data.stakingPending, owner);
            if (!pending.length) return null;
            return (
              <View style={[s.panel, { gap: 6, borderColor: colors.lime, borderWidth: 1 }]}>
                <Text style={s.eyebrow}>{t("BEING CREDITED", "正在记入")}</Text>
                {pending.map((entry: any) => {
                  const state = creditState[entry.txHash.toLowerCase()];
                  const old = Date.now() - (entry.at || 0) > stakingCore.PENDING_HELP_MS;
                  return (
                    <View key={entry.txHash} style={{ gap: 4 }}>
                      <Row
                        label={entry.kind === "fixed" ? t(`${entry.termDays}-day lock`, `${entry.termDays} 天锁定`) : t("Flexible", "活期")}
                        value={`${tera(entry.amount)} TERA`}
                      />
                      <Text style={s.small}>
                        {state === "waiting" || state === undefined
                          ? t("Waiting for the network to confirm the deposit…", "等待网络确认存入…")
                          : t(`Not credited yet: ${state}`, `尚未记入：${state}`)}
                        {old
                          ? t(
                              ` It has been a while — contact support with transaction ${entry.txHash.slice(0, 10)}….`,
                              ` 已等待较久——请联系支持并提供交易 ${entry.txHash.slice(0, 10)}…。`,
                            )
                          : ""}
                      </Text>
                      <Pressable accessibilityRole="button" onPress={() => void creditPending(entry)}>
                        <Text style={[s.small, { color: colors.green, fontWeight: "700" }]}>{t("Check again", "再次检查")}</Text>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            );
          })()}
          <View style={[s.panel, { gap: 10 }]}>
            <Text style={[s.text, { fontWeight: "700" }]}>{t("Stake TERA", "质押 TERA")}</Text>
            {(() => {
              const epoch = stakingCore.activeEpoch(stakeData?.epochs);
              const held = BigInt(balance?.TERA || "0");
              let entered = 0n;
              try {
                entered = stakeAmount ? BigInt(units(stakeAmount, 18)) : 0n;
              } catch {
                entered = 0n;
              }
              const apr = stakingCore.flexibleApr(epoch, entered);
              const terms: { key: "flexible" | "30" | "45" | "90"; label: string; rate: string }[] = [
                {
                  key: "flexible",
                  label: t("Flexible", "活期"),
                  rate: apr === null ? t("not open", "未开放") : t(`≈ ${apr.toFixed(1)}% variable`, `≈ ${apr.toFixed(1)}% 浮动`),
                },
                ...(["30", "45", "90"] as const).map((days) => ({
                  key: days,
                  label: t(`${days} days`, `${days} 天`),
                  rate: t(
                    `${(stakingCore.FIXED_TERMS[days].apyBps / 100).toFixed(0)}% fixed`,
                    `${(stakingCore.FIXED_TERMS[days].apyBps / 100).toFixed(0)}% 固定`,
                  ),
                })),
              ];
              const reward = stakeTerm === "flexible" ? null : stakingCore.fixedReward(entered, Number(stakeTerm));
              return (
                <>
                  <View style={[s.wrap, { gap: 8 }]}>
                    {terms.map((term) => {
                      const active = stakeTerm === term.key;
                      return (
                        <Pressable
                          key={term.key}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          onPress={() => setStakeTerm(term.key)}
                          style={{
                            paddingVertical: 8,
                            paddingHorizontal: 12,
                            borderRadius: 14,
                            borderWidth: 1,
                            borderColor: active ? colors.green : colors.line,
                            backgroundColor: active ? colors.tint : colors.wash,
                            alignItems: "center",
                          }}
                        >
                          <Text style={{ fontSize: 13, fontWeight: "700", color: active ? colors.green : colors.ink }}>{term.label}</Text>
                          <Text style={{ fontSize: 11, color: active ? colors.green : colors.muted }}>{term.rate}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Field
                    label={t("Amount (TERA)", "数量（TERA）")}
                    value={stakeAmount}
                    onChangeText={setStakeAmount}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    hint={t(`Available: ${tera(held)} TERA`, `可用：${tera(held)} TERA`)}
                  />
                  <Pressable accessibilityRole="button" onPress={() => setStakeAmount(formatUnits(held, 18))}>
                    <Text style={[s.small, { color: colors.green, fontWeight: "700" }]}>{t("Use all", "全部使用")}</Text>
                  </Pressable>
                  <Text style={s.small}>
                    {stakeTerm === "flexible"
                      ? t(
                          "Earns this epoch's rewards, shared with everyone staked, so the rate changes as others stake. Unstake any time.",
                          "赚取本周期奖励，与所有质押者共享，利率随质押量变化。可随时解押。",
                        )
                      : t(
                          `Guaranteed ${tera(reward ?? 0n)} TERA reward. Locked for ${stakeTerm} days with no early unlock; principal and reward are claimable on ${new Date(Date.now() + Number(stakeTerm) * 86_400_000).toLocaleDateString()}.`,
                          `保证奖励 ${tera(reward ?? 0n)} TERA。锁定 ${stakeTerm} 天，不可提前解锁；本金与奖励于 ${new Date(Date.now() + Number(stakeTerm) * 86_400_000).toLocaleDateString()} 可领取。`,
                        )}
                  </Text>
                  {action("Review stake", "审核质押", stakeNow)}
                  <Text style={s.small}>
                    {t(
                      "You sign a TERA transfer to the staking pool. The staking service credits it once the network confirms it — usually under a minute.",
                      "你签名一笔转入质押池的 TERA 转账。网络确认后（通常不到一分钟），质押服务即会记入。",
                    )}
                  </Text>
                </>
              );
            })()}
          </View>
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
          {scheduleRun && !isPrivate ? (
            <View style={[s.panel, { borderColor: colors.lime, borderWidth: 1, backgroundColor: colors.tint, gap: 4 }]}>
              <Text style={[s.text, { fontWeight: "700", color: colors.lime }]}>
                {t(`Scheduled payment · ${scheduleRun.label}`, `定期付款 · ${scheduleRun.label}`)}
              </Text>
              <Text style={s.small}>
                {t(
                  `Due ${scheduleRun.date}. Signing this send marks it paid. Change anything you need first.`,
                  `到期日 ${scheduleRun.date}。签名此转账即标记为已支付，如需修改请先修改。`,
                )}
              </Text>
            </View>
          ) : null}
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
                    clearAmount();
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
              {amountModeToggle(selectedAsset.symbol)}
              <TextInput
                autoFocus
                value={amountDisplay()}
                onChangeText={(value) => {
                  setAmountDisplay(selectedAsset.symbol, selectedAsset.decimals, value);
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
              <Text style={s.small}>{amountCounterpart(selectedAsset.symbol)}</Text>
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
              {(tagsAvailable() || biz.emailAvailable()) && (
                <>
                  <Text style={s.eyebrow}>{t("SEND TO", "发送至")}</Text>
                  <Choices
                    options={[nameChoice, t("Wallet address", "钱包地址")]}
                    value={
                      recipientKind === "tag"
                        ? nameChoice
                        : t("Wallet address", "钱包地址")
                    }
                    select={(choice) => {
                      setRecipientKind(choice === nameChoice ? "tag" : "address");
                      setRecipient("");
                      setTagLookup({ state: "idle" });
                    }}
                  />
                </>
              )}
              <Field
                label={
                  recipientKind === "tag"
                    ? nameChoice
                    : t("Receiving wallet address", "收款钱包地址")
                }
                value={recipient}
                placeholder={
                  recipientKind === "tag"
                    ? biz.emailAvailable()
                      ? "@astra · pay@acme.com"
                      : "@astra"
                    : "0x…"
                }
                onChangeText={(value) => {
                  setRecipient(value);
                  // Any edit invalidates what the registry said a moment ago.
                  // The lookup runs again when the owner continues, and the
                  // stale address must not survive until then.
                  if (tagLookup.state !== "idle") setTagLookup({ state: "idle" });
                }}
              />
              {recipientKind === "address" && (
                <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 4 }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("Scan QR code", "扫描二维码")}
                    onPress={() => {
                      void Clipboard.getStringAsync()
                        .then((text) => {
                          const parsed = parseQrAddress(text);
                          if (parsed) {
                            setRecipient(parsed);
                            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                            setNotice({
                              title: t("Address scanned", "已扫描地址"),
                              body: parsed,
                              tone: "success",
                            });
                          } else {
                            setNotice({
                              title: t("No QR payload in clipboard", "剪贴板无 QR 内容"),
                              body: t("Copy an address or ethereum: URI to scan.", "请先复制地址或 ethereum: URI。"),
                              tone: "error",
                            });
                          }
                        })
                        .catch(() => {});
                    }}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                      paddingVertical: 6,
                      paddingHorizontal: 12,
                      borderRadius: 12,
                      backgroundColor: colors.wash,
                      opacity: pressed ? 0.6 : 1,
                    })}
                  >
                    <Icon name="qr-code" size={16} color={colors.green} />
                    <Text style={[s.small, { color: colors.green, fontWeight: "700" }]}>
                      {t("Scan QR", "扫二维码")}
                    </Text>
                  </Pressable>
                </View>
              )}
              {recipientKind === "address" && recipientPicks()}
              {recipientKind === "tag" ? (
                <Text style={[s.small, tagLookup.state === "error" && { color: colors.danger }]}>
                  {tagLookup.state === "looking"
                    ? t("Looking up the tag…", "正在查询标签…")
                    : tagLookup.state === "found"
                      ? `${nameLabel(tagLookup.tag)} · ${tagLookup.address}`
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
              <Row
                label={t("Estimated USD", "\u9884\u8ba1\u7f8e\u5143\u4ef7\u503c")}
                value={usdReviewRow(selectedAsset.symbol, amount || "0")[1]}
              />
              {tagLookup.state === "found" && (
                <Row
                  label={biz.isEmail(tagLookup.tag) ? t("Email", "邮箱") : t("Tag", "标签")}
                  value={nameLabel(tagLookup.tag)}
                />
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
          {flowStep === 4 && (
            <Field
              label={t("Note (optional, only you see it)", "备注（可选，仅你可见）")}
              value={payNote}
              onChangeText={setPayNote}
              maxLength={notesCore.LIMITS.maxLength}
              autoCapitalize="sentences"
              placeholder={
                business
                  ? t("Invoice number, client, purpose…", "发票号、客户、用途…")
                  : t("What's this for?", "这笔付款是做什么的？")
              }
            />
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
      const paySymbol = trade === "BUY" ? (assetSymbol === "TERA" ? "ETH" : "USDG") : assetSymbol;
      const receiveSymbol = trade === "BUY" ? assetSymbol : assetSymbol === "TERA" ? "ETH" : "USDG";
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
            onBack={() => setPage(swapReturnPage)}
            backLabel={t("Back", "返回")}
          />
          <Text style={[s.small, { textAlign: "center" }]}>
            {t("Choose tokens, then review the live route.", "选择代币，然后审核实时路线。")}
          </Text>
          {limitRun ? (
            <View style={[s.panel, { borderColor: colors.lime, borderWidth: 1, backgroundColor: colors.tint, gap: 4 }]}>
              <Text style={[s.text, { fontWeight: "700", color: colors.lime }]}>
                {limitRun.kind === "stop"
                  ? t(`Stop-loss · Sell ${limitRun.asset}`, `止损 · 卖出 ${limitRun.asset}`)
                  : limitRun.kind === "take"
                    ? t(`Take-profit · Sell ${limitRun.asset}`, `止盈 · 卖出 ${limitRun.asset}`)
                    : t(`Limit order · ${limitRun.side === "buy" ? "Buy" : "Sell"} ${limitRun.asset}`, `限价单 · ${limitRun.side === "buy" ? "买入" : "卖出"} ${limitRun.asset}`)}
              </Text>
              <Text style={s.small}>
                {trade === (limitRun.side === "buy" ? "BUY" : "SELL") && assetSymbol === limitRun.asset
                  ? limitRun.kind === "stop"
                    ? (() => {
                        const now = prices[limitRun.asset];
                        const below =
                          Number.isFinite(now) && Number(limitRun.limit) > 0
                            ? ((Number(limitRun.limit) - now) / Number(limitRun.limit)) * 100
                            : null;
                        return t(
                          `Stop-loss at $${limitRun.limit}${below !== null ? `; the price is now ${valueCore.format(now)}${below > 0 ? `, ${below.toFixed(1)}% below your stop` : ""}` : ""}. A stop sells at the live price, protected by your slippage limit, not by the stop price.`,
                          `止损价 $${limitRun.limit}${below !== null ? `；当前价格 ${valueCore.format(now)}${below > 0 ? `，低于止损价 ${below.toFixed(1)}%` : ""}` : ""}。止损按实时价格卖出，受滑点上限保护，而非止损价。`,
                        );
                      })()
                    : t(
                        "The swap's minimum output is set from your price, so it reverts rather than fill worse.",
                        "兑换的最低收到按你的价格设置，价格变差时将回滚而不会以更差价格成交。",
                      )
                  : t(
                      "This swap no longer matches the order, so the limit won't apply to it.",
                      "此兑换已与订单不一致，限价不再适用。",
                    )}
              </Text>
            </View>
          ) : null}
          {scheduleRun?.kind === "buy" ? (
            <View style={[s.panel, { borderColor: colors.lime, borderWidth: 1, backgroundColor: colors.tint, gap: 4 }]}>
              <Text style={[s.text, { fontWeight: "700", color: colors.lime }]}>
                {t(`Recurring buy · ${scheduleRun.label}`, `定期买入 · ${scheduleRun.label}`)}
              </Text>
              <Text style={s.small}>
                {trade === "BUY" && assetSymbol === scheduleRun.asset
                  ? t(
                      `Due ${scheduleRun.date}. Signing this swap records the buy. You'll see the live quote before you sign.`,
                      `到期日 ${scheduleRun.date}。签名此兑换即记录本次买入，签名前会显示实时报价。`,
                    )
                  : t(
                      `This swap no longer matches the ${scheduleRun.asset} buy, so it won't be recorded against it.`,
                      `此兑换已与 ${scheduleRun.asset} 定期买入不一致，不会计入该计划。`,
                    )}
              </Text>
            </View>
          ) : null}
          <View style={s.panel}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={s.eyebrow}>{t("YOU PAY", "你支付")}</Text>
              {payBalance && (
                <Pressable
                  onPress={() => {
                    setAmountInUsd(false);
                    setUsdAmountInput("");
                    setAmount(payBalance);
                  }}
                >
                  <Text style={s.small}>
                    {t("Balance", "余额")}: {shortAmount(payBalance)}
                  </Text>
                </Pressable>
              )}
            </View>
            <View style={s.wrap}>{swapChip(paySymbol, () => setSwapPayPicker(true))}</View>
            <View style={{ alignSelf: "flex-end", marginTop: 12 }}>
              {amountModeToggle(paySymbol)}
            </View>
            <TextInput
              value={amountDisplay()}
              onChangeText={(value) => setAmountDisplay(paySymbol, payAsset.decimals, value)}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={colors.muted}
              style={{ fontSize: 38, color: colors.ink, fontWeight: "700", paddingTop: 18 }}
            />
            <Text style={s.small}>{amountCounterpart(paySymbol)}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("Swap pay and receive", "交换支付与接收方向")}
            onPress={() => {
              clearAmount();
              setTrade((current) => (current === "BUY" ? "SELL" : "BUY"));
            }}
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
          {/* Web only for now: the Android release keeps the 1% default until it ships this. */}
          {Platform.OS === "web" && (
            <View style={[s.panel, { gap: 10 }]}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={s.eyebrow}>{t("SLIPPAGE LIMIT", "滑点上限")}</Text>
                <Text style={[s.small, { color: colors.green, fontWeight: "600" }]}>
                  {slippageCore.slippageLabel(slippageBps)}
                </Text>
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {slippageCore.SLIPPAGE_CHOICES.map((bps: number) => {
                  const active = slippageBps === bps;
                  return (
                    <Pressable
                      key={bps}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      onPress={() => setSlippageBps(bps)}
                      style={{
                        paddingVertical: 8,
                        paddingHorizontal: 14,
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: active ? colors.green : colors.line,
                        backgroundColor: active ? colors.tint : colors.wash,
                      }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: "700", color: active ? colors.green : colors.ink }}>
                        {slippageCore.slippageLabel(bps)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={s.small}>
                {t(
                  "The swap is refused on-chain if it would return more than this below the quote. Lower protects the price; higher fails less often when the market moves.",
                  "若成交低于报价超过此比例，兑换将在链上被拒绝。越低越保护价格；越高在行情波动时越不易失败。",
                )}
              </Text>
            </View>
          )}
          {action("Review live route", "审核实时路线", prepareTrade)}
          {!limitRun && (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                openLimitForm("", { asset: assetSymbol, side: trade === "SELL" ? "sell" : "buy" })
              }
              style={{ alignSelf: "center", padding: 8 }}
            >
              <Text style={[s.small, { color: colors.green, fontWeight: "700" }]}>
                {t("Set a limit order instead", "改为设置限价单")}
              </Text>
            </Pressable>
          )}
        </>
      );
    }
    if (page === "token-detail") {
      const detailToken =
        popularTokens.find(({ symbol }) => symbol === tokenDetailSymbol) ||
        assets.find((asset) => asset.symbol === tokenDetailSymbol);
      const name = detailToken?.name || tokenDetailSymbol;
      const price = prices[tokenDetailSymbol];
      const change = priceChanges[tokenDetailSymbol];
      const up = Number.isFinite(change) && change! >= 0;
      const heldEntry = held.find(({ asset }) => asset.symbol === tokenDetailSymbol);
      const isListed =
        tokenDetailSymbol === "ETH" ||
        tokenDetailSymbol === "TERA" ||
        listedSymbols.includes(tokenDetailSymbol);
      const canHoldHere =
        tokenDetailSymbol === "TERA" || assets.some((asset) => asset.symbol === tokenDetailSymbol);
      // Arc (Circle's chain) pays gas in USDC rather than a native coin — the
      // absence of a price here isn't "not fetched yet", it's structural,
      // so the price line, trend and chart (which would only ever show
      // "not enough history") are left out instead of implying they might
      // fill in later.
      const noMarket = tokenDetailSymbol === "ARC";
      const symbolAlerts = (data.priceAlerts || []).filter((a: any) => a.symbol === tokenDetailSymbol);
      return (
        <>
          <Header
            title={name}
            onBack={() => setPage(marketReturnPage)}
            backLabel={t("Back", "返回")}
          />
          <View style={[s.panel, { alignItems: "center", gap: 10, paddingVertical: 28 }]}>
            <TokenIcon
              symbol={tokenDetailSymbol}
              size={56}
              chainBadge={canHoldHere}
            />
            <Text style={[s.label, { fontSize: 17 }]}>{name}</Text>
            {noMarket ? null : (
              <Text style={{ fontSize: 34, fontWeight: "700", color: colors.ink }}>
                {Number.isFinite(price) && price! > 0 ? valueCore.format(price) : "—"}
              </Text>
            )}
            {!noMarket && Number.isFinite(change) ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Icon
                  name={up ? "arrow-up" : "arrow-down"}
                  size={14}
                  color={up ? colors.green : colors.danger}
                />
                <Text style={{ color: up ? colors.green : colors.danger, fontWeight: "700" }}>
                  {Math.abs(change!).toFixed(2)}% {t("today", "今日")}
                </Text>
              </View>
            ) : null}
            {isListed || tokenDetailSymbol === "USDG" ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => openTokenBuy(tokenDetailSymbol)}
                style={({ pressed }) => ({
                  marginTop: 6,
                  alignSelf: "center",
                  paddingVertical: 9,
                  paddingHorizontal: 22,
                  borderRadius: 14,
                  backgroundColor: colors.tint,
                  opacity: pressed ? 0.65 : 1,
                })}
              >
                <Text style={{ color: colors.green, fontWeight: "800" }}>
                  {tokenDetailSymbol === "USDG" ? t("Add", "添加") : t("Buy", "买入")}
                </Text>
              </Pressable>
            ) : null}
          </View>
          {noMarket ? null : (
            <View style={[s.panel, { gap: 12 }]}>
              <TokenChart points={chartPoints} up={up} />
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                {(["1D", "1W", "1M", "1Y"] as const).map((range) => (
                  <Pressable
                    key={range}
                    accessibilityRole="button"
                    onPress={() => setChartRange(range)}
                    style={({ pressed }) => ({
                      flex: 1,
                      marginHorizontal: 3,
                      paddingVertical: 7,
                      borderRadius: 10,
                      alignItems: "center",
                      backgroundColor: range === chartRange ? colors.tint : "transparent",
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text
                      style={[
                        s.small,
                        {
                          fontWeight: "700",
                          color: range === chartRange ? colors.green : colors.muted,
                        },
                      ]}
                    >
                      {range}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
          {heldEntry ? (
            <View style={[s.panel, { gap: 6 }]}>
              <Text style={s.eyebrow}>{t("Your balance", "你的余额")}</Text>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={s.label}>
                  {shortAmount(heldEntry.amount)} {tokenDetailSymbol}
                </Text>
                <Text style={s.small}>
                  {valueCore.format(valueCore.valueOf(heldEntry.amount, price))}
                </Text>
              </View>
              {(() => {
                const row = pnlSummary?.rows.find((entry: any) => entry.symbol === tokenDetailSymbol);
                if (!row) return null;
                return (
                  <>
                    <Row
                      label={t("Average cost", "平均成本")}
                      value={
                        row.average === null
                          ? t("Unknown", "未知")
                          : `${formatFiat(row.average, data.fiatCurrency || "USD")}${row.source === "estimated" ? t(" (est.)", "（估算）") : row.source === "manual" ? t(" (yours)", "（自填）") : ""}`
                      }
                    />
                    {row.unrealized !== null ? (
                      <Row
                        label={t("Unrealized P&L", "未实现盈亏")}
                        value={shownValue(`${signedFiat(row.unrealized)} (${signedPct(row.percent)})`)}
                      />
                    ) : null}
                    <Pressable accessibilityRole="button" onPress={() => setPage("pnl")}>
                      <Text style={[s.small, { color: colors.green, fontWeight: "700" }]}>
                        {t("Profit & loss details ›", "盈亏详情 ›")}
                      </Text>
                    </Pressable>
                    {limitTradable(tokenDetailSymbol) ? (
                      <Button onPress={() => openProtect(tokenDetailSymbol)}>
                        {t("Protect with stop-loss / take-profit", "设置止损 / 止盈")}
                      </Button>
                    ) : null}
                  </>
                );
              })()}
            </View>
          ) : null}
          {!noMarket && (
            <View style={[s.panel, { gap: 12 }]}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Icon name="bell-outline" size={18} color={colors.green} />
                  <Text style={[s.eyebrow, { color: colors.ink }]}>{t("Set Price Alert", "设置价格预警")}</Text>
                </View>
                {symbolAlerts.length > 0 && (
                  <Text style={[s.small, { color: colors.green, fontWeight: "700" }]}>
                    {symbolAlerts.length} {t("active", "进行中")}
                  </Text>
                )}
              </View>
              <Text style={s.small}>
                {t(
                  `Set a target price alert for ${tokenDetailSymbol}. You'll be notified when price goes ${alertCondition} target.`,
                  `为 ${tokenDetailSymbol} 设置目标价格预警。当价格${alertCondition === "above" ? "高于" : "低于"}目标价时，你将收到提醒。`,
                )}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <TextInput
                    value={alertPriceInput}
                    onChangeText={(val) => setAlertPriceInput(val.replace(",", "."))}
                    keyboardType="decimal-pad"
                    placeholder={Number.isFinite(price) && price! > 0 ? String(price) : "0.00"}
                    placeholderTextColor={colors.muted}
                    style={{
                      height: 44,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: colors.line,
                      backgroundColor: colors.wash,
                      paddingHorizontal: 12,
                      fontSize: 16,
                      fontWeight: "600",
                      color: colors.ink,
                    }}
                  />
                </View>
                <View style={{ flexDirection: "row", gap: 4, backgroundColor: colors.wash, borderRadius: 12, padding: 3, borderWidth: 1, borderColor: colors.line }}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setAlertCondition("above")}
                    style={{
                      paddingVertical: 7,
                      paddingHorizontal: 12,
                      borderRadius: 9,
                      backgroundColor: alertCondition === "above" ? colors.green : "transparent",
                    }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: "700", color: alertCondition === "above" ? colors.paper : colors.muted }}>
                      {t("≥ Above", "≥ 高于")}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setAlertCondition("below")}
                    style={{
                      paddingVertical: 7,
                      paddingHorizontal: 12,
                      borderRadius: 9,
                      backgroundColor: alertCondition === "below" ? colors.green : "transparent",
                    }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: "700", color: alertCondition === "below" ? colors.paper : colors.muted }}>
                      {t("≤ Below", "≤ 低于")}
                    </Text>
                  </Pressable>
                </View>
              </View>
              <Button
                primary
                onPress={() => {
                  const targetNum = Number(alertPriceInput || price || 0);
                  if (!Number.isFinite(targetNum) || targetNum <= 0) {
                    setNotice({
                      title: t("Invalid Price", "无效价格"),
                      body: t("Please enter a valid target price.", "请输入有效的目标价格。"),
                      tone: "error",
                    });
                    return;
                  }
                  const newAlert: PriceAlert = {
                    id: "pa_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
                    symbol: tokenDetailSymbol,
                    targetPrice: targetNum,
                    condition: alertCondition,
                    createdAt: new Date().toISOString(),
                  };
                  const updated = [...(dataRef.current.priceAlerts || []), newAlert];
                  void run(() => store({ ...dataRef.current, priceAlerts: updated }));
                  setAlertPriceInput("");
                  setNotice({
                    title: t("Price Alert Set", "价格预警已设置"),
                    body: t(
                      `Alert set for ${tokenDetailSymbol} when price is ${alertCondition} $${targetNum.toLocaleString()}.`,
                      `已设置 ${tokenDetailSymbol} 当价格 ${alertCondition === "above" ? "≥" : "≤"} $${targetNum.toLocaleString()} 时预警。`,
                    ),
                    tone: "success",
                  });
                }}
              >
                {t("Set Price Alert", "设置价格预警")}
              </Button>
              {symbolAlerts.length > 0 && (
                <View style={{ gap: 8, marginTop: 4 }}>
                  <Text style={s.eyebrow}>{t("Active Alerts", "活跃预警")}</Text>
                  {symbolAlerts.map((alert: any) => (
                    <View
                      key={alert.id}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        paddingVertical: 8,
                        paddingHorizontal: 12,
                        borderRadius: 10,
                        backgroundColor: colors.wash,
                        borderWidth: 1,
                        borderColor: colors.line,
                      }}
                    >
                      <View style={{ gap: 2 }}>
                        <Text style={[s.text, { fontWeight: "700" }]}>
                          {alert.condition === "above" ? "≥" : "≤"} ${Number(alert.targetPrice).toLocaleString()}
                        </Text>
                        <Text style={s.small}>
                          {new Date(alert.createdAt).toLocaleDateString()}
                        </Text>
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                          const updated = (dataRef.current.priceAlerts || []).filter((a: any) => a.id !== alert.id);
                          void run(() => store({ ...dataRef.current, priceAlerts: updated }));
                        }}
                        hitSlop={8}
                      >
                        <Icon name="trash-can-outline" size={18} color={colors.danger} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}
          <View style={[s.panel, { gap: 6 }]}>
            <Text style={s.eyebrow}>{t("About", "关于")}</Text>
            <Text style={s.small}>
              {noMarket
                ? t(
                    "Arc is Circle's EVM-compatible chain for stablecoin finance. Gas is paid in USDC rather than a separate native coin, so there's no ARC token or price to show.",
                    "Arc 是 Circle 推出的、面向稳定币金融的兼容 EVM 链。手续费以 USDC 支付，没有独立的原生代币，因此没有 ARC 代币或价格可显示。",
                  )
                : isListed || tokenDetailSymbol === "TERA"
                  ? t(
                      "Tradable on Robinhood Chain inside Tera Wallet.",
                      "可在 Tera 钱包内于 Robinhood Chain 上交易。",
                    )
                  : t("Not yet tradable inside Tera Wallet.", "暂不支持在 Tera 钱包内交易。")}
            </Text>
          </View>
          <View style={{ gap: 10 }}>
            <Text style={s.eyebrow}>{t("More tokens", "更多代币")}</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 10 }}
            >
              {popularTokens
                .filter((token) => token.symbol !== tokenDetailSymbol)
                .map((token) => (
                  <Pressable
                    key={token.symbol}
                    accessibilityRole="button"
                    onPress={() => openTokenDetail(token.symbol)}
                    style={({ pressed }) => [
                      s.panel,
                      { width: 92, alignItems: "center", gap: 6, opacity: pressed ? 0.7 : 1 },
                    ]}
                  >
                    <TokenIcon symbol={token.symbol} size={36} />
                    <Text style={[s.small, { fontWeight: "700" }]} numberOfLines={1}>
                      {token.symbol}
                    </Text>
                    <Text style={s.small} numberOfLines={1}>
                      {Number.isFinite(prices[token.symbol]) && prices[token.symbol] > 0
                        ? valueCore.format(prices[token.symbol])
                        : "—"}
                    </Text>
                  </Pressable>
                ))}
            </ScrollView>
          </View>
        </>
      );
    }
    if (page === "bridge-pending") {
      const token = popularTokens.find(({ symbol }) => symbol === bridgeTargetSymbol);
      return (
        <>
          <Header
            title={t(
              "Bridge to " + (token?.name || bridgeTargetSymbol),
              "\u8de8\u94fe\u81f3 " + (token?.name || bridgeTargetSymbol),
            )}
            onBack={() => setPage(marketReturnPage)}
            backLabel={t("Back", "\u8fd4\u56de")}
          />
          <View style={[s.panel, { alignItems: "center", gap: 14, paddingVertical: 30 }]}>
            <TokenIcon symbol={bridgeTargetSymbol} size={58} />
            <Text style={[s.label, { textAlign: "center" }]}>
              {t("Coming soon in Tera Wallet", "Tera \u94b1\u5305\u5373\u5c06\u652f\u6301")}
            </Text>
            <Text style={[s.small, { textAlign: "center", lineHeight: 20 }]}>
              {bridgeTargetSymbol === "SOL"
                ? t(
                    "You can bridge to an external Solana address. Holding SOL inside Tera Wallet is coming soon.",
                    "\u76ee\u524d\u53ef\u8de8\u94fe\u81f3\u5916\u90e8 Solana \u5730\u5740\u3002\u5c06 SOL \u4fdd\u5b58\u5728 Tera \u94b1\u5305\u5185\u7684\u529f\u80fd\u5373\u5c06\u4e0a\u7ebf\u3002",
                  )
                : t(
                    `${bridgeTargetSymbol} is listed on Robinhood Crypto. Holding it in Tera Wallet and a verified bridge route are coming soon.`,
                    `${bridgeTargetSymbol} \u5df2\u5728 Robinhood Crypto \u4e0a\u5e02\u3002Tera \u94b1\u5305\u5185\u4fdd\u5b58\u548c\u53ef\u9a8c\u8bc1\u7684\u8de8\u94fe\u8def\u7ebf\u5373\u5c06\u4e0a\u7ebf\u3002`,
                  )}
            </Text>
          </View>
          <Button
            primary
            onPress={() => {
              openFlow("bridge");
              if (bridgeTargetSymbol === "SOL") {
                setDestination(792703809);
                setOutSymbol("SOL");
                setBridgeStep(1);
              }
            }}
          >
            {bridgeTargetSymbol === "SOL"
              ? t(
                  "Bridge SOL to an external wallet",
                  "\u5c06 SOL \u8de8\u94fe\u81f3\u5916\u90e8\u94b1\u5305",
                )
              : t(
                  "View supported external routes",
                  "\u67e5\u770b\u652f\u6301\u7684\u5916\u90e8\u8de8\u94fe\u8def\u7ebf",
                )}
          </Button>
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
            onBack={() =>
              bridgeStep > 0 ? setBridgeStep((step) => step - 1) : setPage(bridgeReturnPage)
            }
            backLabel={t("Back", "返回")}
          />
          <View style={[s.panel, { gap: 5, backgroundColor: colors.wash }]}>
            <Text style={s.label}>
              {t("Bridge to an external wallet", "\u8de8\u94fe\u81f3\u5916\u90e8\u94b1\u5305")}
            </Text>
            <Text style={s.small}>
              {t(
                "Holding Solana, Base and Arc assets inside Tera Wallet is coming soon. Check the recipient address before signing.",
                "\u5728 Tera \u94b1\u5305\u5185\u4fdd\u5b58 Solana\u3001Base \u548c Arc \u8d44\u4ea7\u7684\u529f\u80fd\u5373\u5c06\u4e0a\u7ebf\u3002\u7b7e\u540d\u524d\u8bf7\u6838\u5bf9\u6536\u6b3e\u5730\u5740\u3002",
              )}
            </Text>
          </View>
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
                          <Text style={s.small}>
                            {t(
                              "In-wallet holding: Coming soon",
                              "\u94b1\u5305\u5185\u4fdd\u5b58\uff1a\u5373\u5c06\u4e0a\u7ebf",
                            )}
                          </Text>
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
                      onPress={() => {
                        setAssetSymbol(asset.symbol);
                        clearAmount();
                      }}
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
                {amountModeToggle(selectedSource.symbol)}
                <TextInput
                  autoFocus
                  value={amountDisplay()}
                  onChangeText={(value) => {
                    setAmountDisplay(selectedSource.symbol, selectedSource.decimals, value);
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
                <Text style={s.small}>{amountCounterpart(selectedSource.symbol)}</Text>
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
              <Row
                label={t("Estimated USD", "\u9884\u8ba1\u7f8e\u5143\u4ef7\u503c")}
                value={usdReviewRow(selectedSource.symbol, amount || "0")[1]}
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
    if (page === "network") {
      const r = netReading;
      const feeWei = networkSpeed.transferFeeWei(r?.gasPriceWei ?? null);
      const feeEth = feeWei == null ? null : Number(formatUnits(feeWei, 18));
      const feeUsd = feeEth != null && prices.ETH ? feeEth * prices.ETH : null;
      return (
        <>
          <Header title={t("Network", "网络")} onBack={() => setPage("home")} backLabel={t("Home", "首页")} />
          <View style={[s.panel, { alignItems: "center", gap: 8, paddingVertical: 26 }]}>
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 28,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: colors.raised,
              }}
            >
              <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: netColor }} />
            </View>
            <Text style={[s.label, { fontSize: 20 }]}>{netWord}</Text>
            <Text style={s.small}>Robinhood Chain</Text>
            {r?.estimateMs != null ? (
              <Text style={[s.small, { textAlign: "center" }]}>
                {t(
                  `A payment sent now should confirm in about ${duration(r.estimateMs)}.`,
                  `现在发送的付款预计约 ${duration(r.estimateMs)} 内确认。`,
                )}
              </Text>
            ) : r ? (
              <Text style={[s.small, { textAlign: "center", color: colors.danger }]}>
                {t(
                  "Tera can't reach the network right now. Payments can't be sent until it's back.",
                  "Tera 暂时无法连接网络。恢复前无法发送付款。",
                )}
              </Text>
            ) : null}
          </View>
          <Group title={t("Right now", "当前")}>
            <Row
              label={t("Response time", "响应时间")}
              value={r?.latencyMs != null ? networkSpeed.formatLatency(r.latencyMs) : "—"}
            />
            <Row
              label={t("Block time", "出块时间")}
              value={
                r?.blockTimeMs != null
                  ? t(`${(r.blockTimeMs / 1000).toFixed(2)}s average`, `平均 ${(r.blockTimeMs / 1000).toFixed(2)} 秒`)
                  : "—"
              }
            />
            <Row
              label={t("Latest block", "最新区块")}
              value={
                r?.block != null
                  ? `#${r.block.toLocaleString()}${r.blockAgeMs != null ? ` · ${t(`${duration(r.blockAgeMs)} ago`, `${duration(r.blockAgeMs)}前`)}` : ""}`
                  : "—"
              }
            />
            <Row
              label={t("Est. confirmation", "预计确认")}
              value={r?.estimateMs != null ? duration(r.estimateMs) : "—"}
            />
            <Row
              label={t("Gas price", "Gas 价格")}
              value={r?.gasPriceWei != null ? `${networkSpeed.formatGwei(r.gasPriceWei)} gwei` : "—"}
            />
            <Row
              label={t("Token transfer fee", "代币转账费用")}
              value={
                feeEth != null
                  ? `~${feeEth.toPrecision(2)} ETH${feeUsd != null ? ` (${feeUsd < 0.01 ? "<$0.01" : `$${feeUsd.toFixed(2)}`})` : ""}`
                  : "—"
              }
            />
          </Group>
          <View style={[s.panel, { gap: 6 }]}>
            <Text style={s.small}>
              {t(
                "Response time is how long the network takes to answer this device — your own connection is part of it. Block time is how often Robinhood Chain confirms a batch of transactions. Tera checks every 15 seconds while the app is open.",
                "响应时间是网络回应本设备所需的时间，其中包括你自己的网络连接。出块时间是 Robinhood Chain 确认一批交易的频率。应用打开时，Tera 每 15 秒检测一次。",
              )}
            </Text>
            {r ? (
              <Text style={s.small}>
                {t(`Checked ${new Date(r.at).toLocaleTimeString()}`, `检测于 ${new Date(r.at).toLocaleTimeString()}`)}
              </Text>
            ) : null}
          </View>
          <Button onPress={() => void probeNow()}>{t("Check now", "立即检测")}</Button>
        </>
      );
    }
    if (page === "protect") {
      const set = (field: string) => (value: string) => setProtectForm((current) => ({ ...current, [field]: value }));
      const symbol = protectForm.asset || "";
      const row = pnlSummary?.rows.find((entry: any) => entry.symbol === symbol);
      const price = prices[symbol];
      const qty = Number(protectForm.amount) || 0;
      const atLevel = (level: string) => {
        const target = Number(level);
        if (!(target > 0) || !qty) return null;
        const proceeds = target * qty;
        return row?.average != null ? { proceeds, pnl: proceeds - row.average * qty } : { proceeds, pnl: null };
      };
      const toggle = (field: string, label: string) => (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: protectForm[field] === "yes" }}
          onPress={() => set(field)(protectForm[field] === "yes" ? "no" : "yes")}
          style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
        >
          <Icon
            name={protectForm[field] === "yes" ? "checkbox-marked" : "checkbox-blank-outline"}
            size={22}
            color={protectForm[field] === "yes" ? colors.green : colors.muted}
          />
          <Text style={[s.text, { fontWeight: "700" }]}>{label}</Text>
        </Pressable>
      );
      const outcome = (level: string) => {
        const result = atLevel(level);
        if (!result) return null;
        return (
          <Text style={s.small}>
            {t(
              `Sells for about ${formatFiat(result.proceeds, data.fiatCurrency || "USD")}${result.pnl !== null ? ` · ${signedFiat(result.pnl)} vs your cost` : ""}`,
              `约可卖得 ${formatFiat(result.proceeds, data.fiatCurrency || "USD")}${result.pnl !== null ? ` · 相对成本 ${signedFiat(result.pnl)}` : ""}`,
            )}
          </Text>
        );
      };
      const expiryLabels: Record<string, [string, string]> = {
        day: ["1 day", "1 天"],
        week: ["1 week", "1 周"],
        month: ["1 month", "1 个月"],
        never: ["Until cancelled", "直到取消"],
      };
      return (
        <>
          <Header title={t(`Protect ${symbol}`, `保护 ${symbol}`)} onBack={() => setPage("pnl")} backLabel={t("Back", "返回")} />
          <View style={s.panel}>
            <Row label={t("Price now", "当前价格")} value={Number.isFinite(price) ? valueCore.format(price) : "—"} />
            {row?.average != null ? (
              <Row label={t("Your average cost", "你的平均成本")} value={formatFiat(row.average, data.fiatCurrency || "USD")} />
            ) : null}
            {protectForm.from !== "none" ? (
              <Text style={s.small}>
                {protectForm.from === "cost"
                  ? t("Suggested: 10% below and 20% above your average cost.", "建议值：低于平均成本 10%、高于 20%。")
                  : t("Suggested: 10% below and 20% above today's price.", "建议值：低于当前价格 10%、高于 20%。")}
              </Text>
            ) : null}
          </View>
          <Field
            label={t(`Amount to sell (${symbol})`, `卖出数量（${symbol}）`)}
            value={protectForm.amount || ""}
            onChangeText={set("amount")}
            keyboardType="decimal-pad"
            placeholder="0.00"
          />
          <View style={[s.panel, { gap: 8 }]}>
            {toggle("useStop", t("Stop-loss", "止损"))}
            {protectForm.useStop === "yes" ? (
              <>
                <Field
                  label={t("Sell if the price falls to ($)", "价格跌至以下时卖出（美元）")}
                  value={protectForm.stop || ""}
                  onChangeText={set("stop")}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                />
                {outcome(protectForm.stop || "")}
                <Text style={s.small}>
                  {t(
                    "A stop sells at the live price when you sign, protected by your slippage limit. It can fill below the stop if the price keeps falling.",
                    "止损在你签名时按实时价格卖出，受滑点上限保护。若价格持续下跌，成交价可能低于止损价。",
                  )}
                </Text>
              </>
            ) : null}
          </View>
          <View style={[s.panel, { gap: 8 }]}>
            {toggle("useTake", t("Take-profit", "止盈"))}
            {protectForm.useTake === "yes" ? (
              <>
                <Field
                  label={t("Sell if the price rises to ($)", "价格涨至以下时卖出（美元）")}
                  value={protectForm.take || ""}
                  onChangeText={set("take")}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                />
                {outcome(protectForm.take || "")}
                <Text style={s.small}>
                  {t(
                    "A take-profit is enforced on chain: the sale can't fill below your price.",
                    "止盈在链上强制执行：成交价不会低于你的价格。",
                  )}
                </Text>
              </>
            ) : null}
          </View>
          <View style={{ gap: 8 }}>
            <Text style={s.eyebrow}>{t("EXPIRES AFTER", "有效期")}</Text>
            <View style={[s.wrap, { gap: 8 }]}>
              {Object.keys(limitCore.EXPIRIES).map((key) => (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: protectForm.expiry === key }}
                  onPress={() => set("expiry")(key)}
                  style={{
                    paddingVertical: 8,
                    paddingHorizontal: 14,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: protectForm.expiry === key ? colors.green : colors.line,
                    backgroundColor: protectForm.expiry === key ? colors.tint : colors.wash,
                  }}
                >
                  <Text style={{ fontSize: 13, fontWeight: "700", color: protectForm.expiry === key ? colors.green : colors.ink }}>
                    {t(...expiryLabels[key])}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          {protectError ? <Text style={[s.small, { color: colors.danger }]}>{protectError}</Text> : null}
          {action("Protect holding", "设置保护", saveProtect)}
          <Text style={[s.small, { textAlign: "center" }]}>
            {t(
              "Nothing sells on its own. Tera tells you when a level is reached and you sign the sale, so a stop is only as quick as your tap.",
              "不会自动卖出。达到价格时 Tera 会通知你，由你签名卖出，因此止损的速度取决于你的操作。",
            )}
          </Text>
        </>
      );
    }
    if (page === "pnl") {
      const total = pnlSummary?.total;
      const sourceLabel = (source: string) =>
        source === "exact"
          ? t("from your swaps", "来自你的兑换")
          : source === "estimated"
            ? t("est. from market prices", "按市场价估算")
            : source === "manual"
              ? t("your figure", "你填写的")
              : t("unknown", "未知");
      const saveCost = async (symbol: string, value: string) => {
        const next = { ...(dataRef.current.pnlOverrides || {}) };
        const clean = value.trim().replace(/^\$/, "");
        if (clean) {
          check(/^\d+(\.\d+)?$/.test(clean) && Number(clean) > 0, t("Enter a price above zero.", "请输入大于零的价格。"));
          next[symbol] = clean;
        } else delete next[symbol];
        await store({ ...dataRef.current, pnlOverrides: next });
        setCostEdit(null);
      };
      return (
        <>
          <Header title={t("Profit & loss", "盈亏")} onBack={() => setPage("home")} backLabel={t("Home", "首页")} />
          {!pnlSummary ? (
            <View style={[s.panel, { alignItems: "center", paddingVertical: 28, gap: 10 }]}>
              <TeraSpinner size={22} />
              <Text style={s.small}>{t("Reading your history from the chain…", "正在从链上读取你的记录…")}</Text>
            </View>
          ) : (
            <>
              <View style={[s.panel, { gap: 6 }]}>
                <Text style={s.eyebrow}>{t("UNREALIZED", "未实现盈亏")}</Text>
                <Text
                  style={{
                    fontSize: 30,
                    fontWeight: "700",
                    color: total!.unrealized >= 0 ? colors.green : colors.danger,
                  }}
                >
                  {shownValue(`${signedFiat(total!.unrealized)}`)}
                  <Text style={{ fontSize: 16 }}> {signedPct(total!.percent)}</Text>
                </Text>
                <Row label={t("Cost basis", "成本")} value={shownValue(formatFiat(total!.costBasis, data.fiatCurrency || "USD"))} />
                <Row label={t("Value now", "当前价值")} value={shownValue(formatFiat(total!.value, data.fiatCurrency || "USD"))} />
                <Row label={t("Realized (sold)", "已实现（卖出）")} value={shownValue(signedFiat(total!.realized))} />
                {total!.estimated ? (
                  <Text style={s.small}>
                    {t(
                      "Includes estimates: costs of tokens received, or bought with something other than USDG, use the market price that day.",
                      "包含估算：收到的代币或非 USDG 买入的代币，按当日市场价计算成本。",
                    )}
                  </Text>
                ) : null}
                {total!.unknown.length ? (
                  <Text style={s.small}>
                    {t(
                      `Left out — cost unknown: ${total!.unknown.join(", ")}. Set your own average cost below to include them.`,
                      `未计入（成本未知）：${total!.unknown.join("、")}。可在下方填写你的平均成本以计入。`,
                    )}
                  </Text>
                ) : null}
                {pnlLegs && !pnlLegs.complete ? (
                  <Text style={s.small}>
                    {t(
                      "Your history is longer than Tera reads, so the oldest transfers are not included.",
                      "你的记录超过 Tera 读取的范围，最早的转账未包含在内。",
                    )}
                  </Text>
                ) : null}
              </View>
              {pnlSummary.rows.map((row: any) => (
                <View key={row.symbol} style={[s.panel, { gap: 6 }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <TokenIcon symbol={row.symbol} size={32} />
                    <View style={{ flex: 1 }}>
                      <Text style={[s.text, { fontWeight: "700" }]}>{row.symbol}</Text>
                      <Text style={s.small}>{shownValue(shortAmount(String(row.qty)))}</Text>
                    </View>
                    {row.unrealized !== null ? (
                      <Text style={[s.text, { fontWeight: "700", color: row.unrealized >= 0 ? colors.green : colors.danger }]}>
                        {shownValue(signedFiat(row.unrealized))} {signedPct(row.percent)}
                      </Text>
                    ) : (
                      <Text style={s.small}>{row.qty > 0 ? t("Cost unknown", "成本未知") : ""}</Text>
                    )}
                  </View>
                  {row.qty > 0 ? (
                    <>
                      <Row
                        label={t("Average cost", "平均成本")}
                        value={
                          row.average === null
                            ? t("Unknown", "未知")
                            : `${formatFiat(row.average, data.fiatCurrency || "USD")} · ${sourceLabel(row.source)}`
                        }
                      />
                      <Row label={t("Value now", "当前价值")} value={row.value === null ? "—" : shownValue(formatFiat(row.value, data.fiatCurrency || "USD"))} />
                    </>
                  ) : null}
                  {row.realized !== null && row.realized !== 0 ? (
                    <Row
                      label={t("Realized", "已实现")}
                      value={`${shownValue(signedFiat(row.realized))}${row.realizedEstimated ? t(" (est.)", "（估算）") : ""}`}
                    />
                  ) : null}
                  {row.qty > 0
                    ? limitList
                        .filter(
                          (order: any) =>
                            order.asset === row.symbol &&
                            (order.kind === "stop" || order.kind === "take") &&
                            (order.status === "open" || order.status === "ready"),
                        )
                        .map((order: any) => {
                          const level = Number(order.limit);
                          const qtyAt = Math.min(Number(order.amount), row.qty);
                          const pnlAt = row.average !== null ? (level - row.average) * qtyAt : null;
                          return (
                            <Row
                              key={order.id}
                              label={order.kind === "stop" ? t("Stop-loss", "止损") : t("Take-profit", "止盈")}
                              value={`$${order.limit}${pnlAt !== null ? ` · ${shownValue(signedFiat(pnlAt))}` : ""}${order.status === "ready" ? t(" · ready", " · 已就绪") : ""}`}
                            />
                          );
                        })
                    : null}
                  {row.qty > 0 && limitTradable(row.symbol) ? (
                    <Pressable accessibilityRole="button" onPress={() => openProtect(row.symbol)}>
                      <Text style={[s.small, { color: colors.green, fontWeight: "700" }]}>
                        {t("Protect with a stop-loss / take-profit", "设置止损 / 止盈保护")}
                      </Text>
                    </Pressable>
                  ) : null}
                  {costEdit?.symbol === row.symbol ? (
                    <>
                      <Field
                        label={t(`Your average cost per ${row.symbol} ($)`, `你的每个 ${row.symbol} 平均成本（美元）`)}
                        value={costEdit?.value || ""}
                        onChangeText={(value) => setCostEdit({ symbol: row.symbol, value })}
                        keyboardType="decimal-pad"
                        placeholder="0.00"
                        hint={t("Leave empty to go back to the computed cost.", "留空即恢复为计算出的成本。")}
                      />
                      <View style={s.wrap}>
                        <Button primary onPress={() => void run(async () => saveCost(row.symbol, costEdit?.value || ""))}>
                          {t("Save", "保存")}
                        </Button>
                        <Button onPress={() => setCostEdit(null)}>{t("Cancel", "取消")}</Button>
                      </View>
                    </>
                  ) : row.qty > 0 ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() =>
                        setCostEdit({ symbol: row.symbol, value: data.pnlOverrides?.[row.symbol] || "" })
                      }
                    >
                      <Text style={[s.small, { color: colors.green, fontWeight: "700" }]}>
                        {row.source === "manual" ? t("Change your cost", "修改你的成本") : t("Set your own cost", "填写你的成本")}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
              <Text style={[s.small, { textAlign: "center" }]}>
                {t(
                  "Average cost, worked out on this device from your transfers on chain and Tera's price history. Network fees aren't included. Nothing about your positions is sent anywhere.",
                  "平均成本法，在此设备上根据你的链上转账和 Tera 的价格历史计算。不含网络费。你的持仓信息不会发送到任何地方。",
                )}
              </Text>
            </>
          )}
        </>
      );
    }
    if (page === "limit-orders") {
      const statusLabel: Record<string, [string, string]> = {
        open: ["Waiting", "等待中"],
        ready: ["Ready to sign", "待签名"],
        filled: ["Filled", "已成交"],
        cancelled: ["Cancelled", "已取消"],
        expired: ["Expired", "已过期"],
      };
      return (
        <>
          <Header
            title={t("Limit orders", "限价单")}
            onBack={() => setPage("home")}
            backLabel={t("Home", "首页")}
            right={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("New limit order", "新建限价单")}
                hitSlop={8}
                onPress={() => openLimitForm()}
                style={s.iconDisc}
              >
                <Icon name="plus" size={20} color={colors.ink} />
              </Pressable>
            }
          />
          <Text style={[s.small, { textAlign: "center" }]}>
            {t(
              "Buy or sell when the price reaches your target. You sign when it's ready, and the swap can't fill worse than your limit.",
              "价格达到目标时买入或卖出。就绪时由你签名，成交价不会差于你的限价。",
            )}
          </Text>
          {limitList.length === 0 ? (
            <View style={[s.panel, { alignItems: "center", gap: 12, paddingVertical: 28 }]}>
              <Icon name="target" size={34} color={colors.lime} />
              <Text style={[s.text, { textAlign: "center" }]}>
                {t("No limit orders yet.", "暂无限价单。")}
              </Text>
              <Button primary onPress={() => openLimitForm()}>
                {t("Place a limit order", "设置限价单")}
              </Button>
            </View>
          ) : (
            limitList.map((order: any) => {
              const price = prices[order.asset];
              const live = order.status === "open" || order.status === "ready";
              return (
                <View key={order.id} style={[s.panel, { gap: 6, opacity: live ? 1 : 0.75 }]}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={[s.text, { fontWeight: "800", fontSize: 16, flex: 1 }]}>
                      {order.kind === "stop"
                        ? t(`Stop-loss · ${order.asset}`, `止损 · ${order.asset}`)
                        : order.kind === "take"
                          ? t(`Take-profit · ${order.asset}`, `止盈 · ${order.asset}`)
                          : order.side === "buy"
                            ? t(`Buy ${order.asset}`, `买入 ${order.asset}`)
                            : t(`Sell ${order.asset}`, `卖出 ${order.asset}`)}
                    </Text>
                    <Text
                      style={[
                        s.small,
                        { fontWeight: "700", color: order.status === "ready" ? colors.lime : live ? colors.green : colors.muted },
                      ]}
                    >
                      {t(...statusLabel[order.status])}
                    </Text>
                  </View>
                  <Text style={s.small}>{limitCore.describeOrder(order)}</Text>
                  <Row
                    label={order.kind === "stop" ? t("Stop", "止损价") : t("Target", "目标价")}
                    value={`$${order.limit} ${order.side === "buy" || order.kind === "stop" ? t("or lower", "或更低") : t("or higher", "或更高")}`}
                  />
                  {order.linked && live ? (
                    <Text style={s.small}>
                      {t("Linked: whichever is reached first cancels the other.", "已关联：先触发的一方会取消另一方。")}
                    </Text>
                  ) : null}
                  {order.status === "cancelled" && order.cancelledBy ? (
                    <Text style={s.small}>
                      {t("Cancelled because its linked order was reached.", "因关联订单已触发而取消。")}
                    </Text>
                  ) : null}
                  {live && (
                    <Row label={t("Price now", "当前价格")} value={Number.isFinite(price) ? valueCore.format(price) : "—"} />
                  )}
                  {live && (
                    <Row
                      label={t("Expires", "到期")}
                      value={order.expiresAt ? new Date(order.expiresAt).toLocaleString() : t("Until cancelled", "直到取消")}
                    />
                  )}
                  {order.status === "ready" && order.readyAt ? (
                    <Text style={s.small}>
                      {t(
                        `Reached ${Number.isFinite(order.readyPrice) ? valueCore.format(order.readyPrice) : "your target"} at ${new Date(order.readyAt).toLocaleString()}.${Number.isFinite(price) && !limitCore.meetsLimit(order, price) ? " The price has since moved away; your limit still applies when you sign." : ""}`,
                        `于 ${new Date(order.readyAt).toLocaleString()} 达到 ${Number.isFinite(order.readyPrice) ? valueCore.format(order.readyPrice) : "目标价"}。${Number.isFinite(price) && !limitCore.meetsLimit(order, price) ? "此后价格已偏离；签名时仍按你的限价执行。" : ""}`,
                      )}
                    </Text>
                  ) : null}
                  {order.fill ? (
                    <Text style={s.small}>
                      {t(
                        `Filled: ${order.side === "buy" ? `spent ${order.fill.spent} ${order.pair}, received ${shortAmount(order.fill.received || "0")} ${order.asset}` : `sold ${order.fill.spent} ${order.asset}, received ${shortAmount(order.fill.received || "0")} ${order.pair}`}${order.fill.estimated ? " (quoted)" : ""}`,
                        `已成交：${order.side === "buy" ? `花费 ${order.fill.spent} ${order.pair}，收到 ${shortAmount(order.fill.received || "0")} ${order.asset}` : `卖出 ${order.fill.spent} ${order.asset}，收到 ${shortAmount(order.fill.received || "0")} ${order.pair}`}${order.fill.estimated ? "（报价）" : ""}`,
                      )}
                    </Text>
                  ) : null}
                  <View style={[s.wrap, { marginTop: 8 }]}>
                    {order.status === "ready" && (
                      <Button primary onPress={() => void run(async () => executeLimit(order))}>
                        {order.side === "buy" ? t("Buy now", "立即买入") : t("Sell now", "立即卖出")}
                      </Button>
                    )}
                    {order.status === "open" && order.kind === "limit" && (
                      <Button onPress={() => openLimitForm(order.id)}>{t("Edit", "编辑")}</Button>
                    )}
                    {live ? (
                      <Button
                        onPress={() =>
                          void run(async () => {
                            await store({ ...dataRef.current, limitOrders: limitCore.cancelOrder(dataRef.current.limitOrders, order.id) });
                          })
                        }
                      >
                        {t("Cancel", "取消订单")}
                      </Button>
                    ) : (
                      <Button
                        onPress={() =>
                          void run(async () => {
                            await store({ ...dataRef.current, limitOrders: limitCore.removeOrder(dataRef.current.limitOrders, order.id) });
                          })
                        }
                      >
                        {t("Remove", "删除")}
                      </Button>
                    )}
                  </View>
                </View>
              );
            })
          )}
          <Text style={[s.small, { textAlign: "center" }]}>
            {t(
              limitCore.PRIVACY_NOTE,
              "限价单保存在此设备的加密数据中，从不发送给 Tera。Tera 无法替你成交：订单就绪时由你签名，兑换的最低收到按你的限价设置。",
            )}
          </Text>
        </>
      );
    }
    if (page === "limit-edit") {
      const set = (field: string) => (value: string) => setLimitForm((current) => ({ ...current, [field]: value }));
      const isBuy = limitForm.side !== "sell";
      const pair = limitCore.pairFor(limitForm.asset || "");
      const price = prices[limitForm.asset || ""];
      const choice = (active: boolean, label: string, onPress: () => void, key: string) => (
        <Pressable
          key={key}
          accessibilityRole="button"
          accessibilityState={{ selected: active }}
          onPress={onPress}
          style={{
            paddingVertical: 8,
            paddingHorizontal: 14,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: active ? colors.green : colors.line,
            backgroundColor: active ? colors.tint : colors.wash,
          }}
        >
          <Text style={{ fontSize: 13, fontWeight: "700", color: active ? colors.green : colors.ink }}>{label}</Text>
        </Pressable>
      );
      const expiryLabels: Record<string, [string, string]> = {
        day: ["1 day", "1 天"],
        week: ["1 week", "1 周"],
        month: ["1 month", "1 个月"],
        never: ["Until cancelled", "直到取消"],
      };
      return (
        <>
          <Header
            title={limitEditId ? t("Edit limit order", "编辑限价单") : t("Limit order", "限价单")}
            onBack={() => setPage("limit-orders")}
            backLabel={t("Back", "返回")}
          />
          <View style={[s.wrap, { gap: 8 }]}>
            {choice(isBuy, t("Buy", "买入"), () => set("side")("buy"), "buy")}
            {choice(!isBuy, t("Sell", "卖出"), () => set("side")("sell"), "sell")}
          </View>
          <View style={{ gap: 8 }}>
            <Text style={s.eyebrow}>{t("TOKEN", "代币")}</Text>
            <View style={[s.wrap, { gap: 8 }]}>
              {assets
                .filter((a) => limitTradable(a.symbol))
                .map((asset) => choice(limitForm.asset === asset.symbol, asset.symbol, () => set("asset")(asset.symbol), asset.symbol))}
            </View>
          </View>
          <Field
            label={
              isBuy
                ? t(`Spend (${pair})`, `花费（${pair}）`)
                : t(`Sell (${limitForm.asset || ""})`, `卖出（${limitForm.asset || ""}）`)
            }
            value={limitForm.amount || ""}
            onChangeText={set("amount")}
            keyboardType="decimal-pad"
            placeholder="0.00"
          />
          <Field
            label={
              isBuy
                ? t("Buy when the price is at or below ($)", "价格低于或等于时买入（美元）")
                : t("Sell when the price is at or above ($)", "价格高于或等于时卖出（美元）")
            }
            value={limitForm.limit || ""}
            onChangeText={set("limit")}
            keyboardType="decimal-pad"
            placeholder={Number.isFinite(price) ? String(price) : "0.00"}
            hint={
              Number.isFinite(price)
                ? t(`Price now: ${valueCore.format(price)}`, `当前价格：${valueCore.format(price)}`)
                : undefined
            }
          />
          {pair === "ETH" ? (
            <Text style={s.small}>
              {t(
                "TERA trades against ETH, so your dollar limit is turned into ETH at the ETH price when you sign.",
                "TERA 与 ETH 交易，因此你的美元限价会在签名时按当时的 ETH 价格换算。",
              )}
            </Text>
          ) : null}
          <View style={{ gap: 8 }}>
            <Text style={s.eyebrow}>{t("EXPIRES AFTER", "有效期")}</Text>
            <View style={[s.wrap, { gap: 8 }]}>
              {Object.keys(limitCore.EXPIRIES).map((key) =>
                choice(limitForm.expiry === key, t(...expiryLabels[key]), () => set("expiry")(key), key),
              )}
            </View>
          </View>
          {orderError ? <Text style={[s.small, { color: colors.danger }]}>{orderError}</Text> : null}
          {action(limitEditId ? "Save order" : "Place order", limitEditId ? "保存订单" : "设置订单", saveLimitForm)}
          <Text style={[s.small, { textAlign: "center" }]}>
            {t(
              "Nothing trades on its own. When the price gets there you'll be told, and you sign it then.",
              "订单不会自动成交。价格到达时会通知你，届时由你签名。",
            )}
          </Text>
        </>
      );
    }
    if (page === "watching") {
      return (
        <>
          <Header
            title={t("Watching", "观察钱包")}
            onBack={() => setPage("home")}
            backLabel={t("Home", "首页")}
            right={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("Watch a wallet", "添加观察钱包")}
                hitSlop={8}
                onPress={() => openWatchForm()}
                style={s.iconDisc}
              >
                <Icon name="plus" size={20} color={colors.ink} />
              </Pressable>
            }
          />
          <Text style={[s.small, { textAlign: "center" }]}>
            {t(
              "Follow any wallet without its key. You can see it, never send from it.",
              "无需私钥即可关注任意钱包。只能查看，无法从中发送。",
            )}
          </Text>
          {watchedList.length === 0 ? (
            <View style={[s.panel, { alignItems: "center", gap: 12, paddingVertical: 28 }]}>
              <Icon name="eye-outline" size={34} color={colors.lime} />
              <Text style={[s.text, { textAlign: "center" }]}>
                {t(
                  "You're not watching any wallets yet. Add a cold wallet, a treasury or a family member's address.",
                  "暂无观察钱包。可添加冷钱包、资金库或家人的地址。",
                )}
              </Text>
              <Button primary onPress={() => openWatchForm()}>
                {t("Watch a wallet", "添加观察钱包")}
              </Button>
            </View>
          ) : (
            <Group>
              {watchedList.map((entry: any) => {
                const valuation = watchedValuation(entry.address);
                return (
                  <ListRow
                    key={entry.address}
                    icon="eye-outline"
                    label={entry.name}
                    detail={`${entry.tag ? `${tags.display(entry.tag)} · ` : ""}${entry.address.slice(0, 6)}…${entry.address.slice(-4)}`}
                    onPress={() => {
                      setWatchOpen(entry.address);
                      setPage("watch-view");
                    }}
                    right={
                      <Text style={[s.small, { fontWeight: "700", color: colors.ink }]}>
                        {valuation === null
                          ? "…"
                          : valuation.total === null
                            ? "—"
                            : shownValue(formatFiat(valuation.total, data.fiatCurrency || "USD"))}
                      </Text>
                    }
                  />
                );
              })}
            </Group>
          )}
          <Text style={[s.small, { textAlign: "center" }]}>
            {t(
              watchedCore.PRIVACY_NOTE,
              "你观察的钱包保存在此设备的加密数据中，从不发送给 Tera。其余额和记录与你自己的钱包一样从网络读取，因此网络可以看到被查询的地址。",
            )}
          </Text>
        </>
      );
    }
    if (page === "watch-add") {
      return (
        <>
          <Header
            title={watchForm.editing ? t("Rename watched wallet", "重命名观察钱包") : t("Watch a wallet", "添加观察钱包")}
            onBack={() => setPage(watchForm.editing ? "watch-view" : "watching")}
            backLabel={t("Back", "返回")}
          />
          {watchForm.editing ? (
            <Row label={t("Address", "地址")} value={watchForm.address} />
          ) : (
            <Field
              label={tagsAvailable() ? t("Address or @tag", "地址或 @标签") : t("Address", "地址")}
              value={watchForm.address}
              onChangeText={(value) => setWatchForm((current) => ({ ...current, address: value }))}
              placeholder={tagsAvailable() ? "0x… / @astra" : "0x…"}
            />
          )}
          <Field
            label={t("Name", "名称")}
            value={watchForm.name}
            onChangeText={(value) => setWatchForm((current) => ({ ...current, name: value }))}
            maxLength={contactsCore.LIMITS.maxLength}
            autoCapitalize="sentences"
            placeholder={t("e.g. Cold storage, Treasury, Mum", "例如：冷钱包、资金库、妈妈")}
          />
          {watchError ? <Text style={[s.small, { color: colors.danger }]}>{watchError}</Text> : null}
          {action(
            watchForm.editing ? "Save name" : "Start watching",
            watchForm.editing ? "保存名称" : "开始观察",
            saveWatchForm,
          )}
          <Text style={[s.small, { textAlign: "center" }]}>
            {t(
              watchedCore.READ_ONLY,
              "仅观察。Tera 没有此钱包的私钥，因此无法在此发送、兑换或签名。",
            )}
          </Text>
        </>
      );
    }
    if (page === "watch-view") {
      const entry = watchedCore.watchedFor(data.watched, watchOpen);
      if (!entry) {
        return (
          <>
            <Header title={t("Watching", "观察钱包")} onBack={() => setPage("watching")} backLabel={t("Back", "返回")} />
            <Text style={s.small}>{t("This wallet is no longer watched.", "已不再观察此钱包。")}</Text>
          </>
        );
      }
      const held = watchBalances[entry.address];
      const valuation = watchedValuation(entry.address);
      const rows = held
        ? assets
            .map((asset) => ({ asset, amount: formatUnits(BigInt(held[asset.symbol] || "0"), asset.decimals) }))
            .filter(({ amount }) => Number(amount) > 0)
        : [];
      return (
        <>
          <Header title={entry.name} onBack={() => setPage("watching")} backLabel={t("Watching", "观察钱包")} />
          <View style={[s.panel, { borderColor: colors.lime, borderWidth: 1, backgroundColor: colors.tint, flexDirection: "row", gap: 10, alignItems: "center" }]}>
            <Icon name="eye-outline" size={20} color={colors.lime} />
            <Text style={[s.small, { flex: 1, color: colors.ink }]}>
              {t(watchedCore.READ_ONLY, "仅观察。Tera 没有此钱包的私钥，因此无法在此发送、兑换或签名。")}
            </Text>
          </View>
          <View style={[s.panel, { alignItems: "center", gap: 6, paddingVertical: 22 }]}>
            <Text style={s.eyebrow}>{t("WATCHED VALUE · NOT YOURS", "观察价值 · 不计入你的资产")}</Text>
            <Text style={{ fontSize: 34, fontWeight: "700", color: colors.ink }}>
              {valuation === null
                ? "…"
                : valuation.total === null
                  ? "—"
                  : shownValue(formatFiat(valuation.total, data.fiatCurrency || "USD"))}
            </Text>
            {valuation && valuation.unpriced.length ? (
              <Text style={s.small}>
                {t(
                  `${valuation.unpriced.length} holding${valuation.unpriced.length === 1 ? "" : "s"} without a price left out`,
                  `${valuation.unpriced.length} 项无报价资产未计入`,
                )}
              </Text>
            ) : null}
            {held === null ? (
              <Text style={[s.small, { color: colors.danger }]}>
                {t("Couldn't read this wallet's balances. Try again shortly.", "无法读取此钱包余额，请稍后重试。")}
              </Text>
            ) : null}
          </View>
          <View style={s.panel}>
            <Row label={t("Address", "地址")} value={entry.address} />
            {entry.tag ? <Row label={t("Tag when added", "添加时的标签")} value={tags.display(entry.tag) || ""} /> : null}
            <View style={[s.wrap, { marginTop: 10 }]}>
              <Button
                onPress={() =>
                  void Clipboard.setStringAsync(entry.address).then(() =>
                    setNotice({ title: t("Address copied", "地址已复制"), body: entry.address, tone: "success" }),
                  )
                }
              >
                {t("Copy address", "复制地址")}
              </Button>
              <Button onPress={() => openWatchForm(entry.address)}>{t("Rename", "重命名")}</Button>
              <Button
                onPress={() =>
                  confirm(
                    t("Stop watching this wallet?", "停止观察此钱包？"),
                    t("It is removed from this device. The wallet itself is not affected.", "将从此设备删除，钱包本身不受影响。"),
                    () =>
                      void run(async () => {
                        await store({ ...dataRef.current, watched: watchedCore.unwatch(dataRef.current.watched, entry.address) });
                        setPage("watching");
                      }),
                  )
                }
              >
                {t("Stop watching", "停止观察")}
              </Button>
            </View>
          </View>
          <Text style={[s.text, { fontWeight: "700" }]}>{t("Holdings", "持仓")}</Text>
          <View style={[s.panel, { paddingVertical: 4, gap: 0 }]}>
            {held === undefined ? (
              <Text style={[s.small, { paddingVertical: 14 }]}>{t("Reading balances…", "正在读取余额…")}</Text>
            ) : rows.length === 0 ? (
              <Text style={[s.small, { paddingVertical: 14 }]}>{t("No tokens Tera tracks are held here.", "此钱包未持有 Tera 追踪的代币。")}</Text>
            ) : (
              rows.map(({ asset, amount }) => {
                const value = valueCore.valueOf(amount, prices[asset.symbol]);
                return (
                  <View key={asset.symbol} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 }}>
                    <TokenIcon symbol={asset.symbol} size={32} />
                    <View style={{ flex: 1 }}>
                      <Text style={[s.text, { fontWeight: "700" }]}>{asset.symbol}</Text>
                      <Text style={s.small}>{shownValue(shortAmount(amount))}</Text>
                    </View>
                    <Text style={[s.text, { fontWeight: "700" }]}>
                      {value === null ? "—" : shownValue(formatFiat(value, data.fiatCurrency || "USD"))}
                    </Text>
                  </View>
                );
              })
            )}
          </View>
          <Text style={[s.text, { fontWeight: "700" }]}>{t("Recent activity", "近期记录")}</Text>
          <View style={[s.panel, { gap: 10 }]}>
            {watchHistory === null ? (
              <Text style={s.small}>{t("Reading activity…", "正在读取记录…")}</Text>
            ) : watchHistory.length === 0 ? (
              <Text style={s.small}>{t("No activity found on chain.", "链上未找到记录。")}</Text>
            ) : (
              [...watchHistory]
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, 15)
                .map((item) => (
                  <View key={item.hash} style={{ gap: 2 }}>
                    <Text style={[s.text, { color: item.direction === "receive" ? colors.green : colors.ink }]}>{item.title}</Text>
                    <Text style={s.small}>
                      {new Date(item.timestamp).toLocaleString()}
                      {item.status === "failed" ? t(" · failed", " · 失败") : ""}
                    </Text>
                  </View>
                ))
            )}
          </View>
        </>
      );
    }
    if (page === "scheduled") {
      const list = schedulesCore.sortedSchedules(data.schedules);
      return (
        <>
          <Header
            title={t("Scheduled", "定期付款")}
            onBack={() => setPage("home")}
            backLabel={t("Home", "首页")}
            right={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("New scheduled payment", "新建定期付款")}
                hitSlop={8}
                onPress={() => openScheduleForm()}
                style={s.iconDisc}
              >
                <Icon name="plus" size={20} color={colors.ink} />
              </Pressable>
            }
          />
          <Text style={[s.small, { textAlign: "center" }]}>
            {t(
              "Payments and recurring buys. Tera reminds you when one is due; you review and sign each one.",
              "定期付款与定期买入。到期时 Tera 会提醒你，每一笔都由你审核并签名。",
            )}
          </Text>
          {list.length === 0 ? (
            <View style={[s.panel, { alignItems: "center", gap: 12, paddingVertical: 28 }]}>
              <Icon name="calendar-clock" size={34} color={colors.lime} />
              <Text style={[s.text, { textAlign: "center" }]}>
                {t(
                  "No scheduled payments yet. Set one up for rent, a salary or anything you pay on a regular day.",
                  "暂无定期付款。可为房租、工资或任何定期支付设置。",
                )}
              </Text>
              <Button primary onPress={() => openScheduleForm()}>
                {t("Schedule a payment", "设置定期付款")}
              </Button>
              <Button onPress={() => openScheduleForm("", "buy")}>
                {t("Set up a recurring buy", "设置定期买入")}
              </Button>
            </View>
          ) : (
            list.map(({ schedule, next }: any) => {
              const due = schedule.paused ? 0 : schedulesCore.dueCount(schedule, scheduleToday);
              const days = next ? schedulesCore.daysUntil(next.date, scheduleToday) : 0;
              const nextLine = !next
                ? t("No more payments", "已无后续付款")
                : schedule.paused
                  ? t(`${next.date} (paused)`, `${next.date}（已暂停）`)
                  : days === 0
                    ? t(`${next.date} · today`, `${next.date} · 今天`)
                    : days > 0
                      ? t(`${next.date} · in ${days} day${days === 1 ? "" : "s"}`, `${next.date} · ${days} 天后`)
                      : t(`${next.date} · overdue`, `${next.date} · 已逾期`);
              return (
                <View key={schedule.id} style={[s.panel, { gap: 6 }]}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={[s.text, { fontWeight: "800", fontSize: 17 }]}>{schedule.label}</Text>
                    <Text
                      style={[
                        s.small,
                        { fontWeight: "700", color: due ? colors.danger : schedule.paused || !next ? colors.muted : colors.green },
                      ]}
                    >
                      {schedule.paused
                        ? t("Paused", "已暂停")
                        : !next
                          ? t("Ended", "已结束")
                          : due
                            ? t(`${due} due`, `${due} 笔到期`)
                            : t("Scheduled", "已安排")}
                    </Text>
                  </View>
                  <Text style={s.small}>
                    {schedule.kind === "buy" ? t("Recurring buy · ", "定期买入 · ") : ""}
                    {schedulesCore.describeFrequency(schedule)}
                  </Text>
                  {schedule.kind === "buy" ? (
                    (() => {
                      const progress = schedulesCore.buyProgress(schedule);
                      const average =
                        progress.average === null
                          ? "—"
                          : schedule.payAsset === "USDG"
                            ? `${formatFiat(progress.average, "USD")} / ${schedule.asset}`
                            : `${shortAmount(String(progress.average))} ${schedule.payAsset} / ${schedule.asset}`;
                      return (
                        <>
                          <Row label={t("Buy", "买入")} value={schedule.asset} />
                          <Row label={t("Each time", "每次花费")} value={`${schedule.amount} ${schedule.payAsset}`} />
                          <Row
                            label={t("Bought so far", "累计买入")}
                            value={`${shortAmount(progress.received)} ${schedule.asset}${progress.buys ? t(` · ${progress.buys} buys`, ` · ${progress.buys} 次`) : ""}`}
                          />
                          <Row label={t("Spent so far", "累计花费")} value={`${shortAmount(progress.spent)} ${schedule.payAsset}`} />
                          <Row
                            label={t("Average price", "平均价格")}
                            value={`${average}${progress.estimated ? t(" (est.)", "（估算）") : ""}`}
                          />
                        </>
                      );
                    })()
                  ) : (
                    <>
                      <Row label={t("Amount", "金额")} value={`${schedule.amount} ${schedule.asset}`} />
                      <Row label={t("To", "收款方")} value={scheduleName(schedule)} />
                      <Row label={t("Address", "地址")} value={schedule.recipient} />
                    </>
                  )}
                  <Row label={t("Next payment", "下次付款")} value={nextLine} />
                  {schedule.end ? <Row label={t("Ends", "结束日期")} value={schedule.end} /> : null}
                  {schedule.log.slice(0, 3).map((entry: any) => (
                    <Text key={`${entry.date}-${entry.status}`} style={s.small}>
                      {entry.date} ·{" "}
                      {entry.status === "paid"
                        ? schedule.kind === "buy" && entry.received
                          ? t(
                              `Bought ${shortAmount(entry.received)} ${schedule.asset}${entry.estimated ? " (quoted)" : ""} for ${entry.spent} ${schedule.payAsset}`,
                              `以 ${entry.spent} ${schedule.payAsset} 买入 ${shortAmount(entry.received)} ${schedule.asset}${entry.estimated ? "（报价）" : ""}`,
                            )
                          : t(`Paid${entry.hash ? ` · ${entry.hash.slice(0, 10)}…` : ""}`, `已支付${entry.hash ? ` · ${entry.hash.slice(0, 10)}…` : ""}`)
                        : t("Skipped", "已跳过")}
                    </Text>
                  ))}
                  <View style={[s.wrap, { marginTop: 8 }]}>
                    {due && next ? (
                      <>
                        <Button primary onPress={() => void run(async () => payScheduled(schedule))}>
                          {schedule.kind === "buy" ? t("Buy now", "立即买入") : t("Pay now", "立即支付")}
                        </Button>
                        <Button
                          onPress={() =>
                            void run(async () => {
                              await settleScheduled(schedule.id, next.date, "skipped");
                              setNotice({
                                title: t("Payment skipped", "已跳过付款"),
                                body: t(`The ${next.date} ${schedule.kind === "buy" ? "buy" : "payment"} was skipped. Nothing was sent.`, `${next.date} 的${schedule.kind === "buy" ? "买入" : "付款"}已跳过，未发送任何资金。`),
                                tone: "success",
                              });
                            })
                          }
                        >
                          {t("Skip this one", "跳过本次")}
                        </Button>
                      </>
                    ) : null}
                    <Button onPress={() => openScheduleForm(schedule.id)}>{t("Edit", "编辑")}</Button>
                    {next ? (
                      <Button
                        onPress={() =>
                          void run(async () => {
                            await store({
                              ...dataRef.current,
                              schedules: schedulesCore.setPaused(dataRef.current.schedules, schedule.id, !schedule.paused),
                            });
                          })
                        }
                      >
                        {schedule.paused ? t("Resume", "恢复") : t("Pause", "暂停")}
                      </Button>
                    ) : null}
                    <Button
                      onPress={() =>
                        confirm(
                          t("Remove this scheduled payment?", "删除此定期付款？"),
                          t(
                            "It is removed from this device. Nothing already sent is affected.",
                            "将从此设备删除，已发送的付款不受影响。",
                          ),
                          () =>
                            void run(async () => {
                              await store({
                                ...dataRef.current,
                                schedules: schedulesCore.removeSchedule(dataRef.current.schedules, schedule.id),
                              });
                            }),
                        )
                      }
                    >
                      {t("Remove", "删除")}
                    </Button>
                  </View>
                </View>
              );
            })
          )}
          <Text style={[s.small, { textAlign: "center" }]}>
            {t(schedulesCore.PRIVACY_NOTE, "定期付款保存在此设备的加密数据中，从不发送给 Tera。Tera 无法替你付款：到期时你需要像其他转账一样审核并签名。")}
          </Text>
        </>
      );
    }
    if (page === "schedule-edit") {
      const set = (field: string) => (value: string) => setScheduleForm((current) => ({ ...current, [field]: value }));
      const isBuy = scheduleForm.kind === "buy";
      const choice = (active: boolean, label: string, onPress: () => void, key: string) => (
        <Pressable
          key={key}
          accessibilityRole="button"
          accessibilityState={{ selected: active }}
          onPress={onPress}
          style={{
            paddingVertical: 8,
            paddingHorizontal: 14,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: active ? colors.green : colors.line,
            backgroundColor: active ? colors.tint : colors.wash,
          }}
        >
          <Text style={{ fontSize: 13, fontWeight: "700", color: active ? colors.green : colors.ink }}>{label}</Text>
        </Pressable>
      );
      const frequencyLabels: Record<string, [string, string]> = {
        weekly: ["Weekly", "每周"],
        biweekly: ["Every 2 weeks", "每两周"],
        monthly: ["Monthly", "每月"],
      };
      return (
        <>
          <Header
            title={
              scheduleEditId
                ? t("Edit schedule", "编辑定期计划")
                : isBuy
                  ? t("Recurring buy", "定期买入")
                  : t("Schedule a payment", "设置定期付款")
            }
            onBack={() => setPage("scheduled")}
            backLabel={t("Back", "返回")}
          />
          {!scheduleEditId && (
            <View style={[s.wrap, { gap: 8 }]}>
              {choice(!isBuy, t("Payment", "付款"), () => setScheduleForm((current) => ({ ...current, kind: "payment", asset: "USDG", frequency: "monthly" })), "payment")}
              {choice(isBuy, t("Recurring buy", "定期买入"), () => setScheduleForm((current) => ({ ...current, kind: "buy", asset: "TERA", frequency: "weekly" })), "buy")}
            </View>
          )}
          {isBuy && (
            <Text style={s.small}>
              {t(
                "Buy a fixed amount on a schedule (dollar-cost averaging). When it's due, the swap opens filled in and you sign at the live price.",
                "按计划定额买入（定投）。到期时兑换页面会自动填好，你按实时价格签名。",
              )}
            </Text>
          )}
          <Field
            label={t("Name", "名称")}
            value={scheduleForm.label || ""}
            onChangeText={set("label")}
            maxLength={schedulesCore.LIMITS.maxLabel}
            autoCapitalize="sentences"
            placeholder={
              isBuy ? t("e.g. Weekly TERA", "例如：每周买 TERA") : t("e.g. Rent, Salary, Allowance", "例如：房租、工资、零花钱")
            }
          />
          {!isBuy && (
            <Field
              label={tagsAvailable() ? t("Recipient address or @tag", "收款地址或 @标签") : t("Recipient address", "收款地址")}
              value={scheduleForm.recipient || ""}
              onChangeText={set("recipient")}
              placeholder={tagsAvailable() ? "0x… / @astra" : "0x…"}
            />
          )}
          <View style={{ gap: 8 }}>
            <Text style={s.eyebrow}>{isBuy ? t("BUY", "买入") : t("ASSET", "资产")}</Text>
            <View style={[s.wrap, { gap: 8 }]}>
              {(isBuy
                ? assets.filter(
                    (a) =>
                      a.symbol !== "USDG" &&
                      (a.symbol === "ETH" || a.symbol === "TERA" || listedSymbols.includes(a.symbol)),
                  )
                : assets
              ).map((asset) =>
                choice(scheduleForm.asset === asset.symbol, asset.symbol, () => set("asset")(asset.symbol), asset.symbol),
              )}
            </View>
          </View>
          <Field
            label={
              isBuy
                ? t(
                    `Spend each time (${schedulesCore.payAssetFor(scheduleForm.asset || "")})`,
                    `每次花费（${schedulesCore.payAssetFor(scheduleForm.asset || "")}）`,
                  )
                : t("Amount", "金额")
            }
            value={scheduleForm.amount || ""}
            onChangeText={set("amount")}
            keyboardType="decimal-pad"
            placeholder="0.00"
          />
          <View style={{ gap: 8 }}>
            <Text style={s.eyebrow}>{t("REPEATS", "重复")}</Text>
            <View style={[s.wrap, { gap: 8 }]}>
              {Object.keys(schedulesCore.FREQUENCIES).map((key) =>
                choice(scheduleForm.frequency === key, t(...frequencyLabels[key]), () => set("frequency")(key), key),
              )}
            </View>
          </View>
          <Field
            label={t("First payment (YYYY-MM-DD)", "首次付款（YYYY-MM-DD）")}
            value={scheduleForm.start || ""}
            onChangeText={set("start")}
            placeholder={scheduleToday}
          />
          <Field
            label={t("Last payment (optional, YYYY-MM-DD)", "最后一次付款（可选，YYYY-MM-DD）")}
            value={scheduleForm.end || ""}
            onChangeText={set("end")}
            placeholder={t("No end date", "无结束日期")}
          />
          {scheduleError ? <Text style={[s.small, { color: colors.danger }]}>{scheduleError}</Text> : null}
          {action(
            scheduleEditId ? "Save changes" : isBuy ? "Set up recurring buy" : "Schedule payment",
            scheduleEditId ? "保存更改" : isBuy ? "设置定期买入" : "设置定期付款",
            saveScheduleForm,
          )}
          <Text style={[s.small, { textAlign: "center" }]}>
            {t(schedulesCore.PRIVACY_NOTE, "定期付款保存在此设备的加密数据中，从不发送给 Tera。Tera 无法替你付款：到期时你需要像其他转账一样审核并签名。")}
          </Text>
        </>
      );
    }
    if (page === "notifications") {
      const items = data.alerts?.items || [];
      const readAt = notificationsReadAt.current;
      const openItem = (hash: string) => {
        const row = combinedHistory.find((h) => String(h.hash || "").toLowerCase() === hash);
        if (row) {
          setActivityDetail(row.hash);
          setPage("activity-detail");
        } else setPage("activity");
      };
      return (
        <>
          <Header
            title={t("Notifications", "通知")}
            onBack={() => setPage("home")}
            backLabel={t("Home", "首页")}
            right={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("Notification settings", "通知设置")}
                hitSlop={8}
                onPress={() => {
                  setSystemAlerts(notify.systemPermission());
                  setSettingsSection("alerts");
                  setPage("settings");
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
                <Icon name="cog-outline" size={19} color={colors.ink} />
              </Pressable>
            }
          />
          {data.alerts?.off ? (
            <View style={[s.panel, { gap: 6 }]}>
              <Text style={s.label}>{t("Notifications are off", "通知已关闭")}</Text>
              <Text style={s.small}>
                {t(
                  "Turn them on in settings to hear about payments as they land.",
                  "在设置中开启，即可在到账时收到提醒。",
                )}
              </Text>
            </View>
          ) : null}
          {!items.length ? (
            <View style={[s.panel, { alignItems: "center", paddingVertical: 28, gap: 8 }]}>
              <Icon name="bell" size={32} color={colors.faint} />
              <Text style={[s.small, { textAlign: "center" }]}>
                {t(
                  "Payments in and out of this wallet will show up here.",
                  "此钱包的收款与付款会显示在这里。",
                )}
              </Text>
            </View>
          ) : (
            <Group>
              {items.map((item) => (
                <Pressable
                  key={`${item.hash}-${item.direction}-${item.title}`}
                  accessibilityRole="button"
                  onPress={() => openItem(item.hash)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    paddingVertical: 10,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <View style={s.iconDisc}>
                    <Icon
                      name={item.direction === "receive" ? "arrow-down" : "arrow-top-right"}
                      size={20}
                      color={colors.ink}
                    />
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={s.label} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={s.small} numberOfLines={1}>
                      {item.body}
                    </Text>
                    <Text style={s.small}>{new Date(item.at).toLocaleString()}</Text>
                  </View>
                  {item.at > readAt ? (
                    <View
                      style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.green }}
                    />
                  ) : null}
                </Pressable>
              ))}
            </Group>
          )}
          {items.length ? (
            <Button
              onPress={() =>
                void run(() =>
                  store({ ...dataRef.current, alerts: { ...dataRef.current.alerts, items: [] } }),
                )
              }
            >
              {t("Clear all", "全部清除")}
            </Button>
          ) : null}
        </>
      );
    }
    if (page === "activity") {
      const shown = activitySearch.filter(
        combinedHistory,
        { query: activityQuery, ...activityFilters },
        {
          kindOf: activityKind,
          owner,
          nameFor: (address: string) => contactsCore.nameFor(book, address),
          noteFor: (hash: string) => notesCore.noteFor(txNotes, hash),
        },
      );
      const narrowing = activitySearch.activeCount(activityFilters);
      const searching = Boolean(activityQuery.trim()) || narrowing > 0;
      const setFilter = (key: keyof typeof activityFilters) => (value: string) =>
        setActivityFilters((f) => ({ ...f, [key]: value }));
      const customBad =
        activityFilters.period === "custom" &&
        [activityFilters.from, activityFilters.to].some(
          (d) => d.trim() && activitySearch.parseDay(d) == null,
        );
      return (
        <>
          <Header
            title={t("Activity", "记录")}
            right={
              combinedHistory.length ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("Export CSV", "导出 CSV")}
                  onPress={() => setCsvModalOpen(true)}
                  style={({ pressed }) => [
                    {
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: 16,
                      backgroundColor: pressed ? colors.raised : colors.wash,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 4,
                    },
                  ]}
                >
                  <Icon name="share" size={16} color={colors.ink} />
                  <Text style={[s.small, { color: colors.ink, fontWeight: "600" }]}>
                    {t("CSV ↗", "CSV ↗")}
                  </Text>
                </Pressable>
              ) : undefined
            }
          />
          {combinedHistory.length ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View
                style={{
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  minHeight: 46,
                  paddingHorizontal: 14,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: colors.line,
                  backgroundColor: colors.wash,
                }}
              >
                <Icon name="search" size={17} color={colors.muted} />
                <TextInput
                  accessibilityLabel={t("Search activity", "搜索记录")}
                  value={activityQuery}
                  onChangeText={setActivityQuery}
                  placeholder={t("Address, name, note, hash or asset", "地址、名称、备注、哈希或资产")}
                  placeholderTextColor={colors.faint}
                  selectionColor={colors.green}
                  autoCorrect={false}
                  autoCapitalize="none"
                  style={[s.text, { flex: 1, paddingVertical: 10 }, Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : null]}
                />
                {activityQuery ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("Clear search", "清除搜索")}
                    hitSlop={8}
                    onPress={() => setActivityQuery("")}
                  >
                    <Icon name="x" size={17} color={colors.muted} />
                  </Pressable>
                ) : null}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  narrowing
                    ? t(`Filters, ${narrowing} on`, `筛选，已启用 ${narrowing} 项`)
                    : t("Filters", "筛选")
                }
                accessibilityState={{ expanded: activityFiltersOpen }}
                onPress={() => setActivityFiltersOpen((open) => !open)}
                style={({ pressed }) => ({
                  width: 46,
                  height: 46,
                  borderRadius: 23,
                  borderWidth: 1,
                  borderColor: activityFiltersOpen || narrowing ? colors.green : colors.line,
                  backgroundColor: activityFiltersOpen ? colors.tint : colors.wash,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Icon name="funnel" size={18} color={narrowing ? colors.green : colors.ink} />
                {narrowing ? (
                  <View
                    style={{
                      position: "absolute",
                      top: -3,
                      right: -3,
                      minWidth: 18,
                      height: 18,
                      borderRadius: 9,
                      backgroundColor: colors.green,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text style={{ color: colors.paper, fontSize: 10, fontWeight: "800" }}>{narrowing}</Text>
                  </View>
                ) : null}
              </Pressable>
            </View>
          ) : null}
          {combinedHistory.length && activityFiltersOpen ? (
            <View style={[s.panel, { gap: 16 }]}>
              <Chips
                label={t("Type", "类型")}
                value={activityFilters.kind}
                select={setFilter("kind")}
                options={[
                  { value: "all", label: t("All", "全部") },
                  { value: "send", label: t("Sent", "发送") },
                  { value: "receive", label: t("Received", "收到") },
                  { value: "swap", label: t("Swaps", "兑换") },
                  { value: "bridge", label: t("Bridges", "跨链") },
                  { value: "staking_rewards", label: t("Staking", "质押奖励") },
                  { value: "payment_links", label: t("Payment Links", "收款链接") },
                ]}
              />
              <Chips
                label={t("Asset", "资产")}
                value={activityFilters.asset}
                select={setFilter("asset")}
                options={[
                  { value: "all", label: t("All", "全部") },
                  { value: "USDG", label: "USDG" },
                  { value: "RWA", label: t("RWA Tokens", "RWA 代币") },
                  ...activitySearch
                    .assetsIn(combinedHistory)
                    .filter((symbol: string) => symbol !== "USDG")
                    .map((symbol: string) => ({ value: symbol, label: symbol })),
                ]}
              />
              <Chips
                label={t("Status", "状态")}
                value={activityFilters.status}
                select={setFilter("status")}
                options={[
                  { value: "all", label: t("All", "全部") },
                  { value: "completed", label: t("Completed", "已完成") },
                  { value: "pending", label: t("Pending", "待确认") },
                  { value: "failed", label: t("Failed", "失败") },
                ]}
              />
              <Chips
                label={t("Date", "日期")}
                value={activityFilters.period}
                select={setFilter("period")}
                options={[
                  { value: "any", label: t("Any time", "全部时间") },
                  { value: "today", label: t("Today", "今天") },
                  { value: "7d", label: t("7 days", "7 天") },
                  { value: "30d", label: t("30 days", "30 天") },
                  { value: "90d", label: t("90 days", "90 天") },
                  { value: "custom", label: t("Custom", "自定义") },
                ]}
              />
              {activityFilters.period === "custom" ? (
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Field
                      label={t("From", "从")}
                      value={activityFilters.from}
                      onChangeText={setFilter("from")}
                      placeholder="2026-09-01"
                      maxLength={10}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field
                      label={t("To", "至")}
                      value={activityFilters.to}
                      onChangeText={setFilter("to")}
                      placeholder="2026-09-30"
                      maxLength={10}
                    />
                  </View>
                </View>
              ) : null}
              {customBad ? (
                <Text style={[s.small, { color: colors.danger }]}>
                  {t(
                    "Write dates as YYYY-MM-DD, e.g. 2026-09-01.",
                    "请按 YYYY-MM-DD 格式填写，例如 2026-09-01。",
                  )}
                </Text>
              ) : null}
            </View>
          ) : null}
          {searching ? (
            <View
              style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}
            >
              <Text style={s.small}>
                {t(
                  `${shown.length} of ${combinedHistory.length} transactions`,
                  `${combinedHistory.length} 笔交易中的 ${shown.length} 笔`,
                )}
              </Text>
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => {
                  setActivityQuery("");
                  setActivityFilters({ ...NO_ACTIVITY_FILTERS });
                }}
              >
                <Text style={[s.small, { color: colors.green, fontWeight: "700" }]}>
                  {t("Clear all", "全部清除")}
                </Text>
              </Pressable>
            </View>
          ) : null}
          {combinedHistory.length && !shown.length ? (
            <View style={[s.panel, { alignItems: "center", paddingVertical: 28, gap: 8 }]}>
              <Icon name="search" size={32} color={colors.faint} />
              <Text style={[s.small, { textAlign: "center" }]}>
                {t(
                  "No transactions match. Try another search or clear the filters.",
                  "没有匹配的交易。换个关键词或清除筛选。",
                )}
              </Text>
            </View>
          ) : null}
          {!combinedHistory.length && (
            <View style={[s.panel, { alignItems: "center", paddingVertical: 28, gap: 8 }]}>
              <Icon name="history" size={32} color={colors.faint} />
              <Text style={s.small}>
                {t("Your signed transactions will appear here.", "已签名的交易将显示在这里。")}
              </Text>
            </View>
          )}
          {combinedHistory.length && !searching ? (
            <Group title={t("Monthly summary", "月度统计")}>
              {calculateMonthlySpending(combinedHistory).slice(0, 3).map((m) => (
                <ListRow
                  key={m.month}
                  icon="calendar-month-outline"
                  label={m.month}
                  detail={`${m.totalTxCount} ${t("transactions", "笔交易")} (${m.transferCount} ${t("transfers", "转账")}, ${m.swapCount} ${t("swaps", "兑换")})`}
                />
              ))}
            </Group>
          ) : null}
          {shown.map((r: any) => {
            const kind = activityKind(r);
            return (
              <View
                key={r.hash}
                style={[s.panel, { gap: 12 }]}
              >
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setActivityDetail(r.hash);
                    setPage("activity-detail");
                  }}
                  style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, opacity: pressed ? 0.7 : 1 })}
                >
                  <View style={s.iconDisc}>
                    <Icon name={kind === "send" ? "arrow-top-right" : kind === "receive" ? "arrow-down" : kind === "bridge" ? "bridge" : "swap-vertical"} size={20} color={colors.ink} />
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={s.label} numberOfLines={1}>{activityTitle(r)}</Text>
                    <Text style={s.small}>{r.createdAt ? new Date(r.createdAt).toLocaleString() : t("On-chain transaction", "链上交易")}</Text>
                    {notesCore.noteFor(txNotes, r.hash) ? (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                        <Icon name="pencil" size={12} color={colors.muted} />
                        <Text style={[s.small, { color: colors.ink, flex: 1 }]} numberOfLines={1}>
                          {notesCore.noteFor(txNotes, r.hash)}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <View style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: statusTone(r.status).bg }}>
                    <Text style={[s.small, { fontWeight: "600", color: statusTone(r.status).color }]}>{activityStatus(r.status)}</Text>
                  </View>
                </Pressable>
                {kind === "send" && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("Review proposal", "审核提案")}
                    onPress={() => openActivityReview(r)}
                    style={({ pressed }) => ({ alignSelf: "flex-start", marginLeft: 50, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, backgroundColor: colors.tint, opacity: pressed ? 0.65 : 1 })}
                  >
                    <Text style={[s.small, { color: colors.green, fontWeight: "700" }]}>{t("Review proposal", "审核提案")}</Text>
                  </Pressable>
                )}
              </View>
            );
          })}
          <Modal visible={csvModalOpen} transparent animationType="fade" onRequestClose={() => setCsvModalOpen(false)}>
            <View style={{ flex: 1, backgroundColor: colors.scrim, justifyContent: "center", alignItems: "center", padding: 20 }}>
              <View style={[s.panel, { width: "100%", maxWidth: 380, borderRadius: 24, padding: 22, gap: 16, backgroundColor: colors.sheet, borderWidth: 1, borderColor: colors.line }]}>
                <View style={{ gap: 4 }}>
                  <Text style={[s.label, { fontWeight: "800", fontSize: 18 }]}>{t("Export Tax-Ready Activity CSV", "导出税务活动 CSV")}</Text>
                  <Text style={[s.small, { color: colors.muted }]}>{t("Select an export preset for tax preparation and bookkeeping software:", "选择税务软件与财务报表预设：")}</Text>
                </View>
                <View style={{ gap: 10 }}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setCsvModalOpen(false);
                      const csv = generateExportCsv(combinedHistory, "standard");
                      if (Platform.OS === "web") {
                        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement("a");
                        link.href = url;
                        link.setAttribute("download", `terrawallet-activity-standard-${Date.now()}.csv`);
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                      } else {
                        void shareText({ title: t("Export CSV (Standard)", "导出 CSV (标准)"), text: csv });
                      }
                    }}
                    style={({ pressed }) => [s.panel, { padding: 14, backgroundColor: pressed ? colors.raised : colors.wash, flexDirection: "row", alignItems: "center", gap: 12 }]}
                  >
                    <View style={s.iconDisc}><Icon name="file-text" size={18} color={colors.ink} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.text, { fontWeight: "700" }]}>{t("Standard CSV", "标准 CSV")}</Text>
                      <Text style={s.small}>{t("Internal audit & transaction ledger", "内部对账与账本流水")}</Text>
                    </View>
                    <Icon name="arrow-down" size={16} color={colors.green} />
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setCsvModalOpen(false);
                      const csv = generateExportCsv(combinedHistory, "koinly");
                      if (Platform.OS === "web") {
                        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement("a");
                        link.href = url;
                        link.setAttribute("download", `terrawallet-activity-koinly-${Date.now()}.csv`);
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                      } else {
                        void shareText({ title: t("Export CSV (Koinly)", "导出 CSV (Koinly)"), text: csv });
                      }
                    }}
                    style={({ pressed }) => [s.panel, { padding: 14, backgroundColor: pressed ? colors.raised : colors.wash, flexDirection: "row", alignItems: "center", gap: 12 }]}
                  >
                    <View style={[s.iconDisc, { backgroundColor: colors.tint }]}><Icon name="share" size={18} color={colors.green} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.text, { fontWeight: "700" }]}>{t("Koinly Tax Format", "Koinly 税务格式")}</Text>
                      <Text style={s.small}>{t("Pre-formatted for direct 1-click import into Koinly", "适配 Koinly 一键导入")}</Text>
                    </View>
                    <Icon name="arrow-down" size={16} color={colors.green} />
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setCsvModalOpen(false);
                      const csv = generateExportCsv(combinedHistory, "cointracker");
                      if (Platform.OS === "web") {
                        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement("a");
                        link.href = url;
                        link.setAttribute("download", `terrawallet-activity-cointracker-${Date.now()}.csv`);
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                      } else {
                        void shareText({ title: t("Export CSV (CoinTracker)", "导出 CSV (CoinTracker)"), text: csv });
                      }
                    }}
                    style={({ pressed }) => [s.panel, { padding: 14, backgroundColor: pressed ? colors.raised : colors.wash, flexDirection: "row", alignItems: "center", gap: 12 }]}
                  >
                    <View style={[s.iconDisc, { backgroundColor: colors.tint }]}><Icon name="share" size={18} color={colors.green} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.text, { fontWeight: "700" }]}>{t("CoinTracker Format", "CoinTracker 税务格式")}</Text>
                      <Text style={s.small}>{t("Pre-formatted for direct 1-click import into CoinTracker", "适配 CoinTracker 一键导入")}</Text>
                    </View>
                    <Icon name="arrow-down" size={16} color={colors.green} />
                  </Pressable>
                </View>
                <Button onPress={() => setCsvModalOpen(false)}>
                  {t("Cancel", "取消")}
                </Button>
              </View>
            </View>
          </Modal>
        </>
      );
    }
    if (page === "activity-detail") {
      const r = combinedHistory.find((h) => h.hash === activityDetail);
      if (!r) return null;
      const isBridge = Boolean(
        r.bridgeInput || (r.reference && /^0x[\da-f]{64}$/i.test(r.reference)) || r.isPrivateBridge,
      );
      const kind = activityKind(r);
      const tone = statusTone(r.status);
      const savedName = r.payee ? contactsCore.nameFor(book, r.payee) : "";
      return (
        <>
          <Header title={activityTitle(r)} onBack={() => setPage("activity")} backLabel={t("Activity", "记录")} />
          <View style={[s.panel, { alignItems: "center", gap: 8, paddingVertical: 28 }]}>
            <View style={[s.iconDisc, { width: 56, height: 56, borderRadius: 28 }]}>
              <Icon name={kind === "send" ? "arrow-top-right" : kind === "receive" ? "arrow-down" : isBridge ? "bridge" : "swap-vertical"} size={26} color={colors.ink} />
            </View>
            <Text style={[s.label, { fontSize: 17, textAlign: "center" }]}>{activityTitle(r)}</Text>
            {r.createdAt ? (
              <Text style={s.small}>{new Date(r.createdAt).toLocaleString()}</Text>
            ) : null}
            <View
              style={{
                marginTop: 4,
                borderRadius: 999,
                paddingHorizontal: 12,
                paddingVertical: 5,
                backgroundColor: tone.bg,
              }}
            >
              <Text style={[s.small, { fontWeight: "700", color: tone.color }]}>{activityStatus(r.status)}</Text>
            </View>
          </View>
          {(() => {
            const note = notesCore.noteFor(txNotes, r.hash);
            const max = notesCore.LIMITS.maxLength;
            if (noteDraft != null)
              return (
                <View style={[s.panel, { gap: 10 }]}>
                  <Field
                    label={t("Note", "备注")}
                    value={noteDraft}
                    onChangeText={setNoteDraft}
                    maxLength={max}
                    autoFocus
                    autoCapitalize="sentences"
                    placeholder={
                      business
                        ? t("Invoice number, client, purpose…", "发票号、客户、用途…")
                        : t("What was this for?", "这笔交易是做什么的？")
                    }
                  />
                  <Text style={s.small}>
                    {`${noteDraft.length}/${max} · `}
                    {sharedNotes
                      ? t(
                          "Also shown in Reports. Saved only on this device, never sent to Tera or your team.",
                          "也会显示在报表中。仅保存在本设备，不会发送给 Tera 或你的团队。",
                        )
                      : t(notesCore.PRIVACY_NOTE, "备注仅保存在本设备的加密钱包数据中，不会发送给 Tera，也不会写入链上。")}
                  </Text>
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Button onPress={() => setNoteDraft(null)}>{t("Cancel", "取消")}</Button>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button
                        primary
                        onPress={() =>
                          void run(async () => {
                            await saveTxNote(r.hash, noteDraft);
                            setNoteDraft(null);
                          })
                        }
                      >
                        {t("Save note", "保存备注")}
                      </Button>
                    </View>
                  </View>
                </View>
              );
            return note ? (
              <View style={[s.panel, { gap: 10 }]}>
                <Text style={s.eyebrow}>{t("Your note", "你的备注")}</Text>
                <Text selectable style={s.text}>
                  {note}
                </Text>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Button onPress={() => setNoteDraft(note)}>{t("Edit", "编辑")}</Button>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button danger onPress={() => void run(() => saveTxNote(r.hash, ""))}>
                      {t("Remove", "删除")}
                    </Button>
                  </View>
                </View>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => setNoteDraft("")}
                style={({ pressed }) => [
                  s.panel,
                  { flexDirection: "row", alignItems: "center", gap: 10, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Icon name="pencil" size={17} color={colors.green} />
                <Text style={[s.label, { color: colors.green }]}>{t("Add a note", "添加备注")}</Text>
              </Pressable>
            );
          })()}
          {r.payee ? (
            <View style={[s.panel, { gap: 10 }]}>
              <Text style={s.eyebrow}>{t("To", "发送至")}</Text>
              <Text selectable style={s.text}>
                {savedName ? `${savedName} · ` : ""}
                {short(r.payee)}
              </Text>
              <Button onPress={() => openContact(r.payee)}>
                {savedName ? t("Rename address", "重命名地址") : t("Save to contacts", "保存到联系人")}
              </Button>
            </View>
          ) : null}
          {r.delivery ? (
            <Group title={t("Delivery", "到账")}>
              <Row
                label={isBridge ? t("Relay delivery", "Relay 到账") : t("Route delivery", "路由到账")}
                value={r.delivery}
              />
            </Group>
          ) : null}
          <Group title={t("Speed", "速度")}>
            {!detailSpeed || detailSpeed.hash !== r.hash ? (
              <Row label={t("Status", "状态")} value={t("Checking…", "检测中…")} />
            ) : detailSpeed.missing ? (
              <Row label={t("Status", "状态")} value={t("Not in a block yet", "尚未打包进区块")} />
            ) : (
              <>
                {!r.fromChain && r.createdAt
                  ? (() => {
                      const took = networkSpeed.confirmMs(r.createdAt, detailSpeed.timestamp);
                      return took != null ? (
                        <Row label={t("Confirmed in", "确认用时")} value={duration(took)} />
                      ) : null;
                    })()
                  : null}
                <Row label={t("Block", "区块")} value={`#${detailSpeed.block.toLocaleString()}`} />
                <Row
                  label={t("Included", "打包时间")}
                  value={new Date(detailSpeed.timestamp * 1000).toLocaleString()}
                />
                <Row
                  label={t("Network fee", "网络手续费")}
                  value={`${Number(formatUnits(detailSpeed.feeWei, 18)).toPrecision(3)} ETH`}
                />
              </>
            )}
          </Group>
          <Group title={t("Actions", "操作")}>
            <ListRow
              icon="refresh"
              label={t("Check status", "检查状态")}
              onPress={() =>
                void run(async (g) => {
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
                })
              }
              right={busy ? <TeraSpinner size={18} /> : <Icon name="chevron-right" size={22} color={colors.faint} />}
            />
            {r.payoutHash && (
              <ListRow
                icon="open-in-new"
                label={t("View payout tx", "查看出资交易")}
                onPress={() =>
                  void Linking.openURL(`https://robinhoodchain.blockscout.com/tx/${r.payoutHash}`)
                }
              />
            )}
            <ListRow
              icon="open-in-new"
              label={t("View on explorer", "在浏览器查看")}
              onPress={() =>
                void Linking.openURL(`https://robinhoodchain.blockscout.com/tx/${r.hash}`)
              }
            />
          </Group>
          <View style={[s.panel, { gap: 8 }]}>
            <Text style={s.eyebrow}>{t("Technical details", "技术详情")}</Text>
            <Row label={t("Hash", "哈希")} value={short(r.hash)} />
            {r.reference && (
              <Row
                label={
                  r.isPrivateBridge
                    ? t("Private Bridge", "私密跨链")
                    : isBridge
                      ? t("Relay", "Relay")
                      : t("Route", "路由")
                }
                value={short(r.reference)}
              />
            )}
            <Text selectable style={[s.mono, { fontSize: 11, color: colors.faint }]}>
              {r.hash}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("Copy hash", "复制哈希")}
                onPress={() =>
                  void Clipboard.setStringAsync(r.hash).then(() =>
                    setNotice({
                      title: t("Hash copied", "哈希已复制"),
                      body: t("Transaction hash copied to clipboard.", "交易哈希已复制到剪贴板。"),
                      tone: "success",
                    }),
                  )
                }
                style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
              >
                <Icon name="content-copy" size={14} color={colors.muted} />
                <Text style={[s.small, { color: colors.muted }]}>{t("Copy", "复制")}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("Share hash", "分享哈希")}
                onPress={() =>
                  void shareText({
                    title: t("Transaction Hash", "交易哈希"),
                    text: r.hash,
                    url: `https://robinhoodchain.blockscout.com/tx/${r.hash}`,
                  })
                }
                style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
              >
                <Icon name="share-2" size={14} color={colors.muted} />
                <Text style={[s.small, { color: colors.muted }]}>{t("Share", "分享")}</Text>
              </Pressable>
            </View>
          </View>
        </>
      );
    }
    const toSettings = () => setSettingsSection("root");
    if (settingsSection === "appearance") {
      return (
        <>
          <Header
            title={t("Appearance", "外观")}
            onBack={toSettings}
            backLabel={t("Settings", "设置")}
          />
          <Group title={t("Theme preference", "主题偏好设置")}>
            <ListRow
              icon="cellphone"
              label={t("System default", "跟随系统")}
              detail={t("Match your device's light or dark mode live", "实时跟随设备的浅色或深色模式")}
              onPress={() => void updateThemeSetting("system")}
              right={
                themeSetting === "system" ? (
                  <Icon name="check" size={20} color={colors.green} />
                ) : null
              }
            />
            <ListRow
              icon="white-balance-sunny"
              label={t("Light", "浅色模式")}
              detail={t("Always use light theme", "始终使用浅色主题")}
              onPress={() => void updateThemeSetting("light")}
              right={
                themeSetting === "light" ? (
                  <Icon name="check" size={20} color={colors.green} />
                ) : null
              }
            />
            <ListRow
              icon="moon-waning-crescent"
              label={t("Dark", "深色模式")}
              detail={t("Always use dark theme", "始终使用深色主题")}
              onPress={() => void updateThemeSetting("dark")}
              right={
                themeSetting === "dark" ? (
                  <Icon name="check" size={20} color={colors.green} />
                ) : null
              }
            />
          </Group>
        </>
      );
    }
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
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
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
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("Share address", "分享地址")}
                  onPress={() =>
                    void shareText({
                      title: t("Tera Wallet Address", "Tera 钱包地址"),
                      text: owner,
                    })
                  }
                  hitSlop={6}
                  style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
                >
                  <Icon name="share-2" size={14} color={colors.muted} />
                </Pressable>
              </View>
              {business ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setPage("biz-email")}
                  style={{
                    alignSelf: "flex-start",
                    backgroundColor: bizEmail ? colors.tint : colors.raised,
                    borderRadius: 999,
                    paddingHorizontal: 10,
                    paddingVertical: 3,
                  }}
                >
                  <Text style={[s.small, { color: colors.green, fontWeight: "600" }]}>
                    {bizEmail || t("Link email for payments", "绑定收款邮箱")}
                  </Text>
                </Pressable>
              ) : tagsAvailable() ? (
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
              icon="eye-outline"
              label={t("Watched wallets", "观察钱包")}
              detail={
                watchedList.length
                  ? t(`${watchedList.length} watched · view only`, `${watchedList.length} 个 · 仅查看`)
                  : t("Follow any wallet without its key", "无需私钥关注任意钱包")
              }
              onPress={() => setPage("watching")}
            />
            <ListRow
              icon="calendar-clock"
              label={t("Scheduled payments", "定期付款")}
              detail={
                dueScheduled.length
                  ? t(`${dueScheduled.length} due now`, `${dueScheduled.length} 笔已到期`)
                  : t("Regular payments and recurring buys", "定期付款与定期买入")
              }
              onPress={() => setPage("scheduled")}
            />
            <ListRow
              icon="wallet"
              label={t("Spending limits", "消费限额")}
              detail={
                limitsCore.hasAny(data.limits)
                  ? t("On — caps per payment, day or month", "已开启 — 单笔、每日或每月上限")
                  : t("Cap what this wallet pays out", "限制此钱包的付款金额")
              }
              onPress={() => {
                setLimitFields(limitsCore.toDollars(data.limits) as Record<string, string>);
                setLimitError("");
                setSettingsSection("limits");
              }}
            />
            <ListRow
              icon="bell"
              label={t("Notifications & Price Alerts", "通知与价格预警")}
              detail={
                data.alerts?.off
                  ? t("Off", "已关闭")
                  : t("On — money movement & asset price alerts", "已开启 — 资金进出与资产价格预警")
              }
              onPress={() => {
                setSystemAlerts(notify.systemPermission());
                setSettingsSection("alerts");
              }}
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
            {biz.available ? (
              <ListRow
                icon="briefcase"
                label={
                  business
                    ? t("Switch to Tera Wallet", "切换到 Tera 钱包")
                    : t("Switch to Tera Business", "切换到 Tera 商业版")
                }
                detail={
                  business
                    ? t("Your personal wallet, with its own PIN", "你的个人钱包，使用其自己的 PIN")
                    : t("A separate wallet for your business, with its own PIN", "为业务单独设立的钱包，使用独立 PIN")
                }
                onPress={() => switchMode(business ? "personal" : "business")}
              />
            ) : null}
          </Group>
          <Group title={t("Preferences", "偏好设置")}>
            <ListRow
              icon="palette-outline"
              label={t("Appearance", "外观")}
              detail={
                themeSetting === "system"
                  ? t("System default (follows OS)", "跟随系统 (自动切换)")
                  : themeSetting === "light"
                    ? t("Light mode", "浅色模式")
                    : t("Dark mode", "深色模式")
              }
              onPress={() => setSettingsSection("appearance")}
              right={
                <Text style={[s.small, { color: colors.green, fontWeight: "600" }]}>
                  {themeSetting === "system"
                    ? t("System", "跟随系统")
                    : themeSetting === "light"
                      ? t("Light", "浅色")
                      : t("Dark", "深色")}
                </Text>
              }
            />
            <ListRow
              icon="clock"
              label={t("Auto lock timer", "自动锁定定时器")}
              detail={
                (data.autoLockMinutes ?? 15) === 0
                  ? t("Never lock automatically", "从不自动锁定")
                  : t(`Lock after ${data.autoLockMinutes ?? 15} min of inactivity`, `无操作 ${data.autoLockMinutes ?? 15} 分钟后锁定`)
              }
              onPress={() => setSettingsSection("autolock")}
              right={
                <Text style={[s.small, { color: colors.green, fontWeight: "600" }]}>
                  {(data.autoLockMinutes ?? 15) === 0
                    ? t("Never", "永不")
                    : `${data.autoLockMinutes ?? 15}m`}
                </Text>
              }
            />
            <ListRow
              icon="shield-check"
              label={t("Trusted only mode", "受信任模式")}
              detail={
                data.trustedOnlyMode
                  ? t("Transfers restricted to saved contacts", "仅允许向保存的联系人转账")
                  : t("Transfers allowed to any address", "允许向任何地址转账")
              }
              onPress={() =>
                run(() => store({ ...dataRef.current, trustedOnlyMode: !dataRef.current.trustedOnlyMode }))
              }
              right={
                <Text style={[s.small, { color: data.trustedOnlyMode ? colors.green : colors.muted, fontWeight: "600" }]}>
                  {data.trustedOnlyMode ? t("Enabled", "已启用") : t("Disabled", "已禁用")}
                </Text>
              }
            />
            <ListRow
              icon="currency-usd"
              label={t("Fiat currency", "法币单位")}
              detail={
                t(
                  `Display portfolio and transaction values in ${data.fiatCurrency || "USD"}`,
                  `以 ${data.fiatCurrency || "USD"} 显示资产与交易价值`,
                )
              }
              onPress={() => setSettingsSection("currency")}
              right={
                <Text style={[s.small, { color: colors.green, fontWeight: "600" }]}>
                  {data.fiatCurrency || "USD"}
                </Text>
              }
            />
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
            {!business ? (
              <ListRow
                icon="compass"
                label={t("Replay app tour", "重新查看引导")}
                onPress={startTour}
              />
            ) : null}
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
            {business ? (
              <ListRow
                icon="mail"
                label={t("Payment email", "收款邮箱")}
                detail={bizEmail || t("Link an email to be paid at", "绑定一个用于收款的邮箱")}
                onPress={() => setPage("biz-email")}
              />
            ) : tagsAvailable() ? (
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
            {/* Production has no in-app updater (see app.config.js) — Google
                Play handles its updates, the same way the App Store does on
                iOS, so this row would otherwise always read "Not checked"
                and never explain why. */}
            {Platform.OS !== "web" && upd.installedChannel() === "preview" && (
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
            )}
          </Group>
          <Group>
            <ListRow icon="lock-outline" label={t("Lock wallet", "锁定钱包")} onPress={forget} />
          </Group>
        </>
      );
    }
    if (settingsSection === "limits") {
      const used = limitsCore.usage(combinedHistory);
      const dollars = spendCore.formatDollars;
      const save = async (limits: NonNullable<vault.LocalData["limits"]>) => {
        await store({ ...dataRef.current, limits });
        setLimitFields(limitsCore.toDollars(limits) as Record<string, string>);
        setNotice({
          title: t("Spending limits saved", "消费限额已保存"),
          body: limitsCore.hasAny(limits)
            ? t("Payments over a limit are now stopped before you sign.", "超过限额的付款将在签名前被拦截。")
            : t("No limits are set.", "未设置任何限额。"),
          tone: "success",
        });
      };
      const fields: [string, string, string, string, string][] = [
        ["perPayment", "Per payment", "单笔", "The most one payment can be", "单笔付款上限"],
        ["daily", "Per day", "每日", `Paid today: ${dollars(used.today)}`, `今日已付：${dollars(used.today)}`],
        ["monthly", "Per month", "每月", `Paid this month: ${dollars(used.month)}`, `本月已付：${dollars(used.month)}`],
      ];
      return (
        <>
          <Header title={t("Spending limits", "消费限额")} onBack={toSettings} backLabel={t("Settings", "设置")} />
          <View style={[s.panel, { gap: 8 }]}>
            <Text style={s.small}>
              {t(
                "Caps, in dollars, on what this wallet pays out: sends, private sends, Spend and payment links, in any asset, valued when you sign. A payment over a limit is stopped before you sign. Leave a field blank for no cap.",
                "以美元计的付款上限：适用于发送、私密发送、消费和收款链接，任何资产按签名时的价值计算。超过限额的付款会在签名前被拦截。留空表示不设上限。",
              )}
            </Text>
            <Text style={s.small}>
              {t(
                "Lowering a limit takes effect at once. Raising or removing one asks for your password or biometrics.",
                "降低限额立即生效。提高或取消限额需要验证密码或生物识别。",
              )}
            </Text>
          </View>
          {fields.map(([kind, en, zh, hintEn, hintZh]) => (
            <Field
              key={kind}
              label={t(`${en} ($)`, `${zh}（美元）`)}
              hint={t(hintEn, hintZh)}
              value={limitFields[kind] || ""}
              onChangeText={(value) => {
                setLimitFields((current) => ({ ...current, [kind]: value.replace(",", ".") }));
                setLimitError("");
              }}
              keyboardType="decimal-pad"
              placeholder={t("No limit", "不限")}
            />
          ))}
          {limitError ? (
            <View style={s.error}>
              <Text style={s.text}>{limitError}</Text>
            </View>
          ) : null}
          <Button
            primary
            onPress={() => {
              const read = limitsCore.fromDollars(limitFields);
              if (!read.ok) {
                setLimitError(read.reason || "");
                return;
              }
              const next = read.limits as NonNullable<vault.LocalData["limits"]>;
              if (limitsCore.loosens(dataRef.current.limits, next))
                authenticate(t("Loosen spending limits", "放宽消费限额"), () => save(next));
              else void run(() => save(next));
            }}
          >
            {t("Save limits", "保存限额")}
          </Button>
          <Text style={[s.small, { textAlign: "center" }]}>
            {t(
              "Limits live in this app, with this wallet's data. They stop payments made here — not the funds themselves: anyone with the recovery phrase can move them with another wallet. Swaps and bridges aren't payments and aren't counted.",
              "限额保存在此应用和此钱包的数据中。它们拦截在此发起的付款，而不是锁定资金：持有助记词的人可用其他钱包转移资金。兑换和跨链不属于付款，不计入。",
            )}
          </Text>
        </>
      );
    }
    if (settingsSection === "alerts") {
      const on = !data.alerts?.off;
      return (
        <>
          <Header title={t("Notifications & Price Alerts", "通知与价格预警")} onBack={toSettings} backLabel={t("Settings", "设置")} />
          <Group>
            <ListRow
              icon="bell"
              label={t("Transaction notifications", "交易通知")}
              detail={t("Payments in and out of this wallet", "此钱包的收款与付款")}
              onPress={() =>
                void run(() =>
                  store({ ...dataRef.current, alerts: { ...dataRef.current.alerts, off: on } }),
                )
              }
              right={<Toggle on={on} />}
            />
            {on && systemAlerts !== "unsupported" ? (
              <ListRow
                icon="lightning-bolt-outline"
                label={t("Browser notifications", "浏览器通知")}
                detail={
                  systemAlerts === "granted"
                    ? t("On — shown when this tab is in the background", "已开启 — 标签页在后台时显示")
                    : systemAlerts === "denied"
                      ? t("Blocked — allow them in your browser's site settings", "已被阻止 — 请在浏览器网站设置中允许")
                      : t("Ask this browser to show them", "请求浏览器显示通知")
                }
                onPress={
                  systemAlerts === "default"
                    ? () => void notify.askSystem().then(setSystemAlerts)
                    : undefined
                }
                right={<Toggle on={systemAlerts === "granted"} />}
              />
            ) : null}
          </Group>
          <View style={[s.panel, { gap: 10 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Icon name="bell-ring-outline" size={18} color={colors.green} />
              <Text style={[s.eyebrow, { color: colors.ink }]}>{t("Active Price Alerts", "活跃价格预警")}</Text>
            </View>
            <Text style={s.small}>
              {t(
                "Click on any token from your home page or market list to set or modify target price alerts for that asset.",
                "在首页或市场列表中点击任何代币，即可为该资产设置或修改目标价格预警。",
              )}
            </Text>
            {Array.isArray(data.priceAlerts) && data.priceAlerts.length > 0 ? (
              <View style={{ gap: 8 }}>
                {data.priceAlerts.map((alert: any) => (
                  <View
                    key={alert.id}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      paddingVertical: 10,
                      paddingHorizontal: 12,
                      borderRadius: 10,
                      backgroundColor: colors.wash,
                      borderWidth: 1,
                      borderColor: colors.line,
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <TokenIcon symbol={alert.symbol} size={28} />
                      <View style={{ gap: 2 }}>
                        <Text style={[s.text, { fontWeight: "700" }]}>
                          {alert.symbol} {alert.condition === "above" ? "≥" : "≤"} ${Number(alert.targetPrice).toLocaleString()}
                        </Text>
                        <Text style={s.small}>
                          {new Date(alert.createdAt).toLocaleDateString()}
                        </Text>
                      </View>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        const updated = (dataRef.current.priceAlerts || []).filter((a: any) => a.id !== alert.id);
                        void run(() => store({ ...dataRef.current, priceAlerts: updated }));
                      }}
                      hitSlop={8}
                    >
                      <Icon name="trash-can-outline" size={18} color={colors.danger} />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={[s.small, { color: colors.muted, fontStyle: "italic" }]}>
                {t("No price alerts set yet.", "暂未设置任何价格预警。")}
              </Text>
            )}
          </View>
          <View style={[s.panel, { gap: 8 }]}>
            <Text style={s.small}>
              {t(
                "Token payments are announced the moment they land on chain. Plain ETH moves, and anything that arrived while Tera was closed, are announced within a minute of opening it.",
                "代币收付款上链后立即提醒。普通 ETH 转账以及 Tera 关闭期间到账的款项，会在打开后一分钟内提醒。",
              )}
            </Text>
            <Text style={s.small}>
              {t(
                "To hear about token payments this fast, the app tells Tera which wallet to watch while it is open. Tera keeps nothing: what it reads is dropped after ten minutes. Turning notifications off stops that.",
                "为了即时提醒代币收付款，应用在打开期间会告知 Tera 需要关注的钱包。Tera 不保存任何内容：读取的数据十分钟后丢弃。关闭通知即停止。",
              )}
            </Text>
            <Text style={s.small}>
              {Platform.OS === "web"
                ? t(
                    "Notifications need Tera open in a tab. A closed tab is told nothing.",
                    "通知需要 Tera 在标签页中保持打开。关闭的标签页不会收到通知。",
                  )
                : t(
                    "On this phone they show while Tera is open. A closed app is told nothing until you open it.",
                    "在此手机上，通知仅在 Tera 打开时显示。应用关闭时不会收到提醒，打开后会补充提醒。",
                  )}
            </Text>
          </View>
        </>
      );
    }
    if (settingsSection === "autolock") {
      const currentTimer = data.autoLockMinutes ?? 15;
      const timerLabels: Record<number, string> = {
        1: t("1 minute", "1 分钟"),
        5: t("5 minutes", "5 分钟"),
        15: t("15 minutes", "15 分钟"),
        30: t("30 minutes", "30 分钟"),
        0: t("Never", "永不"),
      };
      return (
        <>
          <Header title={t("Auto lock timer", "自动锁定定时器")} onBack={toSettings} backLabel={t("Settings", "设置")} />
          <View style={[s.panel, { gap: 8 }]}>
            <Text style={s.small}>
              {t(
                "Choose how long Tera waits before automatically locking the wallet due to inactivity.",
                "选择 Tera 在因无操作而自动锁定钱包之前等待的时长。",
              )}
            </Text>
          </View>
          <Choices
            options={[
              t("1 minute", "1 分钟"),
              t("5 minutes", "5 分钟"),
              t("15 minutes", "15 分钟"),
              t("30 minutes", "30 分钟"),
              t("Never", "永不"),
            ]}
            value={timerLabels[currentTimer] || t("15 minutes", "15 分钟")}
            select={(choice) => {
              let selected = 15;
              if (choice === t("1 minute", "1 分钟")) selected = 1;
              else if (choice === t("5 minutes", "5 分钟")) selected = 5;
              else if (choice === t("15 minutes", "15 分钟")) selected = 15;
              else if (choice === t("30 minutes", "30 分钟")) selected = 30;
              else if (choice === t("Never", "永不")) selected = 0;
              void run(() => store({ ...dataRef.current, autoLockMinutes: selected }));
            }}
          />
        </>
      );
    }
    if (settingsSection === "currency") {
      const currentCurrency = data.fiatCurrency || "USD";
      const currencies: Array<"USD" | "EUR" | "GBP" | "JPY" | "CAD" | "AUD"> = [
        "USD",
        "EUR",
        "GBP",
        "JPY",
        "CAD",
        "AUD",
      ];
      return (
        <>
          <Header title={t("Fiat currency", "法币单位")} onBack={toSettings} backLabel={t("Settings", "设置")} />
          <View style={[s.panel, { gap: 8 }]}>
            <Text style={s.small}>
              {t(
                "Choose your preferred local currency for displaying asset balances and market values.",
                "选择用于显示资产余额和市场价值的首选本地货币。",
              )}
            </Text>
          </View>
          <Choices
            options={currencies.map((c) => `${c} (${FIAT_RATES[c]?.symbol || "$"})`)}
            value={`${currentCurrency} (${FIAT_RATES[currentCurrency]?.symbol || "$"})`}
            select={(choice) => {
              const selected = choice.slice(0, 3) as "USD" | "EUR" | "GBP" | "JPY" | "CAD" | "AUD";
              void run(() => store({ ...dataRef.current, fiatCurrency: selected }));
            }}
          />
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
          {vault.hasPhrase() && action(
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
            {vault.hasPhrase() && (
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
            )}
            <ListRow
              icon="key-variant"
              label={t("Show private key", "显示私钥")}
              detail={t(
                "For this wallet only · authentication required",
                "仅适用于此钱包 · 需要身份验证",
              )}
              disabled={busy}
              onPress={() => requestPrivateKey(vault.selectedIndex())}
            />
            {/* Web only for now; the phone apps get it in a later release. */}
            {Platform.OS === "web" && (
              <ListRow
                icon="shield-key-outline"
                label={t("Token approvals", "代币授权")}
                detail={t("Contracts allowed to spend your tokens", "可花费你代币的合约")}
                onPress={() => {
                  setSettingsSection("approvals");
                  void loadApprovals();
                }}
              />
            )}
            <ListRow icon="lock-outline" label={t("Lock now", "立即锁定")} onPress={forget} />
            {vault.biometricsSupported && (
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
            )}
          </Group>
        </>
      );
    if (settingsSection === "approvals" && Platform.OS === "web") {
      const open = grants ?? [];
      const risky = open.filter((g) => g.kind === "collection" || approvalRules.isUnlimited(g.amount ?? 0n)).length;
      return (
        <>
          <Header
            title={t("Token approvals", "代币授权")}
            onBack={() => setSettingsSection("security")}
            backLabel={t("Security", "安全")}
          />
          <View style={[s.panel, { gap: 6 }]}>
            <Text style={s.small}>
              {t(
                "When you swap or bridge, the app you use asks to spend your tokens. That permission stays after the trade. Anyone in control of a contract listed here can move what it allows, without asking you again. Revoke anything you no longer use.",
                "兑换或跨链时，所用应用会请求花费你的代币。该权限在交易后仍然有效。控制下列合约的任何人都可以在授权范围内转走你的代币，无需再次询问。请撤销不再使用的授权。",
              )}
            </Text>
          </View>
          {grantsBusy && grants === null ? (
            <View style={[s.panel, { alignItems: "center", paddingVertical: 24 }]}>
              <ActivityIndicator color={colors.green} />
              <Text style={[s.small, { marginTop: 8 }]}>{t("Reading approvals from the chain…", "正在从链上读取授权…")}</Text>
            </View>
          ) : grantsError ? (
            <Text style={[s.small, { color: colors.danger }]}>{grantsError}</Text>
          ) : grants && open.length === 0 ? (
            <View style={[s.panel, { alignItems: "center", gap: 6, paddingVertical: 24 }]}>
              <Icon name="shield-check-outline" size={32} color={colors.green} />
              <Text style={s.label}>{t("No open approvals", "没有未撤销的授权")}</Text>
              <Text style={[s.small, { textAlign: "center" }]}>
                {t("No contract can spend this wallet's tokens.", "没有合约可以花费此钱包的代币。")}
              </Text>
            </View>
          ) : grants ? (
            <Group
              title={
                risky
                  ? t(`${open.length} open · ${risky} unlimited`, `${open.length} 项未撤销 · ${risky} 项无限额`)
                  : t(`${open.length} open`, `${open.length} 项未撤销`)
              }
            >
              {open.map((grant) => {
                const unlimited = grant.kind === "collection" || approvalRules.isUnlimited(grant.amount ?? 0n);
                return (
                  <ListRow
                    key={`${grant.kind}:${grant.token}:${grant.spender}`}
                    icon={unlimited ? "alert-outline" : "shield-key-outline"}
                    danger={unlimited}
                    label={`${grant.symbol} → ${spenderLabel(grant.spender)}`}
                    detail={grantAmount(grant)}
                    disabled={signing}
                    onPress={() => revokeApproval(grant)}
                    right={<Text style={[s.small, { color: colors.danger, fontWeight: "700" }]}>{t("Revoke", "撤销")}</Text>}
                  />
                );
              })}
            </Group>
          ) : null}
          <Button disabled={grantsBusy} onPress={() => void loadApprovals()}>
            {grantsBusy ? t("Checking…", "检查中…") : t("Check again", "重新检查")}
          </Button>
          <Text style={[s.small, { textAlign: "center" }]}>
            {t(
              "Read from Robinhood Chain through its block explorer, which sees this wallet's address. Revoking is an ordinary transaction with a small network fee.",
              "通过 Robinhood Chain 区块浏览器读取，浏览器会看到此钱包地址。撤销是一笔普通交易，需支付少量网络费用。",
            )}
          </Text>
        </>
      );
    }
    if (settingsSection === "privacy") {
      const days = (d: number) => t(`${d} days`, `${d} 天`);
      return (
        <>
          <Header
            title={t("Privacy & data", "隐私与数据")}
            onBack={toSettings}
            backLabel={t("Settings", "设置")}
          />
          <Group>
            <ListRow
              icon="eye"
              label={t("Privacy mode", "隐私模式")}
              detail={t(
                "Cover balances on screen. Amounts you are signing stay visible.",
                "在屏幕上遮盖余额。待签名的金额仍会显示。",
              )}
              onPress={() =>
                void run(() => store({ ...dataRef.current, privacy: !dataRef.current.privacy }))
              }
              right={<Toggle on={!!data.privacy} />}
            />
            <ListRow
              icon="filter"
              label={t("Hide small balances", "隐藏小额余额")}
              detail={t(
                `Under ${valueCore.format(data.hideSmallThreshold ?? discretion.DEFAULT_THRESHOLD)}. Still counted in your total.`,
                `低于 ${valueCore.format(data.hideSmallThreshold ?? discretion.DEFAULT_THRESHOLD)}。仍计入总额。`,
              )}
              onPress={() =>
                void run(() => store({ ...dataRef.current, hideSmall: !dataRef.current.hideSmall }))
              }
              right={<Toggle on={!!data.hideSmall} />}
            />
          </Group>
          {data.hideSmall ? (
            <View style={[s.panel, { gap: 14, marginTop: 16 }]}>
              <Text style={[s.text, { fontWeight: "700" }]}>
                {t("Hide anything under", "隐藏低于")}
              </Text>
              <Choices
                options={[1, 5, 10, 25].map((n) => valueCore.format(n))}
                value={valueCore.format(data.hideSmallThreshold ?? discretion.DEFAULT_THRESHOLD)}
                select={(v) =>
                  void run(() =>
                    store({
                      ...dataRef.current,
                      hideSmallThreshold: Number(v.replace(/[^0-9.]/g, "")) || discretion.DEFAULT_THRESHOLD,
                    }),
                  )
                }
              />
              <Text style={s.small}>
                {t(
                  "A holding nobody has priced is never hidden. Not knowing what something is worth is not a reason to treat it as worth nothing.",
                  "没有价格的资产永远不会被隐藏。无法得知其价值，并不等于它没有价值。",
                )}
              </Text>
            </View>
          ) : null}
          <View style={[s.panel, { gap: 14, marginTop: 16 }]}>
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
          onPress={() => {
            if (typeof window !== "undefined") {
              window.open("/support", "_blank");
            }
          }}
        >
          {t("Help & Support ↗", "帮助与支持 ↗")}
        </Button>
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
  // On a desktop, a phone's bottom sheet becomes a dialog in the middle of the
  // window (auto margins centre it), centred panels keep a dialog's width, and
  // full-screen modal pages keep the same measure as ordinary pages.
  const sheetFrame = wide
    ? ({
        width: "100%",
        maxWidth: 520,
        alignSelf: "center",
        marginVertical: "auto",
        borderRadius: 30,
      } as const)
    : null;
  const dialogFrame = wide ? ({ width: "100%", maxWidth: 480, alignSelf: "center" } as const) : null;
  const modalPage = wide ? { paddingHorizontal: Math.max(24, (windowWidth - 760) / 2) } : null;
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
      {owner && wide && (
        <View style={{ borderBottomWidth: 1, borderBottomColor: colors.line }}>
          <View
            style={[
              s.header,
              // The home page's width, so the brand lines up with the page below.
              {
                width: "100%",
                maxWidth: Math.min(1120, windowWidth - 280),
                alignSelf: "center",
                paddingHorizontal: 32,
              },
            ]}
          >
            <Pressable
              accessibilityRole="link"
              onPress={() => setPage("home")}
              style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
            >
              <Image
                source={require("./assets/logo-mark.png")}
                style={{ width: 30, height: 30 }}
                resizeMode="contain"
              />
              <Text style={{ color: colors.ink, fontWeight: "800", fontSize: 16 }}>
                {brand}
              </Text>
            </Pressable>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              {networkControl(false)}
              {bellControl}
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
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("Lock wallet", "锁定钱包")}
                onPress={forget}
                style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  borderWidth: 1,
                  borderColor: colors.line,
                  borderRadius: 999,
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                  backgroundColor: hovered ? colors.wash : "transparent",
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Icon name="lock-outline" size={15} color={colors.muted} />
                <Text style={s.mono}>{t("Lock", "锁定")}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}
      {owner && !wide && page === "home" && (
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
                {brand}
              </Text>
            </View>
          </Pressable>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {networkControl(true)}
            {bellControl}
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
        </View>
      )}
      <View style={{ flex: 1 }}>
        {/* What the glass bar blurs: everything that scrolls beneath it. */}
        <BlurTargetView ref={glassTarget} style={{ flex: 1, backgroundColor: colors.bg }}>
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === "ios" ? "padding" : page === "assistant" ? "height" : undefined}
          >
            {owner && page === "assistant" ? (
              wide ? (
                <View style={{ flex: 1, width: "100%", maxWidth: 760, alignSelf: "center" }}>
                  {assistantScreen()}
                </View>
              ) : (
                assistantScreen()
              )
            ) : (
              <ScrollView
                ref={homeScrollRef}
                onScroll={(e) => {
                  homeScrollY.current = e.nativeEvent.contentOffset.y;
                }}
                scrollEventThrottle={32}
                contentContainerStyle={[
                  s.content,
                  owner ? { paddingBottom: 124 } : null,
                  wide
                    ? {
                        width: "100%",
                        // Home spreads into two columns; forms and lists keep a
                        // readable measure; sign-in stays the width of a card.
                        // The side margin keeps every page clear of the dock.
                        maxWidth: !owner
                          ? 440
                          : page === "home" || page === "biz-team"
                            ? Math.min(1120, windowWidth - 280)
                            : 760,
                        alignSelf: "center",
                        paddingHorizontal: 32,
                        paddingTop: owner ? 36 : 48,
                        paddingBottom: 72,
                        gap: 22,
                      }
                    : null,
                ]}
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
        {owner && wide && (
          <View
            ref={tourTabBarRef}
            collapsable={false}
            accessibilityRole="tablist"
            style={{
              position: "absolute",
              right: 20,
              top: "50%",
              transform: [{ translateY: "-50%" }],
              gap: 2,
              padding: 6,
              borderRadius: 26,
              borderWidth: 1,
              borderColor: "#ffffff1f",
              backgroundColor: "#1d1b20cc",
              shadowColor: "#000000",
              shadowOpacity: 0.4,
              shadowRadius: 24,
              shadowOffset: { width: 0, height: 12 },
            }}
          >
            {(business
              ? ([
                  ["layout-dashboard", "Dashboard", "概览", "home"],
                  ["shield-check", "Team", "团队", "biz-team"],
                  ["link", "Links", "链接", "biz-links"],
                  ["users", "Accounts", "账户", "biz-accounts"],
                  ["file-down", "Reports", "报表", "biz-reports"],
                  ["history", "Activity", "记录", "activity"],
                  ["lightning-bolt-outline", "Actions", "操作", "actions"],
                  ["cog-outline", "Settings", "设置", "settings"],
                ] as ReadonlyArray<readonly [string, string, string, string]>)
              : ([
                  ["wallet-outline", "Wallet", "钱包", "home"],
                  ["history", "Activity", "记录", "activity"],
                  ["lightning-bolt-outline", "Actions", "操作", "actions"],
                  ["message-text-outline", "Assistant", "助手", "assistant"],
                  ["cog-outline", "Settings", "设置", "settings"],
                ] as ReadonlyArray<readonly [string, string, string, string]>)
            ).map(([icon, en, zh, p]) => {
              const active = p === "actions" ? sheetOpen : page === p;
              return (
                <Pressable
                  key={p}
                  accessibilityRole={p === "actions" ? "button" : "tab"}
                  accessibilityState={p === "actions" ? { expanded: sheetOpen } : { selected: active }}
                  disabled={busy}
                  onPress={() => {
                    if (p === "actions") return setSheetOpen(true);
                    setError("");
                    if (p === "settings") setSettingsSection("root");
                    setPage(p);
                  }}
                  style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => ({
                    width: 78,
                    alignItems: "center",
                    gap: 5,
                    paddingTop: 11,
                    paddingBottom: 9,
                    borderRadius: 20,
                    backgroundColor: active ? colors.wash : hovered ? "#ffffff0d" : "transparent",
                    opacity: busy ? 0.4 : pressed ? 0.7 : 1,
                  })}
                >
                  <Icon name={icon} size={24} color={active ? colors.green : colors.muted} />
                  <Text
                    numberOfLines={1}
                    style={[
                      s.small,
                      {
                        fontSize: 11,
                        lineHeight: 13,
                        color: active ? colors.ink : colors.muted,
                        fontWeight: active ? "700" : "500",
                      },
                    ]}
                  >
                    {t(en, zh)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
        {owner && !wide && !keyboardOpen && isRootTab && (
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
            key: "spend",
            icon: "wallet",
            label: t("Spend", "消费"),
            onPress: openSpend,
          },
          {
            key: "scheduled",
            icon: "calendar-clock",
            label: t("Scheduled", "定期付款"),
            onPress: () => setPage("scheduled"),
          },
          {
            key: "watching",
            icon: "eye-outline",
            label: t("Watching", "观察钱包"),
            onPress: () => setPage("watching"),
          },
          {
            key: "limit-orders",
            icon: "target",
            label: t("Limit orders", "限价单"),
            onPress: () => setPage("limit-orders"),
          },
          {
            key: "pnl",
            icon: "chart-line",
            label: t("Profit & loss", "盈亏"),
            onPress: () => setPage("pnl"),
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
          {
            key: "support",
            icon: "help-circle-outline",
            label: t("Support", "支持"),
            onPress: () => {
              if (typeof window !== "undefined") {
                window.open("/support", "_blank");
              }
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
            {
              key: "private-key",
              icon: "key-variant",
              label: t("Show private key", "显示私钥"),
              onPress: () => {
                afterWalletMenuCloses.current = () => requestPrivateKey(entry.index);
              },
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
                ...sheetFrame,
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
              ...sheetFrame,
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
              ...sheetFrame,
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
        visible={swapPayPicker && !!owner}
        animationType="slide"
        onRequestClose={() => setSwapPayPicker(false)}
      >
        <SafeAreaProvider>
          <SafeAreaView style={[s.page, modalPage]}>
            <Header
              title={t("Choose a token to pay", "\u9009\u62e9\u652f\u4ed8\u4ee3\u5e01")}
              onBack={() => setSwapPayPicker(false)}
              backLabel={t("Cancel", "\u53d6\u6d88")}
            />
            <ScrollView contentContainerStyle={s.content}>
              {assets
                .filter(
                  (a) =>
                    a.symbol !== "USDG" &&
                    (a.symbol === "ETH" || a.symbol === "TERA" || listedSymbols.includes(a.symbol)),
                )
                .map((a) => (
                  <Pressable
                    key={a.symbol}
                    onPress={() => {
                      setAssetSymbol(a.symbol);
                      setTrade("SELL");
                      clearAmount();
                      setSwapPayPicker(false);
                    }}
                    style={[s.panel, { flexDirection: "row", alignItems: "center", gap: 12 }]}
                  >
                    <TokenIcon symbol={a.symbol} size={32} />
                    <View style={{ flex: 1 }}>
                      <Text style={[s.text, { fontWeight: "600" }]}>{a.name || a.symbol}</Text>
                      <Text style={s.small}>{a.symbol}</Text>
                    </View>
                    {assetSymbol === a.symbol && trade === "SELL" && (
                      <Icon name="check" size={20} color={colors.green} />
                    )}
                  </Pressable>
                ))}
            </ScrollView>
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
      <Modal
        visible={swapReceivePicker && !!owner}
        animationType="slide"
        onRequestClose={() => setSwapReceivePicker(false)}
      >
        <SafeAreaProvider>
          <SafeAreaView style={[s.page, modalPage]}>
            <Header
              title={t("Choose a token", "选择代币")}
              onBack={() => setSwapReceivePicker(false)}
              backLabel={t("Cancel", "取消")}
            />
            <ScrollView contentContainerStyle={s.content}>
              {assets
                .filter(
                  (a) =>
                    a.symbol !== "USDG" &&
                    (a.symbol === "ETH" || a.symbol === "TERA" || listedSymbols.includes(a.symbol)),
                )
                .map((a) => (
                  <Pressable
                    key={a.symbol}
                    onPress={() => {
                      setAssetSymbol(a.symbol);
                      setTrade("BUY");
                      clearAmount();
                      setSwapReceivePicker(false);
                    }}
                    style={[s.panel, { flexDirection: "row", alignItems: "center", gap: 12 }]}
                  >
                    <TokenIcon symbol={a.symbol} size={32} />
                    <Text style={[s.text, { flex: 1, fontWeight: "600" }]}>{a.symbol}</Text>
                    {assetSymbol === a.symbol && (
                      <Icon name="check" size={20} color={colors.green} />
                    )}
                  </Pressable>
                ))}
            </ScrollView>
          </SafeAreaView>
        </SafeAreaProvider>
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
          ExpoSpeechRecognitionModule?.stop();
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
              ExpoSpeechRecognitionModule?.stop();
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
        <SafeAreaProvider>
          <SafeAreaView style={[s.page, modalPage]}>
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
        </SafeAreaProvider>
      </Modal>
      <Modal
        visible={!!review && !!owner}
        transparent
        animationType="slide"
        onRequestClose={() => !busy && !signing && setReview(null)}
      >
        <View style={{ flex: 1, backgroundColor: colors.scrim, justifyContent: "flex-end" }}>
          <SafeAreaView
            edges={["bottom"]}
            style={{
              maxHeight: "88%",
              backgroundColor: colors.sheet,
              borderTopLeftRadius: 30,
              borderTopRightRadius: 30,
              ...sheetFrame,
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
              {review?.historyNote && <Text style={s.small}>{review.historyNote}</Text>}
              {!review?.historical && review?.intelligence && (
                <View style={[s.panel, { gap: 8 }]}>
                  <Text style={s.eyebrow}>{t("TERA INTELLIGENCE", "TERA 智能分析")}</Text>
                  <Text style={s.text}>{review.intelligence.preview}</Text>
                  {review.intelligence.risks.map((risk, index) => (
                    <Text key={`risk-${index}`} style={[s.small, { color: colors.danger }]}>{risk}</Text>
                  ))}
                  {review.intelligence.safer.map((tip, index) => (
                    <Text key={`safer-${index}`} style={s.small}>{tip}</Text>
                  ))}
                  {review.intelligence.route && <Text style={s.small}>{review.intelligence.route}</Text>}
                  {review.intelligence.networkFee && <Text style={s.small}>{review.intelligence.networkFee}</Text>}
                </View>
              )}
              {!review?.historical && review?.netBalanceDelta && review.netBalanceDelta.hasDeltas && (
                <View style={[s.panel, { gap: 10, backgroundColor: colors.wash }]}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={s.eyebrow}>{t("SIMULATED NET BALANCE DELTA", "模拟净余额变动")}</Text>
                    <Text style={[s.small, { color: colors.green, fontWeight: "600", fontSize: 11 }]}>
                      {t("Pre-execution Simulation", "执行前模拟")}
                    </Text>
                  </View>
                  <View style={{ gap: 8 }}>
                    {review.netBalanceDelta.pays.length > 0 && (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <Text style={[s.small, { fontWeight: "700", color: colors.muted, width: 85 }]}>
                          {t("You Pay:", "你支付:")}
                        </Text>
                        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", flex: 1 }}>
                          {review.netBalanceDelta.pays.map((item, idx) => (
                            <View
                              key={`pay-${idx}`}
                              style={{
                                backgroundColor: colors.danger + "18",
                                borderColor: colors.danger + "40",
                                borderWidth: 1,
                                paddingHorizontal: 9,
                                paddingVertical: 4,
                                borderRadius: 8,
                              }}
                            >
                              <Text style={{ color: colors.danger, fontWeight: "700", fontSize: 12 }}>
                                {item.formatted}
                              </Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    )}
                    {review.netBalanceDelta.receives.length > 0 && (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <Text style={[s.small, { fontWeight: "700", color: colors.muted, width: 85 }]}>
                          {t("You Receive:", "你收到:")}
                        </Text>
                        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", flex: 1 }}>
                          {review.netBalanceDelta.receives.map((item, idx) => (
                            <View
                              key={`rec-${idx}`}
                              style={{
                                backgroundColor: colors.green + "18",
                                borderColor: colors.green + "40",
                                borderWidth: 1,
                                paddingHorizontal: 9,
                                paddingVertical: 4,
                                borderRadius: 8,
                              }}
                            >
                              <Text style={{ color: colors.green, fontWeight: "700", fontSize: 12 }}>
                                {item.formatted}
                              </Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    )}
                  </View>
                </View>
              )}
              {review?.rows.map(([label, value], i) => (
                <Row key={i} label={label} value={value} />
              ))}
              {review?.note && !review.historical ? (
                <Row label={t("Your note", "你的备注")} value={review.note} />
              ) : null}
              {!!review?.steps.length && <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: reviewDetailsOpen }}
                onPress={() => setReviewDetailsOpen((open) => !open)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingVertical: 10,
                }}
              >
                <Text style={[s.small, { color: colors.green, fontWeight: "700" }]}>
                  {t("Transaction details", "\u4ea4\u6613\u8be6\u60c5")}
                </Text>
                <Icon
                  name={reviewDetailsOpen ? "chevron-up" : "chevron-down"}
                  size={18}
                  color={colors.green}
                />
              </Pressable>}
              {reviewDetailsOpen &&
                review?.steps.map((step, index) => (
                  <Row
                    key={`${step.to}-${index}`}
                    label={`${t("Step", "步骤")} ${index + 1}`}
                    value={`${step.data === "0x" ? t("Native transfer", "原生转账") : t("Contract call", "合约调用")} · ${step.to.slice(0, 8)}…${step.to.slice(-4)}`}
                  />
                ))}
              {!review?.historical && (
                <View style={[s.panel, { gap: 10 }]}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={s.eyebrow}>{t("GAS SPEED URGENCY", "GAS 速度选择")}</Text>
                    <Text style={[s.small, { color: colors.green, fontWeight: "600" }]}>
                      {GAS_SPEEDS[selectedGasSpeed].label} · {GAS_SPEEDS[selectedGasSpeed].timeEstimate}
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {(["eco", "standard", "fast"] as const).map((tierKey) => {
                      const tier = GAS_SPEEDS[tierKey];
                      const active = selectedGasSpeed === tierKey;
                      const estimates = getAllGasTierEstimates();
                      const tierEstimate = estimates[tierKey];
                      return (
                        <Pressable
                          key={tierKey}
                          accessibilityRole="button"
                          onPress={() => setSelectedGasSpeed(tierKey)}
                          style={{
                            flex: 1,
                            paddingVertical: 10,
                            paddingHorizontal: 8,
                            borderRadius: 14,
                            borderWidth: 1,
                            borderColor: active ? colors.green : colors.line,
                            backgroundColor: active ? colors.tint : colors.wash,
                            alignItems: "center",
                            gap: 3,
                          }}
                        >
                          <Text style={{ fontSize: 13, fontWeight: "700", color: active ? colors.green : colors.ink }}>
                            {tier.label}
                          </Text>
                          <Text style={{ fontSize: 11, color: active ? colors.green : colors.muted, fontWeight: "500" }}>
                            {tier.timeEstimate}
                          </Text>
                          <Text style={{ fontSize: 11, color: colors.muted }}>
                            {tierEstimate?.feeEth ? `${tierEstimate.feeEth} ETH` : "~0.0001"}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              )}
              {auth && !signing && !review?.historical && (
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
                  {vault.biometricsSupported && (
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
                  )}
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
              {!review?.historical && review?.impact && impactCore.message(review.impact) ? (
                <View
                  style={[
                    s.panel,
                    {
                      gap: 8,
                      borderWidth: 1,
                      borderColor: review.impact.level === "warn" ? "#d97706" : colors.danger,
                      backgroundColor: review.impact.level === "warn" ? "#d977061a" : colors.danger + "1a",
                    },
                  ]}
                >
                  <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
                    <Icon
                      name="alert-outline"
                      size={18}
                      color={review.impact.level === "warn" ? "#d97706" : colors.danger}
                    />
                    <Text style={[s.small, { flex: 1, color: colors.ink }]}>{impactCore.message(review.impact)}</Text>
                  </View>
                  {review.impact.level === "confirm" ? (
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: impactAccepted }}
                      onPress={() => setImpactAccepted((value) => !value)}
                      style={{ flexDirection: "row", gap: 8, alignItems: "center" }}
                    >
                      <Icon
                        name={impactAccepted ? "checkbox-marked" : "checkbox-blank-outline"}
                        size={22}
                        color={impactAccepted ? colors.danger : colors.muted}
                      />
                      <Text style={[s.small, { flex: 1, color: colors.ink, fontWeight: "700" }]}>
                        {impactCore.consentText(review.impact)}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
              {!review?.historical && review?.feeWei ? (
                <Row
                  label={t("Network fee", "网络手续费")}
                  value={networkSpeed.describeFee(review.feeWei, prices.ETH)}
                />
              ) : null}
              {!review?.historical && <Text style={s.small}>
                {t(
                  "Network fees are additional, capped at 0.001 ETH per transaction step. This authorizes only the reviewed steps.",
                  "网络手续费另计，每个交易步骤上限为 0.001 ETH，此操作仅授权已审核的步骤。",
                )}
              </Text>}
              {!review?.historical && <Pressable
                accessibilityRole="button"
                accessibilityLabel={t(
                  "Hold to sign transaction",
                  "\u6309\u4f4f\u4ee5\u7b7e\u7f72\u4ea4\u6613",
                )}
                accessibilityHint={t(
                  "Keep holding briefly to approve this reviewed transaction.",
                  "\u6301\u7eed\u6309\u4f4f\u4ee5\u6279\u51c6\u5df2\u5ba1\u6838\u7684\u4ea4\u6613\u3002",
                )}
                delayLongPress={HOLD_TO_SIGN_MS}
                disabled={
                  busy ||
                  signing ||
                  review?.simulation === "checking" ||
                  !review ||
                  (review.impact?.level === "confirm" && !impactAccepted)
                }
                onLongPress={() => {
                  const current = review;
                  if (current) {
                    holdProgress.stopAnimation();
                    holdProgress.setValue(1);
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    void run(() => signReview(current));
                  }
                }}
                onPressIn={() => {
                  holdProgress.stopAnimation();
                  holdProgress.setValue(0);
                  Animated.timing(holdProgress, {
                    toValue: 1,
                    duration: HOLD_TO_SIGN_MS,
                    useNativeDriver: false,
                  }).start();
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
                onPressOut={() => {
                  holdProgress.stopAnimation();
                  Animated.timing(holdProgress, {
                    toValue: 0,
                    duration: 120,
                    useNativeDriver: false,
                  }).start();
                }}
                style={({ pressed }) => ({
                  minHeight: 56,
                  borderRadius: 18,
                  backgroundColor: colors.green,
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                  opacity:
                    busy || signing || review?.simulation === "checking" ? 0.5 : pressed ? 0.82 : 1,
                })}
              >
                <Animated.View
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: holdProgress.interpolate({
                      inputRange: [0, 1],
                      outputRange: ["0%", "100%"],
                    }),
                    backgroundColor: colors.lime,
                    opacity: 0.35,
                  }}
                />
                <Text style={{ color: colors.paper, fontSize: 16, fontWeight: "800" }}>
                  {t("Hold to sign", "\u6309\u4f4f\u4ee5\u7b7e\u7f72")}
                </Text>
              </Pressable>}
              <Button disabled={busy || signing} onPress={() => setReview(null)}>
                {review?.historical ? t("Close", "关闭") : t("Cancel", "取消")}
              </Button>
            </ScrollView>
          </SafeAreaView>
          {signing && (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.sheet, alignItems: "center", justifyContent: "center", gap: 16 }]}>
              <TeraSpinner size={42} />
              <Text style={s.label}>{t("Processing transaction…", "正在处理交易…")}</Text>
            </View>
          )}
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
              ...sheetFrame,
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
                ...sheetFrame,
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
          <View style={[s.panel, { backgroundColor: colors.sheet }, dialogFrame]}>
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
            {vault.biometricsSupported && (
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
            )}
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
          <View style={[s.panel, { backgroundColor: colors.sheet, gap: 14 }, dialogFrame]}>
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
      <Modal
        visible={biometricSheet && !!owner}
        transparent
        animationType="fade"
        onRequestClose={() => !busy && setBiometricSheet(false)}
      >
        <View
          style={{ flex: 1, backgroundColor: colors.scrim, justifyContent: "center", padding: 24 }}
        >
          <View style={[s.panel, { backgroundColor: colors.sheet, gap: 14 }, dialogFrame]}>
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
      <Modal
        visible={!!revealed && !!owner}
        onRequestClose={() => {
          setRevealed("");
          setPhraseCopied(false);
        }}
      >
        <SafeAreaProvider>
          <SafeAreaView style={[s.page, modalPage]}>
            <View style={s.content}>
              {title("Recovery phrase.", "助记词。")}
              <Text style={s.small}>
                {t(
                  "Write this down privately. Never send it to anyone.",
                  "请私下记好，切勿发送给任何人。",
                )}
              </Text>
              <Text style={[s.mono, { fontSize: 20, lineHeight: 36 }]}>{revealed}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  void Clipboard.setStringAsync(revealed).then(() => setPhraseCopied(true))
                }
                style={({ pressed }) => [s.button, { opacity: pressed ? 0.8 : 1 }]}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                  }}
                >
                  <Icon name="copy" size={16} color={colors.ink} />
                  <Text style={s.buttonText}>
                    {t(
                      phraseCopied ? "Copied" : "Copy recovery phrase",
                      phraseCopied ? "\u5df2\u590d\u5236" : "\u590d\u5236\u52a9\u8bb0\u8bcd",
                    )}
                  </Text>
                </View>
              </Pressable>
              <Button onPress={() => setRevealed("")}>{t("Done", "完成")}</Button>
            </View>
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
      <Modal
        visible={!!revealedKey && !!owner}
        onRequestClose={() => {
          setRevealedKey(null);
          setKeyCopied(false);
        }}
      >
        <SafeAreaProvider>
          <SafeAreaView style={[s.page, modalPage]}>
            <ScrollView contentContainerStyle={s.content}>
              {title("Private key.", "私钥。")}
              <Text style={s.small}>
                {t(
                  "This key controls this wallet only. Anyone who gets it can move its funds. Keep it private.",
                  "此私钥仅控制此钱包。获取私钥的人可以转走其中的资金，请妥善保管。",
                )}
              </Text>
              <View style={s.panel}>
                <Text style={s.eyebrow}>
                  {t("Wallet address", "钱包地址")}
                  {revealedKey
                    ? ` · ${walletName({ index: revealedKey.index, name: accounts.find((entry) => entry.index === revealedKey.index)?.name || "" })}`
                    : ""}
                </Text>
                <Text style={s.mono} selectable>
                  {revealedKey?.address}
                </Text>
              </View>
              <View style={s.panel}>
                <Text style={s.eyebrow}>{t("Private key", "私钥")}</Text>
                <Text style={[s.mono, { fontSize: 17, lineHeight: 27 }]} selectable>
                  {revealedKey?.privateKey}
                </Text>
              </View>
              <Button
                primary
                onPress={() => {
                  if (revealedKey) {
                    void Clipboard.setStringAsync(revealedKey.privateKey).then(() =>
                      setKeyCopied(true),
                    );
                  }
                }}
              >
                {keyCopied ? t("Copied", "已复制") : t("Copy private key", "复制私钥")}
              </Button>
              <Button
                onPress={() => {
                  setRevealedKey(null);
                  setKeyCopied(false);
                }}
              >
                {t("Done", "完成")}
              </Button>
            </ScrollView>
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
      {txAlert ? (
        <Pressable
          accessibilityRole="alert"
          accessibilityLabel={`${txAlert.title}. ${txAlert.body}`}
          onPress={() => {
            setTxAlert(null);
            setPage("notifications");
          }}
          style={({ pressed }) => ({
            position: "absolute",
            top: 12,
            left: 16,
            right: 16,
            alignSelf: "center",
            maxWidth: 520,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            padding: 14,
            borderRadius: 18,
            backgroundColor: pressed ? colors.raised : colors.sheet,
            shadowColor: "#000",
            shadowOpacity: 0.25,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 6 },
            elevation: 8,
          })}
        >
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
            <Icon name="bell" size={18} color={colors.paper} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={s.label} numberOfLines={1}>
              {txAlert.title}
            </Text>
            <Text style={s.small} numberOfLines={2}>
              {txAlert.body}
            </Text>
          </View>
          <Icon name="chevron-right" size={18} color={colors.muted} />
        </Pressable>
      ) : null}
      {bizSplash ? <biz.Splash onDone={() => setBizSplash(false)} /> : null}
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
