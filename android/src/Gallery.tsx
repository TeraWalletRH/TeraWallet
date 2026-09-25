import React, { useEffect, useState } from "react";
import { Image, Pressable, View } from "react-native";
import { nft } from "./core";
import { findTokens, type Token } from "./nfts";
import { Button, colors, Header, styles as s, TeraSpinner, Text, TextInput } from "./ui";

export type Item = Token & { metadata: ReturnType<typeof nft.parseMetadata> };
const keyOf = (token: Token) => token.contract + ":" + token.tokenId;
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
  // One token open at a time, with its own recipient. A single box shared by
  // every card let an address typed under one NFT follow the owner to the next.
  const [open, setOpen] = useState("");
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
  const selected = items.find((token) => keyOf(token) === open);
  return (
    <>
      <Header title={t("NFTs", "NFT 收藏")} onBack={onBack} backLabel={t("Back", "返回")} />
      <Text style={[s.small, { textAlign: "center" }]}>
        {items.length} {t("items found", "件藏品")}
      </Text>
      {busy && !items.length ? <TeraSpinner size={26} /> : null}
      {error ? <Text style={[s.small, { color: colors.danger }]}>{error}</Text> : null}
      {!busy && !items.length && !error ? (
        <View style={[s.panel, { alignItems: "center", paddingVertical: 28 }]}>
          <Text style={s.small}>
            {t("No NFTs found for this wallet.", "此钱包中没有找到 NFT。")}
          </Text>
        </View>
      ) : null}
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          justifyContent: "space-between",
          rowGap: 12,
        }}
      >
        {items.map((token) => {
          const uri = nft.imageUrl(token.metadata?.image || "");
          const svg = /\.svg(?:$|[?#])|^data:image\/svg\+xml/i.test(uri);
          const label = nft.tokenLabel(token, token.metadata);
          const isOpen = keyOf(token) === open;
          return (
            <Pressable
              key={keyOf(token)}
              accessibilityRole="button"
              accessibilityState={{ selected: isOpen }}
              accessibilityLabel={label}
              onPress={() => {
                setOpen(isOpen ? "" : keyOf(token));
                setRecipient("");
              }}
              style={[
                s.panel,
                {
                  width: "48%",
                  padding: 8,
                  gap: 8,
                  borderWidth: 2,
                  borderColor: isOpen ? colors.green : "transparent",
                },
              ]}
            >
              {uri && !svg ? (
                <Image
                  source={{ uri }}
                  resizeMode="cover"
                  style={{
                    width: "100%",
                    aspectRatio: 1,
                    borderRadius: 12,
                    backgroundColor: colors.raised,
                  }}
                />
              ) : (
                <View
                  style={{
                    width: "100%",
                    aspectRatio: 1,
                    borderRadius: 12,
                    backgroundColor: colors.raised,
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 8,
                  }}
                >
                  <Text style={[s.small, { textAlign: "center" }]}>
                    {t("Picture shows on the web wallet.", "图片可在网页版钱包中查看。")}
                  </Text>
                </View>
              )}
              <View style={{ paddingHorizontal: 4, paddingBottom: 4 }}>
                <Text style={s.label} numberOfLines={1}>
                  {label}
                </Text>
                <Text style={s.small} numberOfLines={1}>
                  {token.collection || t("Unnamed collection", "未命名合集")}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      {selected ? (
        <View style={[s.panel, { gap: 14 }]}>
          <Text style={[s.text, { fontWeight: "700" }]}>
            {t("Send", "发送")} {nft.tokenLabel(selected, selected.metadata)}
          </Text>
          {selected.metadata?.description ? (
            <Text numberOfLines={3} style={s.small}>
              {selected.metadata.description}
            </Text>
          ) : null}
          <TextInput
            accessibilityLabel={t("Recipient address", "收款地址")}
            placeholder="0x…"
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            autoCorrect={false}
            value={recipient}
            onChangeText={setRecipient}
            style={s.input}
          />
          <Button primary onPress={() => onSend(selected, recipient)}>
            {t("Review send", "审核发送")}
          </Button>
        </View>
      ) : null}
      <Text style={s.small}>
        {t(
          "Metadata and pictures load directly from collection servers or the public IPFS gateway. Those hosts see your network address and the token requested.",
          "元数据和图片直接从合集服务器或公共 IPFS 网关加载，这些主机可以看到你的网络地址和所请求的代币。",
        )}
      </Text>
    </>
  );
}
