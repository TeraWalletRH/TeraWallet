import { client } from "./network";
import { nft } from "./core";

export type Token = {
  standard: string;
  contract: string;
  tokenId: string;
  collection: string;
  uri: string | null;
};

export function findTokens(owner: string): Promise<{ tokens: Token[]; notShown: number }> {
  return nft.discover({
    rpc: ({ method, params }: { method: string; params: unknown[] }) =>
      client.request({ method, params } as never),
    owner,
  });
}
