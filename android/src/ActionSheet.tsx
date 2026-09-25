import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, PanResponder, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, Icon, styles as s, Text } from "./ui";

export type SheetAction = {
  key: string;
  icon: string;
  label: string;
  onPress: () => void;
  danger?: boolean;
};

// Slow in, slower to settle: a long ease-out reads as weight rather than lag.
const OPEN_MS = 520;
const CLOSE_MS = 340;
const settle = Easing.bezier(0.16, 1, 0.3, 1);
const leave = Easing.bezier(0.4, 0, 0.7, 0.2);

/**
 * Every action the wallet has, one tap from any tab — the centre button of the
 * tab bar opens it. It only navigates: each action lands on the same screen the
 * home shortcuts do, so nothing here can move funds without the usual review.
 */
export function ActionSheet({
  visible,
  onClose,
  onClosed,
  title,
  actions,
}: {
  visible: boolean;
  onClose: () => void;
  // Fires once this sheet's own native Modal has actually unmounted —
  // not just when `visible` flips false, but CLOSE_MS+ later, after the
  // close animation finishes. A caller whose action needs to open another
  // Modal (rather than just navigate) must wait for this: presenting a new
  // Modal while this one is still mid-dismissal hangs iOS. A fixed-duration
  // setTimeout as a substitute is a race — the native animation-complete
  // callback and a JS timer aren't guaranteed to land in that order.
  onClosed?: () => void;
  title: string;
  actions: SheetAction[];
}) {
  // Stays mounted through the closing animation, then unmounts.
  const [mounted, setMounted] = useState(visible);
  const [height, setHeight] = useState(420);
  const shown = useRef(new Animated.Value(0)).current; // 0 hidden → 1 open
  const drag = useRef(new Animated.Value(0)).current;
  const tiles = useRef(actions.map(() => new Animated.Value(0))).current;
  while (tiles.length < actions.length) tiles.push(new Animated.Value(0));
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      drag.setValue(0);
      tiles.forEach((tile) => tile.setValue(0));
      Animated.parallel([
        Animated.timing(shown, {
          toValue: 1,
          duration: OPEN_MS,
          easing: settle,
          useNativeDriver: true,
        }),
        Animated.stagger(
          35,
          tiles.map((tile) =>
            Animated.timing(tile, {
              toValue: 1,
              duration: 420,
              delay: 140,
              easing: settle,
              useNativeDriver: true,
            }),
          ),
        ),
      ]).start();
    } else if (mounted) {
      Animated.timing(shown, {
        toValue: 0,
        duration: CLOSE_MS,
        easing: leave,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished) return;
        setMounted(false);
        onClosedRef.current?.();
      });
    }
    // `mounted` is read, not reacted to: only `visible` starts an animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Pulled down far enough, or flicked, it closes from where the finger left it.
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_, g) => {
        if (g.dy > 90 || g.vy > 1.2) onCloseRef.current();
        else
          Animated.spring(drag, {
            toValue: 0,
            damping: 22,
            stiffness: 160,
            useNativeDriver: true,
          }).start();
      },
    }),
  ).current;

  if (!mounted) return null;
  const rise = shown.interpolate({ inputRange: [0, 1], outputRange: [height + 40, 0] });
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: colors.scrim,
          opacity: shown,
        }}
      >
        <Pressable accessibilityLabel="Close" onPress={onClose} style={{ flex: 1 }} />
      </Animated.View>
      <View style={{ flex: 1, justifyContent: "flex-end" }} pointerEvents="box-none">
        <Animated.View
          {...pan.panHandlers}
          onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
          style={{ transform: [{ translateY: Animated.add(rise, drag) }] }}
        >
          <SafeAreaView
            edges={["bottom"]}
            style={{
              backgroundColor: colors.sheet,
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              borderWidth: 1,
              borderBottomWidth: 0,
              borderColor: "#ffffff14",
              paddingHorizontal: 20,
              paddingTop: 12,
              paddingBottom: 18,
              gap: 18,
            }}
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
            <Text style={[s.text, { fontWeight: "700", fontSize: 17 }]}>{title}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 20 }}>
              {actions.map((a, i) => (
                <Animated.View
                  key={a.key}
                  style={{
                    width: "25%",
                    opacity: tiles[i],
                    transform: [
                      {
                        translateY: tiles[i].interpolate({
                          inputRange: [0, 1],
                          outputRange: [14, 0],
                        }),
                      },
                      {
                        scale: tiles[i].interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }),
                      },
                    ],
                  }}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={a.label}
                    onPress={() => {
                      onClose();
                      a.onPress();
                    }}
                    style={({ pressed }) => ({
                      alignItems: "center",
                      gap: 8,
                      opacity: pressed ? 0.6 : 1,
                      transform: [{ scale: pressed ? 0.94 : 1 }],
                    })}
                  >
                    <View
                      style={{
                        width: 56,
                        height: 56,
                        borderRadius: 18,
                        backgroundColor: a.danger ? colors.dangerTint : colors.wash,
                        borderWidth: 1,
                        borderColor: colors.line,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Icon
                        name={a.icon}
                        size={24}
                        color={a.danger ? colors.danger : colors.green}
                      />
                    </View>
                    <Text
                      numberOfLines={1}
                      style={[s.small, { color: a.danger ? colors.danger : colors.ink }]}
                    >
                      {a.label}
                    </Text>
                  </Pressable>
                </Animated.View>
              ))}
            </View>
          </SafeAreaView>
        </Animated.View>
      </View>
    </Modal>
  );
}
