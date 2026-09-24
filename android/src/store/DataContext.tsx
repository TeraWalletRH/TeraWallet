import React, { createContext, useContext, useRef, useState } from "react";
import type { Address } from "viem";
import { api } from "../api";
import { Asset, sources } from "../config";
import { balances } from "../network";
import * as tags from "../tags";
const tagsAvailable = () => tags.tagsAvailable();
import * as vault from "../storage";
import { useAuth } from "./AuthContext";
import { useUi } from "./UiContext";
import { useLanguage } from "./LanguageContext";

type DataContextValue = {
  data: vault.LocalData;
  setData: React.Dispatch<React.SetStateAction<vault.LocalData>>;
  // A ref mirror of `data`, kept in sync alongside every `setData` call. Reads
  // inside async callbacks (notably `signReview()`'s `execute()` callback in
  // App.tsx) close over `dataRef.current` instead of `data` specifically to
  // avoid acting on a stale snapshot from before the closure was created —
  // do not "simplify" this by reading `data` directly in those call sites.
  dataRef: React.MutableRefObject<vault.LocalData>;
  balance: Record<string, string> | null;
  setBalance: React.Dispatch<React.SetStateAction<Record<string, string> | null>>;
  prices: Record<string, number>;
  setPrices: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  assets: Asset[];
  setAssets: React.Dispatch<React.SetStateAction<Asset[]>>;
  refresh: (address?: Address | "") => Promise<void>;
  store: (next: vault.LocalData) => Promise<void>;
};

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const { owner, setMyTag } = useAuth();
  const { setError } = useUi();
  const { t } = useLanguage();
  const [data, setData] = useState(vault.emptyData());
  const dataRef = useRef(data);
  const [balance, setBalance] = useState<Record<string, string> | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({ USDG: 1 });
  const [assets, setAssets] = useState<Asset[]>(sources);

  async function store(next: vault.LocalData) {
    await vault.saveData(next);
    dataRef.current = next;
    setData(next);
  }

  async function refresh(address: Address | "" = owner) {
    if (!address) return;
    const version = vault.sessionVersion();
    const registryResult = await api("/api/assets").catch(() => ({ assets: [] }));
    const registry: Asset[] = registryResult.assets || [];
    const teraAsset: Asset = {
      symbol: "TERA",
      address: "0x3c12e57fa7817a86ce7c254db9ea5fe639e233f8",
      decimals: 18,
      name: "Tera",
    };
    const supported = [
      ...sources,
      teraAsset,
      ...registry.filter((a) => !sources.some((s) => s.symbol === a.symbol) && a.symbol !== "TERA"),
    ];
    const result = await Promise.allSettled([
      balances(address, supported),
      api("/api/assets/prices"),
    ]);
    if (version !== vault.sessionVersion()) return;
    if (result[0].status === "fulfilled") setBalance(result[0].value);
    else
      setError(
        t("Could not refresh balances. Pull again when connected.", "无法刷新余额，请联网后重试。"),
      );
    if (result[1].status === "fulfilled") setPrices(result[1].value.prices || { USDG: 1 });
    setAssets(supported);
    // Whether this wallet already has a name. Read from the registry, and a
    // failure leaves it unknown rather than answering "no" — an owner who
    // already holds a tag must not be asked to claim one over a dropped call.
    if (tagsAvailable())
      await tags
        .tagOf(address)
        .then((held) => {
          if (version === vault.sessionVersion()) setMyTag(held);
        })
        .catch(() => {});
  }

  return (
    <DataContext.Provider
      value={{ data, setData, dataRef, balance, setBalance, prices, setPrices, assets, setAssets, refresh, store }}
    >
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within a DataProvider");
  return ctx;
}
