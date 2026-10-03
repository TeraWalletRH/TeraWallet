// Build-time configuration.
//
// `REQUEST_INSTALL_PACKAGES` is what lets the app hand a downloaded APK to
// Android's installer, for the in-app self-update bubble (src/update.ts).
// Google Play's policy does not allow this permission unless installing
// packages is the app's core purpose, so it is requested for the preview
// channel only — preview is distributed as a direct APK download (GitHub
// Actions artifacts/releases), which is exactly the case the permission
// exists for. The production channel is distributed through Google Play,
// which has its own update mechanism, so production neither requests the
// permission nor offers the in-app updater (the App.tsx call site and the
// Settings "Updates" row are both gated on installedChannel() === "preview").
//
// A signed release is the production app and every other build is the preview
// app. Each has its own application ID, which is also how the app knows which
// channel's update to ask for (src/update.ts).
module.exports = ({ config }) => {
  const release = process.env.TERA_SIGNED_RELEASE === "true";
  return {
    ...config,
    name: release ? "Tera Wallet" : "Tera Preview",
    // The web build (scripts/build-web.mjs) is served from /app/ on the site,
    // and asks for its bundle and assets there.
    ...(process.env.TERA_WEB_BASE
      ? { experiments: { ...config.experiments, baseUrl: process.env.TERA_WEB_BASE } }
      : {}),
    web: { ...config.web, output: "single", bundler: "metro" },
    // Updates arrive as whole APKs, so the in-bundle updater stays off.
    updates: { enabled: false },
    android: {
      ...config.android,
      package: release ? "app.terawallet.android" : "app.terawallet.android.preview",
      versionCode: Number(process.env.GITHUB_RUN_NUMBER || 1),
      permissions: [
        ...(config.android.permissions ?? []),
        ...(release ? [] : ["android.permission.REQUEST_INSTALL_PACKAGES"]),
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
