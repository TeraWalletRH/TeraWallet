export const APP_CONNECT: string[];
export const DASHBOARD_FRAMES: string[];
export function surfaceFor(pathname: string): "app" | "dashboard" | null;
export function inlineScripts(html: string): string[];
export function policyFor(
  surface: "app" | "dashboard",
  html: string,
  options?: { connect?: string[] },
): Promise<string>;
