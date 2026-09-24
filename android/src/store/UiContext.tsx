import React, { createContext, useContext, useRef, useState } from "react";
import { AppState } from "react-native";
import * as vault from "../storage";
import { useLanguage } from "./LanguageContext";

export type Notice = null | {
  title: string;
  body: string;
  tone?: "success" | "error";
};

type UiContextValue = {
  busy: boolean;
  setBusy: React.Dispatch<React.SetStateAction<boolean>>;
  error: string;
  setError: React.Dispatch<React.SetStateAction<string>>;
  progress: string;
  setProgress: React.Dispatch<React.SetStateAction<string>>;
  notice: Notice;
  setNotice: React.Dispatch<React.SetStateAction<Notice>>;
  /** Wraps async work with `pending`/`busy` guarding. */
  run: (work: (guard: () => void) => Promise<void>) => Promise<void>;
  // Exposed so Wallet()'s background-lock/idle-timeout effect (still local to
  // App.tsx) can read/write the same refs `run()` uses — both refs belong
  // conceptually with the busy/session guarding `run()` implements.
  pending: React.MutableRefObject<boolean>;
  inactivity: React.MutableRefObject<number>;
};

const UiContext = createContext<UiContextValue | null>(null);

export function UiProvider({ children }: { children: React.ReactNode }) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const pending = useRef(false);
  const inactivity = useRef(Date.now());

  async function run(work: (guard: () => void) => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    inactivity.current = Date.now();
    setBusy(true);
    setError("");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const version = vault.sessionVersion();
    const guard = () => {
      if (AppState.currentState !== "active" || version !== vault.sessionVersion())
        throw new Error("Session locked. / 会话已锁定。");
    };
    try {
      await work(guard);
    } catch (e) {
      if (version === vault.sessionVersion()) {
        const body = e instanceof Error ? e.message : t("Action failed.", "操作失败。");
        setError(body);
      }
    } finally {
      pending.current = false;
      setBusy(false);
      setProgress("");
    }
  }

  return (
    <UiContext.Provider
      value={{
        busy,
        setBusy,
        error,
        setError,
        progress,
        setProgress,
        notice,
        setNotice,
        run,
        pending,
        inactivity,
      }}
    >
      {children}
    </UiContext.Provider>
  );
}

export function useUi() {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error("useUi must be used within a UiProvider");
  return ctx;
}
