// config.ts reads EXPO_PUBLIC_* overrides from process.env; the extension
// build replaces process.env with {} so the defaults ship.
declare const process: { env: Record<string, string | undefined> };
