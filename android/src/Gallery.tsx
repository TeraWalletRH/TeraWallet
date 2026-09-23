import React, { useEffect, useState } from "react";
import { ActivityIndicator, Image, Text, TextInput, View } from "react-native";
import { nft } from "./core";
import { findTokens, type Token } from "./nfts";
import { Button, colors, styles as s } from "./ui";

export type Item = Token & { metadata: ReturnType<typeof nft.parseMetadata> };
export function Gallery({
  owner,
  t,
  onBack,
  onSend,
}: {
  owner: string;
  t: (en: string, zh: string) => string;
  onBack: () => void;
  onSend: (token: Item, recipient: string) => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [recipient, setRecipient] = useState("");
  useEffect(() => {
    let alive = true;
    void findTokens(owner)
      .then(async ({ tokens }) => {
        const result: Item[] = [];
        for (let i = 0; i < tokens.length; i += 4) {
          const batch = await Promise.all(
            tokens
              .slice(i, i + 4)
              .map(async (token) => ({ ...token, metadata: await nft.loadMetadata(token) })),
          );
          result.push(...batch);
          if (alive) setItems([...result]);
        }
      })
      .catch((e) => alive && setError(String(e?.message || e)))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [owner]);
  return (
    <>
      <View style={{ gap: 8 }}>
        <Text style={s.title}>{t("NFTs", "NFT ??")}</Text>
        <Text style={s.small}>
          {items.length} {t("items found", "???")}
        </Text>
        <Text style={s.small}>
          {t(
            "Metadata and pictures load directly from collection servers or the public IPFS gateway. Those hosts see your network address and the token requested.",
            "????????????????? IPFS ????????????????????????",
          )}
        </Text>
      </View>
      {busy && !items.length ? <ActivityIndicator color={colors.green} /> : null}
      {error ? <Text style={s.small}>{error}</Text> : null}
      {!busy && !items.length && !error ? (
        <View style={s.panel}>
          <Text style={s.small}>{t("No NFTs found for this wallet.", "?????? NFT?")}</Text>
        </View>
      ) : null}
      {items.map((token) => {
        const uri = nft.imageUrl(token.metadata?.image || "");
        const svg = /\.svg(?:$|[?#])|^data:image\/svg\+xml/i.test(uri);
        const label = nft.tokenLabel(token, token.metadata);
        return (
          <View key={token.contract + ":" + token.tokenId} style={s.panel}>
            {uri && !svg ? (
              <Image
                accessibilityLabel={label}
                source={{ uri }}
                resizeMode="contain"
                style={{
                  width: "100%",
                  aspectRatio: 1,
                  borderRadius: 14,
                  backgroundColor: colors.wash,
                }}
              />
            ) : (
              <View style={[s.panel, { alignItems: "center" }]}>
                <Text style={s.small}>{t("Picture shows on the web wallet.", "????????????")}</Text>
              </View>
            )}
            <Text style={s.eyebrow}>{token.collection || t("Unnamed collection", "?????")}</Text>
            <Text style={s.text}>{label}</Text>
            <Text numberOfLines={2} style={s.small}>
              {token.metadata?.description || ""}
            </Text>
            <TextInput
              accessibilityLabel={t("Recipient address", "????")}
              placeholder="0x�"
              autoCapitalize="none"
              value={recipient}
              onChangeText={setRecipient}
              style={s.input}
            />
            <Button primary onPress={() => onSend(token, recipient)}>
              {t("Send", "??")}
            </Button>
          </View>
        );
      })}
      <Button onPress={onBack}>{t("Back", "??")}</Button>
    </>
  );
}
