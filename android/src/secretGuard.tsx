import React, { useEffect, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import * as ScreenCapture from "expo-screen-capture";

/**
 * Keeps the recovery phrase and private keys out of screenshots, screen
 * recordings and the app switcher while they are on screen.
 *
 * On a phone the operating system can enforce it: Android's FLAG_SECURE turns
 * captures and the recents thumbnail black, and iOS hides the content from
 * recordings and screenshots. A browser has no such switch, so on the web the
 * secret is covered whenever the tab is hidden or the window loses focus (a
 * screen-snipping tool, a screen share switching windows, another app in
 * front) and stays covered until the owner taps to show it again.
 */
export function useBlockScreenCapture(active: boolean) {
  useEffect(() => {
    if (!active || Platform.OS === "web") return;
    const key = "tera-secret";
    void ScreenCapture.preventScreenCaptureAsync(key).catch(() => {});
    return () => {
      void ScreenCapture.allowScreenCaptureAsync(key).catch(() => {});
    };
  }, [active]);
}

/** True once the page has been hidden or blurred, until `reset` is called. */
function useWasAway() {
  const [away, setAway] = useState(false);
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const leave = () => setAway(true);
    const visibility = () => document.visibilityState === "hidden" && leave();
    window.addEventListener("blur", leave);
    window.addEventListener("beforeprint", leave);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("blur", leave);
      window.removeEventListener("beforeprint", leave);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  return [away, () => setAway(false)] as const;
}

type Colors = { raised: string; ink: string; muted: string; line?: string };

/**
 * Wraps a secret. On the web it is covered after the page loses focus; on a
 * phone it renders the secret as is, with useBlockScreenCapture doing the work.
 */
export function SecretCover({
  children,
  colors,
  t,
}: {
  children: React.ReactNode;
  colors: Colors;
  t: (en: string, zh: string) => string;
}) {
  const [away, reset] = useWasAway();
  if (Platform.OS !== "web") return <>{children}</>;
  return (
    <View style={{ position: "relative" }}>
      <View
        aria-hidden={away}
        style={away ? ({ opacity: 0, userSelect: "none" } as any) : null}
      >
        {children}
      </View>
      {away ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Show secret", "显示内容")}
          onPress={reset}
          style={({ pressed }) => ({
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            padding: 16,
            borderRadius: 14,
            backgroundColor: colors.raised,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Text style={{ color: colors.ink, fontWeight: "700", fontSize: 15, textAlign: "center" }}>
            {t("Hidden while you were away", "离开期间已隐藏")}
          </Text>
          <Text style={{ color: colors.muted, fontSize: 13, textAlign: "center" }}>
            {t(
              "Tap to show. Make sure nobody is watching and nothing is recording.",
              "点按显示。请确认无人旁观、没有录屏。",
            )}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** One line under a secret saying what protects it on this platform. */
export function captureNote(t: (en: string, zh: string) => string) {
  return Platform.OS === "web"
    ? t(
        "Browsers can't block screenshots, so this is covered whenever you leave the page.",
        "浏览器无法阻止截图，因此离开页面时内容会被遮盖。",
      )
    : t("Screenshots and screen recording are blocked here.", "此页面已禁止截图和录屏。");
}
