// Tera Business is web-only for now. On the phone every export here is inert,
// so App.tsx can call them unconditionally and the native build is the app it
// was: no business vault, no email payments, no extra screens. The web build
// picks up business.web.tsx instead.

import type { Address } from "viem";

export type Mode = "personal" | "business";
export const available = false;
export const mode = (): Mode => "personal";
export function setMode(_next: Mode) {}

// Notes live in the wallet's own data here; there is no Reports screen to share them with.
export const sharesNotesWithReports = false;
export async function loadNotes(): Promise<Record<string, string>> {
  return {};
}
export async function saveNote(_hash: string, _text: string) {}

export const emailAvailable = () => false;
export async function loadEmailConfig() {
  return false;
}
export const isEmail = (_input: string) => false;
export async function linkedEmail(
  _address: Address,
): Promise<{ email: string; name: string } | null> {
  return null;
}
export async function resolveEmail(_input: string): Promise<{
  tag: string;
  address: Address;
  name: string;
}> {
  throw new Error("Email payments are not available here.");
}

export const teamsAvailable = () => false;
export async function loadTeamsConfig() {
  return false;
}

export function Splash(_props: { onDone: () => void }) {
  return null;
}
export function Screens(_props: Record<string, unknown>) {
  return null;
}
