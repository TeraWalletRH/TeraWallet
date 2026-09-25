import React from "react";
import { Dimensions, Pressable, View } from "react-native";
import { colors, Steps, styles as s, Text } from "./ui";

export type TourRect = { x: number; y: number; width: number; height: number };

/**
 * A spotlight walkthrough step: a dark scrim over the whole screen except a
 * cutout around one real, already-on-screen element, plus a tooltip next to
 * it. The cutout is four plain scrim-colored bands framing `rect` rather than
 * an SVG mask — simpler to reason about than path/fill-rule math, and this
 * app already prefers plain Views over SVG except where a shape genuinely
 * can't be built from rectangles (see VoiceBlob).
 */
export function AppTour({
  rect,
  label,
  body,
  extra,
  index,
  count,
  onNext,
  onBack,
  onSkip,
  nextLabel,
  skipLabel,
  backLabel,
}: {
  rect: TourRect | null;
  label: string;
  body: string;
  extra?: React.ReactNode;
  index: number;
  count: number;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  nextLabel: string;
  skipLabel: string;
  backLabel: string;
}) {
  if (!rect) return null;
  const { width: screenW, height: screenH } = Dimensions.get("window");
  const pad = 6;
  const hx = Math.max(0, rect.x - pad);
  const hy = Math.max(0, rect.y - pad);
  const hw = Math.min(screenW - hx, rect.width + pad * 2);
  const hh = rect.height + pad * 2;
  // The tooltip sits below the highlight, unless that would run off the
  // bottom of the screen — then it goes above instead.
  const below = screenH - (hy + hh) > 200;

  return (
    <View
      style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
      pointerEvents="auto"
    >
      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: hy,
          backgroundColor: colors.scrim,
        }}
      />
      <View
        style={{
          position: "absolute",
          top: hy + hh,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: colors.scrim,
        }}
      />
      <View
        style={{
          position: "absolute",
          top: hy,
          left: 0,
          width: hx,
          height: hh,
          backgroundColor: colors.scrim,
        }}
      />
      <View
        style={{
          position: "absolute",
          top: hy,
          left: hx + hw,
          right: 0,
          height: hh,
          backgroundColor: colors.scrim,
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: hy,
          left: hx,
          width: hw,
          height: hh,
          borderRadius: 18,
          borderWidth: 2,
          borderColor: colors.green,
        }}
      />
      <View
        style={[
          { position: "absolute", left: 20, right: 20 },
          below ? { top: hy + hh + 16 } : { bottom: screenH - hy + 16 },
          {
            backgroundColor: colors.sheet,
            borderRadius: 20,
            padding: 18,
            gap: 14,
            borderWidth: 1,
            borderColor: colors.line,
          },
        ]}
      >
        <Steps count={count} current={index} label={label} />
        <Text style={s.text}>{body}</Text>
        {extra}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Pressable
            accessibilityRole="button"
            onPress={onSkip}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingVertical: 8 })}
          >
            <Text style={[s.small, { color: colors.muted, fontWeight: "600" }]}>{skipLabel}</Text>
          </Pressable>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
            {index > 0 && (
              <Pressable
                accessibilityRole="button"
                onPress={onBack}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingVertical: 8 })}
              >
                <Text style={[s.small, { color: colors.ink, fontWeight: "600" }]}>{backLabel}</Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              onPress={onNext}
              style={({ pressed }) => ({
                backgroundColor: colors.green,
                borderRadius: 999,
                paddingVertical: 10,
                paddingHorizontal: 20,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Text style={{ color: colors.paper, fontWeight: "700" }}>{nextLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}
