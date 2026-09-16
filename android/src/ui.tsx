import React from "react";
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
export const colors = {
  paper: "#f2f0ec",
  ink: "#243b2b",
  muted: "#778469",
  line: "#b8c0aa",
  wash: "#e6e9da",
  danger: "#9c522f",
};
export const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.paper },
  content: { padding: 24, paddingBottom: 40, gap: 20 },
  header: {
    paddingHorizontal: 24,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderColor: colors.line,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  eyebrow: {
    color: colors.muted,
    fontFamily: "monospace",
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  title: {
    fontSize: 38,
    color: colors.ink,
    lineHeight: 44,
    fontWeight: "500",
    letterSpacing: -1.4,
  },
  text: { color: colors.ink, fontSize: 16, lineHeight: 24 },
  small: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  mono: { fontFamily: "monospace", color: colors.ink, fontSize: 13, lineHeight: 21 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 17,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  panel: {
    padding: 20,
    backgroundColor: colors.wash,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.line,
  },
  button: {
    minHeight: 52,
    paddingVertical: 15,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { fontSize: 13, fontFamily: "monospace", color: colors.ink, textAlign: "center" },
  input: {
    padding: 15,
    minHeight: 54,
    borderWidth: 1,
    borderColor: colors.line,
    color: colors.ink,
    fontSize: 16,
    backgroundColor: "#faf9f5",
  },
  field: { gap: 9 },
  tabs: {
    flexDirection: "row",
    paddingVertical: 10,
    borderTopWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
  },
  tab: { flex: 1, alignItems: "center", paddingVertical: 12, gap: 5 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  quickActions: { flexDirection: "row", gap: 8 },
  quickAction: {
    flex: 1,
    minHeight: 54,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  error: {
    padding: 15,
    borderLeftWidth: 3,
    borderColor: colors.danger,
    backgroundColor: "#eee5da",
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
