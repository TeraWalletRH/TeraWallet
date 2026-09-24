import React from "react";
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
export const colors = {
  paper: "#f8f8f6",
  ink: "#17281f",
  muted: "#69776f",
  line: "#dde3dd",
  wash: "#edf2ec",
  green: "#2e6b4a",
  lime: "#b9eb85",
  dark: "#102219",
  danger: "#a84f36",
};
export const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.paper },
  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 36, gap: 18 },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  eyebrow: {
    color: colors.muted,
    fontFamily: "monospace",
    fontSize: 10,
    letterSpacing: 1.15,
    textTransform: "uppercase",
  },
  title: {
    fontSize: 32,
    color: colors.ink,
    lineHeight: 38,
    fontWeight: "700",
    letterSpacing: -1,
  },
  text: { color: colors.ink, fontSize: 15, lineHeight: 22 },
  small: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  mono: { fontFamily: "monospace", color: colors.ink, fontSize: 13, lineHeight: 21 },
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
    padding: 17,
    backgroundColor: colors.wash,
    gap: 10,
    borderRadius: 20,
  },
  button: {
    minHeight: 54,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { fontSize: 13, fontWeight: "700", color: colors.ink, textAlign: "center" },
  input: {
    padding: 15,
    minHeight: 54,
    borderWidth: 1,
    borderColor: colors.line,
    color: colors.ink,
    fontSize: 16,
    backgroundColor: "#ffffff",
    borderRadius: 16,
  },
  field: { gap: 9 },
  tabs: {
    flexDirection: "row",
    marginHorizontal: 12,
    marginBottom: 10,
    paddingVertical: 7,
    paddingHorizontal: 4,
    borderRadius: 24,
    backgroundColor: colors.dark,
    shadowColor: "#08130d",
    shadowOpacity: 0.13,
    shadowRadius: 14,
    elevation: 6,
  },
  tab: { flex: 1, alignItems: "center", paddingVertical: 8, gap: 3, borderRadius: 18 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  quickActions: { flexDirection: "row", gap: 10 },
  quickAction: {
    flex: 1,
    minHeight: 54,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  error: {
    padding: 15,
    borderRadius: 16,
    borderLeftWidth: 3,
    borderColor: colors.danger,
    backgroundColor: "#eee5da",
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
});
export function Button({
  children,
  onPress,
  primary = false,
  disabled = false,
}: {
  children: React.ReactNode;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        primary && { backgroundColor: colors.ink },
        { opacity: disabled ? 0.35 : pressed ? 0.65 : 1 },
      ]}
    >
      <Text style={[styles.buttonText, primary && { color: colors.paper }]}>{children}</Text>
    </Pressable>
  );
}
export function BackButton({
  onPress,
  accessibilityLabel,
}: {
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={10}
      style={({ pressed }) => [styles.backButton, { opacity: pressed ? 0.55 : 1 }]}
    >
      <MaterialCommunityIcons name="chevron-left" size={26} color={colors.ink} />
    </Pressable>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.eyebrow}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        autoCorrect={false}
        autoCapitalize="none"
        {...props}
        style={[
          styles.input,
          props.multiline && { minHeight: 110, textAlignVertical: "top" },
          props.style,
        ]}
      />
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
    <View style={styles.wrap}>
      {options.map((o) => (
        <Button key={o} primary={o === value} onPress={() => select(o)}>
          {o}
        </Button>
      ))}
    </View>
  );
}
