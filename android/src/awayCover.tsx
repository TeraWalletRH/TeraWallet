import React, { useEffect, useState } from "react";
import { AppState, Image, Platform, Text, View } from "react-native";

/**
 * Covers the whole app while it isn't the thing being looked at, so balances
 * don't show in the app switcher or a tab preview.
 *
 * On a phone that is any time the app is not "active": iOS takes its
 * app-switcher snapshot while the app is "inactive", so the cover has to be up
 * by then, not just once it reaches the background. On the web it is a hidden
 * tab or a window that has lost focus (another window in front, a screen share
 * switching windows), and the cover lifts on its own when the page is back —
 * unlike a recovery phrase, nothing here needs a tap to show again.
 */
function useAway() {
  const [away, setAway] = useState(false);
  useEffect(() => {
    if (Platform.OS !== "web") {
      const subscription = AppState.addEventListener("change", (state) => setAway(state !== "active"));
      return () => subscription.remove();
    }
    if (typeof window === "undefined") return;
    const update = () => setAway(document.visibilityState === "hidden" || !document.hasFocus());
    window.addEventListener("blur", update);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.removeEventListener("blur", update);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return away;
}

export function AwayCover({
  enabled,
  colors,
  t,
}: {
  enabled: boolean;
  colors: { bg: string; ink: string; muted: string };
  t: (en: string, zh: string) => string;
}) {
  const away = useAway();
  if (!enabled || !away) return null;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          position: Platform.OS === "web" ? ("fixed" as any) : "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          zIndex: 100000,
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          backgroundColor: colors.bg,
        },
        // On the web the page behind is blurred as well as covered, so the
        // shape of the screen survives in a tab preview but no figure does.
        Platform.OS === "web"
          ? ({ backgroundColor: `${colors.bg}e6`, backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)" } as any)
          : null,
      ]}
    >
      <Image source={require("../assets/logo-mark.png")} style={{ width: 56, height: 56 }} resizeMode="contain" />
      {Platform.OS === "web" ? (
        <Text style={{ color: colors.muted, fontSize: 14 }}>{t("Hidden while you're away", "离开时已隐藏")}</Text>
      ) : null}
    </View>
  );
}
