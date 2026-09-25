import React, { useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text as NativeText,
  TextInput as NativeTextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Icon } from "./icons";
// Tokens sampled from the wordmark itself (public/logo.png): the olive-green
// and cream fold, the gold-to-copper fold, and the forest-green-to-warm-brown
// ambient gradient behind it. Old names are kept so every screen picks the
// theme up without a rename: `bg` is the page, `ink` the text on it, `wash`
// a card on the page.
//
// `paper` and `scrim` are deliberately NOT in either theme table below: every
// other token needs a different value on a light page than on a dark one,
// but `paper` is specifically "dark text/icon on a mid-brightness accent
// surface" (a primary button, a balance card) — the accent colors are
// similar brightness in both themes, so the right contrast color for them
// doesn't change with the theme. `scrim` (a modal backdrop) is a translucent
// black in both themes for the same reason. Both stay fixed constants below,
// outside the swappable set, rather than (wrongly) tracking the page
// background the way they would if they were just "the opposite of ink".
const darkTheme = {
  bg: "#171e19",
  ink: "#f5ecd7", // cream, from the mark's pale fold
  muted: "#a79a80",
  faint: "#6e6555",
  line: "#3a3428",
  wash: "#211d19", // cards
  raised: "#2b2620", // a card on a card
  sheet: "#1c1712", // bottom sheets and dialogs
  green: "#97a85c", // Primary — olive, from the mark's green fold
  greenHover: "#7e8f49",
  greenPressed: "#66753a",
  lime: "#d3a44f", // secondary accent — gold, from the mark's mid-tone
  copper: "#b4632f", // tertiary accent — from the mark's richest fold; CTA gradients pair this with `lime`
  tint: "#22301f", // a selected card: primary over the card colour
  warnTint: "#362a16",
  dangerTint: "#34201b",
  yellow: "#e0b24f",
  dark: "#2b2620",
  danger: "#e2604a", // lifted so small text stays legible on the dark page
};
const lightTheme: typeof darkTheme = {
  bg: "#f6efdd",
  ink: "#2a2117",
  muted: "#83765f",
  faint: "#a99c82",
  line: "#e3d7ba",
  wash: "#ffffff",
  raised: "#f1e7d0",
  sheet: "#ffffff",
  green: "#6c7f3c", // deepened from the dark-theme olive: the same hue reads as too washed-out on a light page
  greenHover: "#5a6931",
  greenPressed: "#4a5628",
  lime: "#b98a38",
  copper: "#93502a",
  tint: "#e7edd2",
  warnTint: "#f6e7c4",
  dangerTint: "#f8ddd6",
  yellow: "#a8791f",
  dark: "#f1e7d0",
  danger: "#c1432e",
};
// A mutable object, not a frozen theme snapshot: setColorTheme() below
// reassigns its keys in place (Object.assign), so every existing
// `colors.green`/`s.text`-style reference throughout the app — there are
// hundreds — keeps working unchanged and simply reads the current theme's
// value on its next render, rather than every call site needing to move to
// a useTheme() hook.
export const colors = {
  ...darkTheme,
  paper: "#171e19",
  scrim: "#000000b3",
};
export let colorTheme: "light" | "dark" = "dark";
export function setColorTheme(theme: "light" | "dark") {
  if (theme === colorTheme) return;
  colorTheme = theme;
  Object.assign(colors, theme === "dark" ? darkTheme : lightTheme);
  Object.assign(styles, buildStyles());
}

// Plus Jakarta Sans, the kit's typeface (SIL OFL — assets/fonts/OFL.txt).
// Android picks a custom font by file, not by weight, so each weight is its
// own family and `fontWeight` is translated into one of them here. Until the
// files have loaded — or if they never do — text keeps the system font rather
// than naming a family Android does not have.
export const fontFiles = {
  "PlusJakartaSans-Regular": require("../assets/fonts/PlusJakartaSans-Regular.ttf"),
  "PlusJakartaSans-Medium": require("../assets/fonts/PlusJakartaSans-Medium.ttf"),
  "PlusJakartaSans-SemiBold": require("../assets/fonts/PlusJakartaSans-SemiBold.ttf"),
  "PlusJakartaSans-Bold": require("../assets/fonts/PlusJakartaSans-Bold.ttf"),
  "PlusJakartaSans-ExtraBold": require("../assets/fonts/PlusJakartaSans-ExtraBold.ttf"),
};
let fontsReady = false;
export function setFontsReady(ready: boolean) {
  fontsReady = ready;
}
const familyFor = (weight: TextStyle["fontWeight"]) => {
  const w = weight === "bold" ? 700 : weight === "normal" || weight == null ? 400 : Number(weight);
  if (w >= 800) return "PlusJakartaSans-ExtraBold";
  if (w >= 700) return "PlusJakartaSans-Bold";
  if (w >= 600) return "PlusJakartaSans-SemiBold";
  if (w >= 500) return "PlusJakartaSans-Medium";
  return "PlusJakartaSans-Regular";
};
function withFont(style: StyleProp<TextStyle>): StyleProp<TextStyle> {
  if (!fontsReady) return style;
  const flat = StyleSheet.flatten(style) || {};
  // Monospace stays monospace: addresses and hashes are read character by character.
  if (flat.fontFamily) return style;
  return [style, { fontFamily: familyFor(flat.fontWeight), fontWeight: "normal" }];
}
export function Text(props: TextProps) {
  return <NativeText {...props} style={withFont(props.style)} />;
}
export function TextInput(props: TextInputProps) {
  return <NativeTextInput {...props} style={withFont(props.style)} />;
}

