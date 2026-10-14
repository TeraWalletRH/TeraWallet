// Reduce motion (core/motion.js): the device's setting, read once and kept
// current, plus the owner's choice in Settings, which App.tsx passes in.
// Animations outside App's state (the spinner, sheets, skeletons) read it
// through useReducedMotion(); module-level so every one agrees at once.
import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { motion as rules } from "./core";

let system = false;
let choice: boolean | undefined;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

AccessibilityInfo.isReduceMotionEnabled?.()
  .then((on) => {
    system = !!on;
    notify();
  })
  .catch(() => {});
AccessibilityInfo.addEventListener?.("reduceMotionChanged", (on: boolean) => {
  system = !!on;
  notify();
});

/** Whether motion is reduced right now. */
export const isReduced = () => rules.reduced(system, choice);
/** Whether the device itself asks for reduced motion. */
export const deviceReduced = () => system;
/** The owner's choice from Settings: true, false, or undefined to follow the device. */
export function setMotionChoice(next: boolean | undefined) {
  if (next === choice) return;
  choice = next;
  notify();
}
/** Re-renders when either the device setting or the owner's choice changes. */
export function useReducedMotion(): boolean {
  const [value, setValue] = useState(isReduced);
  useEffect(() => {
    const update = () => setValue(isReduced());
    listeners.add(update);
    update();
    return () => {
      listeners.delete(update);
    };
  }, []);
  return value;
}
/** A Modal's animationType: "none" when motion is reduced. */
export const modalAnimation = <T extends "fade" | "slide">(kind: T, reduce: boolean) =>
  rules.modalAnimation(kind, reduce) as T | "none";
export const { duration, spinnerTurn } = rules;
