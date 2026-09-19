// Build-time configuration.
//
// Two things here are deliberately conditional rather than always on:
//
//   `REQUEST_INSTALL_PACKAGES` is what lets the app hand a downloaded APK to
//   Android's installer. It is a sensitive permission and is only worth asking
//   for because this app is distributed as an APK rather than through Play.
//   Android still shows its own install screen, and still asks the owner once
//   to allow installs from this app; the permission does not skip either.
//
//   JavaScript updates are off unless a channel URL is configured. An
//   `expo-updates` build with nowhere to check would ship an update button
//   that cannot work, so the absence of the variable is what keeps the button
//   hidden — see `javascriptUpdatesEnabled` in src/update.ts.
module.exports = ({ config }) => {
  const release = process.env.TERA_SIGNED_RELEASE === "true";
  const updatesUrl = process.env.EXPO_PUBLIC_UPDATES_URL || "";
  return {
    ...config,
    name: release ? "Tera Wallet" : "Tera Preview",
    // The runtime version is what an update is matched against. Tied to the
    // app version so a JavaScript update can never land on a build whose
    // native side it was not compiled for.
    runtimeVersion: { policy: "appVersion" },
    updates: updatesUrl
      ? { enabled: true, url: updatesUrl, checkAutomatically: "ON_LOAD", fallbackToCacheTimeout: 0 }
      : { enabled: false },
    plugins: updatesUrl ? [...(config.plugins ?? []), "expo-updates"] : config.plugins,
    android: {
      ...config.android,
      package: release ? "app.terawallet.android" : "app.terawallet.android.preview",
      versionCode: Number(process.env.GITHUB_RUN_NUMBER || 1),
      permissions: [
        ...(config.android.permissions ?? []),
        "android.permission.REQUEST_INSTALL_PACKAGES",
      ],
      blockedPermissions: [
        ...config.android.blockedPermissions,
        "android.permission.SYSTEM_ALERT_WINDOW",
      ],
    },
  };
};