// One icon component for every call site: Lucide icons rendered as SVG
// (see ./icons.tsx), vendored locally rather than a font/PNG set.
export { Icon };

// A function, not a bare StyleSheet.create call: setColorTheme() re-runs it
// and Object.assign()s the result onto the exported `styles` object in
// place (same reasoning as `colors` above), so `s.page`/`s.text`/etc. stay
// valid imports that just pick up the new theme's values on next render.
function buildStyles() {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.bg },
    // flexGrow, not just flex: a ScrollView's content container only obeys
    // flexGrow (it has to be able to exceed the screen and still scroll) — it
    // stretches to fill the screen when content is shorter, which is what
    // lets a flex:1 spacer inside push something to the bottom of the
    // viewport; it's a no-op once real content already exceeds screen height.
    content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 36, gap: 18, flexGrow: 1 },
    header: {
      paddingHorizontal: 20,
      paddingVertical: 13,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    eyebrow: {
      color: colors.muted,
      fontSize: 12,
      fontWeight: "600",
      letterSpacing: 0.4,
      textTransform: "uppercase",
    },
    title: {
      fontSize: 34,
      color: colors.ink,
      lineHeight: 39,
      fontWeight: "800",
      letterSpacing: -0.8,
    },
    text: { color: colors.ink, fontSize: 15, lineHeight: 22 },
    small: { color: colors.muted, fontSize: 13, lineHeight: 19 },
    mono: { fontFamily: "monospace", color: colors.ink, fontSize: 13, lineHeight: 21 },
    label: { color: colors.ink, fontSize: 14, fontWeight: "600" },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      paddingVertical: 15,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.line,
    },
    panel: {
      padding: 16,
      backgroundColor: colors.wash,
      gap: 10,
      borderRadius: 16,
    },
    button: {
      minHeight: 52,
      paddingVertical: 14,
      paddingHorizontal: 20,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.wash,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center",
    },
    buttonText: { fontSize: 15, fontWeight: "600", color: colors.ink, textAlign: "center" },
    input: {
      paddingHorizontal: 16,
      paddingVertical: 14,
      minHeight: 52,
      borderWidth: 1,
      borderColor: colors.line,
      color: colors.ink,
      fontSize: 16,
      backgroundColor: colors.wash,
      borderRadius: 14,
    },
    field: { gap: 8 },
    wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    quickActions: { flexDirection: "row", justifyContent: "space-between" },
    quickAction: { flex: 1, alignItems: "center", gap: 8 },
    quickIcon: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: colors.wash,
      borderWidth: 1,
      borderColor: colors.line,
      alignItems: "center",
      justifyContent: "center",
    },
    iconDisc: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: colors.raised,
      alignItems: "center",
      justifyContent: "center",
    },
    error: {
      padding: 15,
      borderRadius: 14,
      borderLeftWidth: 3,
      borderColor: colors.danger,
      backgroundColor: colors.dangerTint,
    },
  });
}
export const styles = buildStyles();
const logoMark = require("../assets/logo-mark.png");

/**
 * The wordmark, spinning — used everywhere the app needs a loading
 * indicator (on a busy button, a loading page) instead of the system
 * ActivityIndicator. Shows the mark's own warm gradient as-is rather than
 * tinting it per context: it's meant to always read as the same mark, not
 * change color to match whatever it's sitting on.
 */
