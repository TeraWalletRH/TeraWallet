import React from "react";
import { LanguageProvider } from "./LanguageContext";
import { UiProvider } from "./UiContext";
import { AuthProvider } from "./AuthContext";
import { DataProvider } from "./DataContext";
import { ReviewProvider } from "./ReviewContext";

export { useLanguage } from "./LanguageContext";
export { useUi } from "./UiContext";
export { useAuth } from "./AuthContext";
export { useData } from "./DataContext";
export { useReview } from "./ReviewContext";
export type { Language } from "./LanguageContext";
export type { Notice } from "./UiContext";
export type { Account } from "./AuthContext";
export type { Review } from "./ReviewContext";

/**
 * Composes the app's shared cross-cutting state. Nesting order matters here:
 * - `UiProvider` reads `t()` from `LanguageProvider` (its `run()`'s fallback
 *   error message is translated).
 * - `DataProvider` reads `owner`/`setMyTag` from `AuthProvider`, `setError`
 *   from `UiProvider`, and `t()` from `LanguageProvider` (all used by
 *   `refresh()`).
 * - `ReviewProvider` depends on nothing else — it only holds state for this
 *   pass (see the comment in ReviewContext.tsx for why).
 */
export function WalletProvider({ children }: { children: React.ReactNode }) {
  return (
    <LanguageProvider>
      <UiProvider>
        <AuthProvider>
          <DataProvider>
            <ReviewProvider>{children}</ReviewProvider>
          </DataProvider>
        </AuthProvider>
      </UiProvider>
    </LanguageProvider>
  );
}
