import React from "react";
import { ActivityIndicator, Image, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { Button, colors, styles as s } from "../src/ui";
import { useAuth, useLanguage, useUi } from "../src/store/WalletProvider";

// Sibling route to app/index.tsx (Wallet()), not nested under it — a real
// Stack.Screen so pushing here does not carry along Wallet()'s hand-rolled
// tab bar (that bar only lives inside index's own view tree). See
// /Users/macbook/.claude/plans/fizzy-conjuring-scroll.md for background; the
// live routing decision that supersedes that plan's nested-stack design is
// recorded in the task that produced this file.
export default function ReceiveScreen() {
  const { t } = useLanguage();
  const { owner } = useAuth();
  const { busy, run, setNotice } = useUi();

  return (
    <View style={s.page}>
      <Stack.Screen
        options={{
          title: t("Receive.", "收款。"),
          headerBackButtonDisplayMode: "minimal",
          headerStyle: { backgroundColor: colors.paper },
          headerTintColor: colors.ink,
          headerTitleStyle: { color: colors.ink, fontWeight: "700" },
        }}
      />
      <SafeAreaView edges={["bottom"]} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          <Text style={s.small}>
            {t(
              "Send assets on Robinhood Chain to this address.",
              "请通过 Robinhood Chain 向此地址发送资产。",
            )}
          </Text>
          <Text selectable style={[s.mono, { fontSize: 18, lineHeight: 30 }]}>
            {owner}
          </Text>
          <View
            style={{
              alignSelf: "center",
              backgroundColor: "#ffffff",
              padding: 16,
              borderRadius: 22,
              borderWidth: 1,
              borderColor: colors.line,
            }}
          >
            <Image
              accessibilityLabel={t("Wallet address QR code", "钱包地址二维码")}
              source={{
                uri: `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(owner)}`,
              }}
              style={{ width: 220, height: 220 }}
            />
          </View>
          <Button
            primary
            disabled={busy}
            onPress={() =>
              void run(async () => {
                await Clipboard.setStringAsync(owner);
                setNotice({
                  title: t("Address copied", "地址已复制"),
                  body: t(
                    "Your Robinhood Chain wallet address is ready to paste.",
                    "你的 Robinhood Chain 钱包地址已可粘贴。",
                  ),
                  tone: "success",
                });
              })
            }
          >
            {busy ? (
              <ActivityIndicator color={colors.paper} />
            ) : (
              t("Copy address", "复制地址")
            )}
          </Button>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