export function TeraSpinner({ size = 20 }: { size?: number }) {
  const spin = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1100,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);
  return (
    <Animated.Image
      source={logoMark}
      resizeMode="contain"
      style={{
        width: size,
        height: size,
        transform: [
          { rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) },
        ],
      }}
    />
  );
}
export function Button({
  children,
  onPress,
  primary = false,
  danger = false,
  disabled = false,
}: {
  children: React.ReactNode;
  onPress: () => void;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  const label = (
    <Text
      style={[
        styles.buttonText,
        primary && { color: colors.paper },
        danger && { color: colors.danger },
      ]}
    >
      {children}
    </Text>
  );
  // Primary is a real gradient (the mark's own gold-to-copper fold), not a
  // flat fill — needs its own render path, since a gradient is a layered
  // component, not a backgroundColor a Pressable's style can express.
  if (primary)
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        onPress={onPress}
        disabled={disabled}
        style={({ pressed }) => ({ opacity: disabled ? 0.4 : pressed ? 0.8 : 1 })}
      >
        <LinearGradient
          colors={[colors.lime, colors.copper]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.button, { borderWidth: 0, overflow: "hidden" }]}
        >
          {label}
        </LinearGradient>
      </Pressable>
    );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        danger && { backgroundColor: colors.dangerTint, borderColor: colors.danger },
        !danger && pressed && { backgroundColor: colors.raised },
        { opacity: disabled ? 0.4 : danger && pressed ? 0.7 : 1 },
      ]}
    >
      {label}
    </Pressable>
  );
}
export function Field({
  label,
  hint,
  error,
  ...props
}: TextInputProps & { label: string; hint?: string; error?: string }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.faint}
        selectionColor={colors.green}
        autoCorrect={false}
        autoCapitalize="none"
        {...props}
        onFocus={(e) => {
          setFocused(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          props.onBlur?.(e);
        }}
        style={[
          styles.input,
          focused && { borderColor: colors.green },
          !!error && { borderColor: colors.danger },
          props.multiline && { minHeight: 110, textAlignVertical: "top" },
          props.style,
        ]}
      />
      {error ? (
        <Text style={[styles.small, { color: colors.danger }]}>{error}</Text>
      ) : hint ? (
        <Text style={styles.small}>{hint}</Text>
      ) : null}
    </View>
  );
}
/**
 * A 6-box PIN entry, OTP-style, instead of one plain masked field. One real
 * TextInput does the actual keyboard capture — kept present but visually
 * invisible — while the boxes just reflect its current value; this avoids
 * juggling focus across 6 separate inputs (and the backspace-across-boxes
 * logic that comes with it) for a component whose only job is to show, not
 * collect, the digits differently.
 */
/**
 * A row of PIN boxes — pure display, driven by a Keypad below it rather
 * than the system keyboard (see Keypad). `active`/`onActivate` exist for
 * the two-field PIN-setup screen, where one shared Keypad has to know which
 * of the two PinInputs it's currently typing into; a single-field screen
 * (unlock) can leave both at their defaults and it behaves as always-active.
 */
export function PinInput({
  label,
  value,
  length = 6,
  active = true,
  onActivate,
}: {
  label: string;
  value: string;
  length?: number;
  active?: boolean;
  onActivate?: () => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="none"
        onPress={onActivate}
        style={{ flexDirection: "row", justifyContent: "space-between" }}
      >
        {Array.from({ length }).map((_, index) => {
          const filled = index < value.length;
          const cursor = active && index === value.length;
          return (
            <View
              key={index}
              style={[
                styles.input,
                {
                  width: 44,
                  paddingHorizontal: 0,
                  alignItems: "center",
                  justifyContent: "center",
                },
                cursor && { borderColor: colors.green },
              ]}
            >
              <Text style={{ color: colors.ink, fontSize: 22, fontWeight: "700" }}>
                {filled ? "•" : ""}
              </Text>
            </View>
          );
        })}
      </Pressable>
    </View>
  );
}
/**
 * An in-app numeric keypad for PIN entry, instead of triggering the system
 * keyboard — full control over layout, and reads as more deliberate/branded
 * than the OS's generic number pad popping up over the page.
 */
