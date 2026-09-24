import React, { createContext, useContext, useState } from "react";
import type { Tx } from "../config";

export type Review = {
  title: string;
  rows: [string, string][];
  steps: Tx[];
  verify: () => void;
  reference?: string;
  recipient?: string;
  actionHash?: string;
  bridgeInput?: any;
  draftId?: number;
  afterSubmitted?: (hash: string) => Promise<void>;
  simulation?: "checking" | "passed" | "needs-attention";
  isPrivateBridge?: boolean;
};

type AuthJob = null | { title: string; action: () => Promise<void> };

type ReviewContextValue = {
  review: Review | null;
  setReview: React.Dispatch<React.SetStateAction<Review | null>>;
  signing: boolean;
  setSigning: React.Dispatch<React.SetStateAction<boolean>>;
  auth: AuthJob;
  setAuth: React.Dispatch<React.SetStateAction<AuthJob>>;
  authPassword: string;
  setAuthPassword: React.Dispatch<React.SetStateAction<string>>;
};

const ReviewContext = createContext<ReviewContextValue | null>(null);

// State only — `presentReview()`/`signReview()`/`authenticate()`/`authorize()`
// still live inside `Wallet()` in App.tsx for this pass. They need `page`/
// `setPage` (local Wallet() state, not moved this pass — becomes
// `router.replace('/activity')` in a later step) plus setters from
// AuthContext/DataContext/UiContext/LanguageContext, which would make this
// provider depend on all four others just to host four functions. Exposing
// the state here is enough for a later route-file pass to *read* the current
// review/auth state; moving the functions themselves is deferred to that pass.
export function ReviewProvider({ children }: { children: React.ReactNode }) {
  const [review, setReview] = useState<Review | null>(null);
  const [signing, setSigning] = useState(false);
  const [auth, setAuth] = useState<AuthJob>(null);
  const [authPassword, setAuthPassword] = useState("");
  return (
    <ReviewContext.Provider
      value={{ review, setReview, signing, setSigning, auth, setAuth, authPassword, setAuthPassword }}
    >
      {children}
    </ReviewContext.Provider>
  );
}

export function useReview() {
  const ctx = useContext(ReviewContext);
  if (!ctx) throw new Error("useReview must be used within a ReviewProvider");
  return ctx;
}
