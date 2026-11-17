// background.ts: each wallet now keeps its own added-token list, the same
// way its signatures and sent transactions already do. A minimal chrome
// mock is installed before import since background.ts registers real
// chrome.* listeners at module load.
import { afterEach, beforeAll, describe, expect, it } from "bun:test";

function installChromeMock() {
  const store = new Map<string, unknown>();
  (globalThis as any).chrome = {
    runtime: {
      onConnect: { addListener: () => {} },
      onMessage: { addListener: () => {} },
      onMessageExternal: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
      id: "test-extension-id",
    },
    windows: { onRemoved: { addListener: () => {} } },
    alarms: { onAlarm: { addListener: () => {} } },
    idle: { onStateChanged: { addListener: () => {} } },
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store.get(key) }),
        set: async (values: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(values)) store.set(k, v);
        },
      },
      session: {
        setAccessLevel: async () => {},
        get: async (key: string) => ({ [key]: store.get(`session:${key}`) }),
        set: async (values: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(values)) store.set(`session:${k}`, v);
        },
      },
    },
  };
  return store;
}

describe("added tokens are scoped per wallet", () => {
  let store: Map<string, unknown>;
  let addedTokensFor: typeof import("../src/background").addedTokensFor;
  let setAddedTokensFor: typeof import("../src/background").setAddedTokensFor;

  beforeAll(async () => {
    store = installChromeMock();
    const mod = await import("../src/background");
    addedTokensFor = mod.addedTokensFor;
    setAddedTokensFor = mod.setAddedTokensFor;
  });
  afterEach(() => store.clear());

  const A = "0xAbC0000000000000000000000000000000000001";
  const B = "0xDeF0000000000000000000000000000000000002";
  const token = { address: "0x1111111111111111111111111111111111111111", symbol: "FOO", name: "Foo", decimals: 18 };

  it("a token added for one wallet is invisible to another", async () => {
    expect(await addedTokensFor(A)).toEqual([]);
    expect(await addedTokensFor(B)).toEqual([]);

    await setAddedTokensFor(A, [token]);

    expect(await addedTokensFor(A)).toEqual([token]);
    // The exact bug this fixes: wallet B must not see wallet A's token.
    expect(await addedTokensFor(B)).toEqual([]);
  });

  it("removing a token for one wallet doesn't touch another's list", async () => {
    await setAddedTokensFor(A, [token]);
    await setAddedTokensFor(B, [token]);

    await setAddedTokensFor(A, []);

    expect(await addedTokensFor(A)).toEqual([]);
    expect(await addedTokensFor(B)).toEqual([token]);
  });

  it("no address means no added tokens, not everyone's", async () => {
    await setAddedTokensFor(A, [token]);
    expect(await addedTokensFor(undefined)).toEqual([]);
  });
});
