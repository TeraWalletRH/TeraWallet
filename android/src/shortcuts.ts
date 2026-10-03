export interface AppShortcut {
  id: string;
  title: string;
  targetPage: "send" | "swap" | "scan" | "activity";
  icon: string;
}

export const APP_SHORTCUTS: AppShortcut[] = [
  { id: "send", title: "Send Crypto", targetPage: "send", icon: "arrow-up-right" },
  { id: "swap", title: "Swap Tokens", targetPage: "swap", icon: "repeat" },
  { id: "scan", title: "Scan QR", targetPage: "scan", icon: "qr-code" },
  { id: "activity", title: "Activity", targetPage: "activity", icon: "clock" },
];

export function resolveAppShortcut(shortcutId: string): string | null {
  const item = APP_SHORTCUTS.find((s) => s.id === shortcutId);
  return item ? item.targetPage : null;
}
