// Build-time configuration.
//
// `REQUEST_INSTALL_PACKAGES` is what lets the app hand a downloaded APK to
// Android's installer. It is a sensitive permission and is only worth asking
// for because this app is distributed as an APK rather than through Play.
// Android still shows its own install screen, and still asks the owner once to
// allow installs from this app; the permission does not skip either.
//
// A signed release is the production app and every other build is the preview
// app. Each has its own application ID, which is also how the app knows which
// channel's update to ask for (src/update.ts).
module.exports = ({ config }) => {
  const release = process.env.TERA_SIGNED_RELEASE === "true";
  return {
    ...config,
    name: release ? "Tera Wallet" : "Tera Preview",
    // Updates arrive as whole APKs, so the in-bundle updater stays off.
    updates: { enabled: false },
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
    // No REQUEST_INSTALL_PACKAGES equivalent here: iOS has no sideloaded-APK
    // update path (see src/update.ts), so there is nothing preview-only to
    // permission-gate. Preview and release just get distinct bundle IDs, the
    // same way they get distinct Android package names, so both can be
    // installed on one device and TestFlight/App Store submissions never
    // collide with an ad-hoc preview build.
    ios: {
      ...config.ios,
      bundleIdentifier: release ? "app.terawallet.ios" : "app.terawallet.ios.preview",
      buildNumber: String(process.env.GITHUB_RUN_NUMBER || 1),
    },
  };
};
