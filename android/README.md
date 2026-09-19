# Tera for Android

Native Expo / React Native wallet, using Tera's cream, forest-green and monospace visual language. English and Simplified Chinese are available in the app. No WebView or external wallet is required.

## Implemented

- Create a 12-word English BIP-39 phrase or import an existing valid English phrase; first Ethereum account at `m/44'/60'/0'/0/0`. No BIP-39 passphrase or additional accounts yet.
- Password-encrypted seed in Android Keystore-backed SecureStore, optional biometric unlock, background lock and two-minute idle lock. Recovery requires the seed phrase.
- Robinhood Chain ETH and USDG balances, transfers, locally reviewed USDG/equity swaps, assistant proposals and scoped service tokens.
- Relay bridges from RH ETH/USDG to Base ETH/USDC, Solana SOL/USDC/USDT and Arc USDC. Destination address is pasted; source transactions are signed on the phone.
- Encrypted local drafts, pending hashes and history, configurable retention, local deletion and signed backend proposal deletion. Assistant chat is memory-only.
- Tags: send to `@astra` instead of an address, and claim a name for this wallet. The tag is resolved against `TagRegistry` on chain — by the app, not by the API — and the resolved address is shown on the review sheet and re-read immediately before signing. Tags are not offered as bridge destinations, because a bridge sends to another chain where that address is a different account.
- In-app updates: the app checks `/api/mobile/android/manifest` on launch and offers what is published. Set `EXPO_PUBLIC_TAG_REGISTRY_ADDRESS` and `EXPO_PUBLIC_UPDATES_URL` to turn either on; unset, the controls stay hidden.

## Updating

Two mechanisms, and they are not interchangeable.

**JavaScript updates** (`expo-updates`) replace the bundle inside the installed app: seconds, no browser, no install screen, no permission. They carry everything written in JavaScript, which is most of this wallet, and nothing written in native code. Off unless `EXPO_PUBLIC_UPDATES_URL` points at an update channel.

**A new APK** carries the rest. The app downloads it, hashes it in chunks, and compares it against the `sha256` the build workflow published in `tera-android-preview.json` beside the APK. A mismatch deletes the file and installs nothing. Android then shows its own install screen, which no app can skip, and asks once for permission to install unknown apps (`REQUEST_INSTALL_PACKAGES`).

Neither reaches a build that shipped before this code existed: an installed app with no updater inside it cannot be told to update itself. Those installs need one manual download, and everything after that is in-app.

The APK signature must match the installed one or Android refuses the update, so self-update works within one signing key and one application ID. Preview and production still do not upgrade into each other.

`ANDROID_MIN_SUPPORTED_VERSION_CODE` (a repository variable) is the floor below which a build is told it is unsupported rather than merely out of date. Left at `1`, every published build is a suggestion.

## Public GitHub Actions builds

The `Android wallet` workflow runs only in **TeraWalletRH/TeraWallet**. Pushes affecting `android/` build an installable **Tera Preview** APK with bundled JavaScript (no Metro server). Download it from the workflow's artifact. Its application ID is `app.terawallet.android.preview` and it uses Expo's development signing key: use a disposable wallet for preview testing.

The build pins the owner-confirmed signer `0x5b2759f9620f54a5E1651A567Ebd8381F07f9f05`. To rotate it, set this public repository **Actions variable**, matching your backend signer, then rebuild:

| Variable | Value |
| --- | --- |
| `EXPO_PUBLIC_POLICY_SIGNER_PUBLIC_KEY` | Policy signer's Ethereum address, **never its private key** |

Invalid or mismatched signatures fail closed. Default public API and RPC URLs are in the workflow. No backend private keys, Relay key, Groq key or seed phrase belongs in the Android environment.

For a distribution build, add these **Actions secrets** and manually run the workflow with `signed_release=true`:

| Secret | Purpose |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Base64-encoded release keystore |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Release signing alias |
| `ANDROID_KEY_PASSWORD` | Alias password |

The release produces an APK and AAB for `app.terawallet.android`; the workflow run number sets the version code. Preserve the signing keystore for future updates. Preview and production installs have separate storage; preview does not upgrade into production. This workflow does not publish to Google Play.

## Local development

Requires Node 22, Bun, Java 17 and Android SDK for native builds.

```sh
cd android
cp .env.example .env
bun install --frozen-lockfile
bun run check
bun test tests
bun run export
bun run prebuild
cd android
./gradlew assembleRelease
```

Copy the public signer address into `.env` before building. The generated native project is ignored and recreated with Expo prebuild. Changes belong in app config, source or plugins.

## Signing and privacy boundaries

Every send requires password or biometric confirmation. The client rebuilds transfer and swap calldata, checks chain 4663, exact amounts, recipients and bounded approvals, verifies quote expiry, then simulates before signing. Maximum transaction gas cost is capped at **0.001 ETH per step**; actual network fees vary. Each approval in a multi-step swap/bridge is its own transaction and may succeed even if a later step fails. A signed hash is saved before broadcasting; uncertain submissions must be checked in Activity, never blindly retried.

Bridge validation binds the source deposit to the reviewed Relay quote metadata; destination delivery still depends on Relay. V4 pools with nonzero hooks are rejected in this version. Liquidity and backend availability determine executable routes. A service session token permits proposal preparation, not spending authority.

SecureStore protects the encrypted seed at rest. The mnemonic and derived signing key necessarily exist in JavaScript memory while unlocked; this is not hardware-isolated transaction signing and has not been independently audited. Screen capture is allowed for demos. Android backup is disabled. App uninstall/erase removes local recovery material; chain transactions cannot be deleted. The RPC sees requests and broadcasts, and assistant/Relay requests disclose their required input to those services.

## Device acceptance checks

Use a disposable phrase and small amounts. Automated tests do not replace physical-device checks.

1. Create a wallet, verify word backup, lock/unlock, restart and restore the same address by importing its phrase.
2. Try a wrong password, cancel biometrics, change biometric enrollment, background during setup/unlock/signing and verify locking.
3. Verify balances, review a transfer's complete recipient/amount and confirm password authorization. Check the receipt after restarting the app.
4. Review BUY/SELL quotes and reject an expired quote. Confirm every approval is bounded, and interrupted steps never resend automatically.
5. Bridge a small supported amount; verify source confirmation separately from Relay delivery.
6. Test English/Chinese, larger system fonts, keyboard layout, retained drafts, data deletion and wallet erasure/recovery.

Production distribution requires device acceptance and a review of custody/signing code in addition to a successful build.