export function Keypad({
  onDigit,
  onBackspace,
}: {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
}) {
  const rows = [
    ["1", "2", "3"],
    ["4", "5", "6"],
    ["7", "8", "9"],
    ["", "0", "backspace"],
  ];
  return (
    <View style={{ gap: 16 }}>
      {rows.map((row, i) => (
        <View key={i} style={{ flexDirection: "row", justifyContent: "space-between" }}>
          {row.map((key, j) => {
            if (key === "") return <View key={j} style={{ width: 72, height: 72 }} />;
            const isBackspace = key === "backspace";
            return (
              <Pressable
                key={j}
                accessibilityRole="button"
                accessibilityLabel={isBackspace ? "Backspace" : key}
                onPress={() => (isBackspace ? onBackspace() : onDigit(key))}
                style={({ pressed }) => ({
                  width: 72,
                  height: 72,
                  borderRadius: 36,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: pressed ? colors.raised : colors.wash,
                })}
              >
                {isBackspace ? (
                  <Icon name="backspace-outline" size={22} color={colors.ink} />
                ) : (
                  <Text style={{ fontSize: 26, fontWeight: "600", color: colors.ink }}>{key}</Text>
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}
export function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.small, { flex: 1 }]}>{label}</Text>
      <Text selectable style={[styles.mono, { flex: 2, textAlign: "right" }]}>
        {value}
      </Text>
    </View>
  );
}
/** A segmented control: every option in one pill, the chosen one filled green. */
export function Choices({
  options,
  value,
  select,
}: {
  options: string[];
  value: string;
  select: (s: string) => void;
}) {
  return (
    <View
      accessibilityRole="radiogroup"
      style={{
        flexDirection: "row",
        backgroundColor: colors.wash,
        borderRadius: 999,
        padding: 4,
        gap: 4,
      }}
    >
      {options.map((o) => {
        const on = o === value;
        return (
          <Pressable
            key={o}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            onPress={() => select(o)}
            style={{
              flex: 1,
              minHeight: 40,
              borderRadius: 999,
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: 8,
              backgroundColor: on ? colors.green : "transparent",
            }}
          >
            <Text
              numberOfLines={1}
              style={[styles.small, { fontWeight: "600", color: on ? colors.paper : colors.muted }]}
            >
              {o}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
/** The kit's screen header: a round back button, the title centred over the screen. */
export function Header({
  title,
  onBack,
  backLabel = "Back",
  right,
}: {
  title: string;
  onBack?: () => void;
  backLabel?: string;
  right?: React.ReactNode;
}) {
  const side = { width: 40, height: 40 };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={backLabel}
          onPress={onBack}
          hitSlop={8}
          style={({ pressed }) => [
            side,
            {
              borderRadius: 20,
              backgroundColor: pressed ? colors.raised : colors.wash,
              alignItems: "center",
              justifyContent: "center",
            },
          ]}
        >
          <Icon name="chevron-left" size={24} color={colors.ink} />
        </Pressable>
      ) : (
        <View style={side} />
      )}
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        style={[styles.text, { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "700" }]}
      >
        {title}
      </Text>
      {/* minWidth, not width: keeps single-icon headers exactly as before
          while letting a `right` with more than one control (e.g. info +
          add) grow past 40 instead of being squeezed into it. */}
      <View
        style={[
          side,
          {
            width: undefined,
            minWidth: side.width,
            alignItems: "flex-end",
            justifyContent: "center",
          },
        ]}
      >
        {right}
      </View>
    </View>
  );
}
/** How far through a multi-step flow the owner is: one bar per step. */
export function Steps({
  count,
  current,
  label,
}: {
  count: number;
  current: number;
  label: string;
}) {
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {Array.from({ length: count }, (_, i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              backgroundColor: i <= current ? colors.green : colors.line,
            }}
          />
        ))}
      </View>
      <Text style={styles.small}>
        {current + 1}/{count} · {label}
      </Text>
    </View>
  );
}
/** A titled group of rows in one card, like the kit's "Account details". */
export function Group({ title, children }: { title?: string; children: React.ReactNode }) {
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={{ gap: 10 }}>
      {title ? <Text style={[styles.text, { fontWeight: "700" }]}>{title}</Text> : null}
      <View style={[styles.panel, { paddingVertical: 4, gap: 0 }]}>
        {rows.map((row, i) => (
          <View
            key={i}
            style={
              i ? { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line } : null
            }
          >
            {row}
          </View>
        ))}
      </View>
    </View>
  );
}
export function ListRow({
  icon,
  label,
  detail,
  onPress,
  right,
  danger = false,
  disabled = false,
}: {
  icon: string;
  label: string;
  detail?: string;
  onPress?: () => void;
  right?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
}) {
  const tone = danger ? colors.danger : colors.ink;
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      disabled={!onPress || disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 13,
        opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
      })}
    >
      <View style={[styles.iconDisc, danger && { backgroundColor: colors.dangerTint }]}>
        <Icon name={icon} size={20} color={danger ? tone : colors.green} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.label, { color: tone }]}>{label}</Text>
        {detail ? (
          <Text style={styles.small} numberOfLines={2}>
            {detail}
          </Text>
        ) : null}
      </View>
      {right ?? (onPress ? <Icon name="chevron-right" size={22} color={colors.faint} /> : null)}
    </Pressable>
  );
}
/** The kit's switch. Drawn only: the row it sits in is what gets pressed. */
export function Toggle({ on, small = false }: { on: boolean; small?: boolean }) {
  const width = small ? 34 : 44,
    height = small ? 20 : 26,
    knob = small ? 14 : 20;
  return (
    <View
      style={{
        width,
        height,
        borderRadius: height / 2,
        padding: 3,
        justifyContent: "center",
        backgroundColor: on ? colors.green : colors.line,
      }}
    >
      <View
        style={{
          width: knob,
          height: knob,
          borderRadius: knob / 2,
          backgroundColor: "#ffffff",
          alignSelf: on ? "flex-end" : "flex-start",
        }}
      />
    </View>
  );
}
