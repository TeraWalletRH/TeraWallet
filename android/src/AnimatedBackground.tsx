import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet } from "react-native";
import { colors } from "./ui";

/**
 * Three soft color glows sampled from the wordmark's own gradient (olive,
 * gold, copper), drifting slowly behind the app's content. Loops seamlessly
 * — each eases back to its start position rather than jumping — and stays
 * subtle enough not to compete with anything on screen.
 *
 * Each glow is four concentric circles of falling opacity rather than one
 * flat-opacity circle: a single hard-edged circle shows a visible boundary
 * wherever it lands under anything without its own opaque background (the
 * header, most notably) — no gradient library is worth a new native
 * dependency and a rebuild just for this, so the falloff is faked with
 * stacked rings instead.
 */
export function AnimatedBackground() {
  const a = useRef(new Animated.Value(0)).current;
  const b = useRef(new Animated.Value(0)).current;
  const c = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const drift = (value: Animated.Value, duration: number, delay = 0) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(value, {
            toValue: 1,
            duration,
            delay,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: 0,
            duration,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      );
    // Different periods and start delays so the three never fall back into
    // sync with each other.
    const animations = [drift(a, 17000), drift(b, 22000, 1500), drift(c, 27000, 3500)];
    animations.forEach((animation) => animation.start());
    return () => animations.forEach((animation) => animation.stop());
  }, [a, b, c]);

  const path = (value: Animated.Value, dx: number, dy: number) => ({
    transform: [
      { translateX: value.interpolate({ inputRange: [0, 1], outputRange: [0, dx] }) },
      { translateY: value.interpolate({ inputRange: [0, 1], outputRange: [0, dy] }) },
    ],
  });

  return (
    <Animated.View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={path(a, 70, -50)}>
        <Glow color={colors.green} peak={0.22} top={-180} left={-180} />
      </Animated.View>
      <Animated.View style={path(b, -55, 80)}>
        <Glow color={colors.lime} peak={0.18} top={60} right={-200} />
      </Animated.View>
      <Animated.View style={path(c, 45, 100)}>
        <Glow color={colors.copper} peak={0.17} bottom={-200} left={-90} />
      </Animated.View>
    </Animated.View>
  );
}

/** Four nested circles, each larger and fainter, approximating a soft radial glow. */
function Glow({
  color,
  peak,
  top,
  bottom,
  left,
  right,
}: {
  color: string;
  peak: number;
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}) {
  const rings = [
    { size: 180, opacity: peak },
    { size: 300, opacity: peak * 0.55 },
    { size: 420, opacity: peak * 0.25 },
    { size: 540, opacity: peak * 0.1 },
  ];
  return (
    <>
      {rings.map((ring, index) => (
        <Animated.View
          key={index}
          style={{
            position: "absolute",
            width: ring.size,
            height: ring.size,
            borderRadius: ring.size / 2,
            backgroundColor: color,
            opacity: ring.opacity,
            top: top !== undefined ? top - (ring.size - rings[0].size) / 2 : undefined,
            bottom: bottom !== undefined ? bottom - (ring.size - rings[0].size) / 2 : undefined,
            left: left !== undefined ? left - (ring.size - rings[0].size) / 2 : undefined,
            right: right !== undefined ? right - (ring.size - rings[0].size) / 2 : undefined,
          }}
        />
      ))}
    </>
  );
}
