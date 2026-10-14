// Reduce motion: whether the app's decorative movement is switched off. No
// UI of its own; android/src/motion.ts reads the device setting and the
// app's own toggle and every animation asks it.
//
// The rules, each one a test:
//
//   The device decides unless the owner chose in Tera: the system's "reduce
//   motion" (iOS, Android "remove animations", the browser's
//   prefers-reduced-motion) turns it on, and an explicit choice in Settings
//   wins either way. Choosing what the device already says goes back to
//   following the device, so a later change there still counts.
//
//   Reduced means decorative loops stand still (the drifting background,
//   the breathing logo, skeleton pulses, the voice blob) and dialogs and
//   sheets appear without sliding or fading. A loading spinner keeps
//   turning, slowly: it says work is happening, and a frozen one reads as
//   a hang. Press-and-hold progress is the owner's own input and stays.

/** Whether motion is reduced. setting: true / false from Settings, or undefined to follow the device. */
export function reduced(system, setting) {
  if (setting === true || setting === false) return setting;
  return !!system;
}

/** A Modal's animationType under the rule: "none" when reduced. */
export function modalAnimation(kind, isReduced) {
  return isReduced ? "none" : kind;
}

/** A transition's duration in ms: 0 when reduced. */
export function duration(ms, isReduced) {
  return isReduced ? 0 : ms;
}

/** How long one spinner turn takes: three times slower when reduced, never stopped. */
export function spinnerTurn(ms, isReduced) {
  return isReduced ? ms * 3 : ms;
}

/**
 * What tapping the Settings toggle stores: the opposite of what is in force,
 * or nothing (follow the device again) when that is what the device says.
 */
export function toggled(system, setting) {
  const next = !reduced(system, setting);
  return next === !!system ? undefined : next;
}

/** What Settings says about the choice. */
export function describe(system, setting) {
  if (setting === true) return "on";
  if (setting === false) return "off";
  return system ? "device-on" : "device-off";
}
