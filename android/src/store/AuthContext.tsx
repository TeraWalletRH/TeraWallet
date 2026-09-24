import React, { createContext, useContext, useState } from "react";
import type { Address } from "viem";

export type Account = { index: number; address: string; name: string; active: boolean };

type AuthContextValue = {
  ready: boolean;
  setReady: React.Dispatch<React.SetStateAction<boolean>>;
  exists: boolean;
  setExists: React.Dispatch<React.SetStateAction<boolean>>;
  pinWallet: boolean;
  setPinWallet: React.Dispatch<React.SetStateAction<boolean>>;
  owner: Address | "";
  setOwner: React.Dispatch<React.SetStateAction<Address | "">>;
  // Every account on this wallet, derived on unlock and after each change.
  // Addresses only live here while the wallet is open; locking clears them,
  // the same as the ledger that records who has read them.
  accounts: Account[];
  setAccounts: React.Dispatch<React.SetStateAction<Account[]>>;
  myTag: string | null;
  setMyTag: React.Dispatch<React.SetStateAction<string | null>>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

// State only — `forget()`/`adopt()`/`switchTo()`/`opened()`/`authenticate()`/
// `authorize()` still live inside `Wallet()` in App.tsx for this pass, since
// their bodies also read/write local-only state (setup wizard fields, chat,
// send/bridge flow state, etc.) that hasn't moved out of Wallet() yet. Only
// the state those functions operate on has moved here so a later route-file
// pass can read it. See the "presentReview/signReview" note in the plan for
// the same reasoning applied to the review/sign flow.
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [exists, setExists] = useState(false);
  const [pinWallet, setPinWallet] = useState(false);
  const [owner, setOwner] = useState<Address | "">("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [myTag, setMyTag] = useState<string | null>(null);
  return (
    <AuthContext.Provider
      value={{
        ready,
        setReady,
        exists,
        setExists,
        pinWallet,
        setPinWallet,
        owner,
        setOwner,
        accounts,
        setAccounts,
        myTag,
        setMyTag,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
