import React, { useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import * as tags from "../src/tags";
import * as vault from "../src/storage";
import { Button, colors, Field, styles as s } from "../src/ui";
import { useAuth, useLanguage, useUi } from "../src/store/WalletProvider";

// Sibling route to app/index.tsx (Wallet()), not nested under it — a real
// Stack.Screen so pushing here does not carry along Wallet()'s hand-rolled
// tab bar (that bar only lives inside index's own view tree). See
// /Users/macbook/.claude/plans/fizzy-conjuring-scroll.md for background; the
// live routing decision that supersedes that plan's nested-stack design is
// recorded in the task that produced this file.
export default function TagScreen() {
  const { t, language } = useLanguage();
  const { myTag, setMyTag } = useAuth();
  const { busy, run, setNotice } = useUi();
  const router = useRouter();
  const [claimInput, setClaimInput] = useState("");

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
    router.back();
  }

  return (
    <View style={s.page}>
      <Stack.Screen
        options={{
          title: t("Your tag.", "您的标签。"),
          headerBackButtonDisplayMode: "minimal",
          headerStyle: { backgroundColor: colors.paper },
          headerTintColor: colors.ink,
          headerTitleStyle: { color: colors.ink, fontWeight: "700" },
        }}
      />
      <SafeAreaView edges={["bottom"]} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          <Text style={s.small}>
            {myTag ? tags.display(myTag) : t("Not claimed yet", "尚未领取")}
          </Text>
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
          <Button primary disabled={busy} onPress={() => void run(claimTagNow)}>
            {busy ? (
              <ActivityIndicator color={colors.paper} />
            ) : (
              t("Claim this tag", "领取此标签")
            )}
          </Button>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
