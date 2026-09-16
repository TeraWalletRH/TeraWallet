module.exports = ({ config }) => {
  const release = process.env.TERA_SIGNED_RELEASE === "true";
  return {
    ...config,
    name: release ? "Tera Wallet" : "Tera Preview",
    android: {
      ...config.android,
      package: release ? "app.terawallet.android" : "app.terawallet.android.preview",
      versionCode: Number(process.env.GITHUB_RUN_NUMBER || 1),
      blockedPermissions: [
        ...config.android.blockedPermissions,
        "android.permission.SYSTEM_ALERT_WINDOW",
      ],
    },
  };
};
