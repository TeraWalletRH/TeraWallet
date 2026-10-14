// Plays core/haptics.js's patterns through expo-haptics, which vibrates on
// phones and, on the web, through navigator.vibrate where the browser has it.
import * as Haptics from "expo-haptics";
import { haptics as rules } from "./core";

let enabled = true;
let last: { event: string; at: number } | null = null;

/** Settings › Vibrations. */
export function setHapticsEnabled(on: boolean) {
  enabled = on;
}

const impacts: Record<string, Haptics.ImpactFeedbackStyle> = {
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  heavy: Haptics.ImpactFeedbackStyle.Heavy,
};
const notifications: Record<string, Haptics.NotificationFeedbackType> = {
  success: Haptics.NotificationFeedbackType.Success,
  warning: Haptics.NotificationFeedbackType.Warning,
  error: Haptics.NotificationFeedbackType.Error,
};

/** Feel an event: "tap", "confirm", "success", "error" or "lookalike". */
export function buzz(event: string | null | undefined) {
  if (!event) return;
  const now = Date.now();
  const steps = rules.plan(event, { enabled, now, last: last as any }) as { impact?: string; notification?: string; wait?: number }[];
  if (!steps.length) return;
  last = { event, at: now };
  void (async () => {
    for (const step of steps) {
      try {
        if (step.wait) await new Promise((resolve) => setTimeout(resolve, step.wait));
        else if (step.impact) await Haptics.impactAsync(impacts[step.impact]);
        else if (step.notification) await Haptics.notificationAsync(notifications[step.notification]);
      } catch {
        // No haptic engine (a desktop browser): the event is on screen anyway.
      }
    }
  })();
}
