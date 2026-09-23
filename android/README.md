# Tera for Android & iOS

Native Expo / React Native wallet, using Tera's cream, forest-green and monospace visual language. English and Simplified Chinese are available in the app. No WebView or external wallet is required. Android and iOS share this one source tree; the platform split only shows up in signing, distribution and the update mechanism (see [Updating](#updating) and [iOS](#ios)).

## Implemented

- Create a 12-word English BIP-39 phrase or import an existing valid English phrase; first Ethereum account at `m/44'/60'/0'/0/0`. No BIP-39 passphrase or additional accounts yet.
- Password-encrypted seed in SecureStore (Android Keystore on Android, Keychain on iOS), optional biometric unlock, background lock and two-minute idle lock. Recovery requires the seed phrase.
- Robinhood Chain ETH and USDG balances, transfers, locally reviewed USDG/equity swaps, assistant proposals and scoped service tokens.
- Relay bridges from RH ETH/USDG to Base ETH/USDC, Solana SOL/USDC/USDT and Arc USDC. Destination address is pasted; source transactions are signed on the phone.
- Encrypted local drafts, pending hashes and history, configurable retention, local deletion and signed backend proposal deletion. Assistant chat is memory-only.
- Tags: send to `@astra` instead of an address, and claim a name for this wallet. Tera keeps the register, so resolving a name means trusting the service — unlike a balance or a receipt, there is nothing else to check it against, and the claim screen says so. The resolved address is shown on the review sheet and re-read immediately before signing, and the transfer is built from the address. Tags are not offered as bridge destinations, because a bridge sends to another chain where that address is a different account.
- In-app updates on Android: on launch the app checks `/api/mobile/android/manifest?channel=…` for its own channel (preview or production) and offers what is published. See [Updating](#updating). Tags turn on when the API says the register is enabled. There is no equivalent on iOS — see below.

## Updating

1. The owner opens the app. On launch it asks `/api/mobile/android/manifest?channel=…` what the published build for its channel is.
2. If that build is newer, the home screen shows a bubble: a new version has been released, with its version name, notes and download size, and an **Update** button. If the installed build is below the channel's minimum supported version, the bubble says the update is required.
3. **Update** downloads the APK inside the app, with progress in the bubble, and hashes it. The hash must equal the `sha256` in the manifest that the build workflow published beside the APK. If it does not match, the app deletes the file and installs nothing.
4. The app hands the verified file to Android's installer. Android shows its own install screen, and the owner confirms there. The first time, Android also asks the owner to allow installs from Tera (`REQUEST_INSTALL_PACKAGES`). No app can skip either screen, and the bubble says so before the download starts. The wallet data stays, because the APK updates the same app.

A published build that is not newer than the installed one is never offered, so there is no downgrade. A build that cannot read its own version code is not offered anything.

This entire mechanism — the bubble, the channel manifest, the APK download and the cert-pinned install — is Android-only, and deliberately does not run on iOS at all. Apple does not allow an app to fetch and install its own executable code outside App Review, so there is no iOS equivalent to build here: `installedChannel()` (`src/update.ts`) only recognizes the two Android application IDs and returns `null` for anything else, and the check in `App.tsx` is separately gated to `Platform.OS === "android"` as well. An iOS build reaches users only through a new TestFlight/App Store submission — see [iOS](#ios).

### Channels

Preview and production are two different Android apps. Each has its own application ID, signing key, GitHub release and manifest. Neither can update into the other.

| | Preview | Production |
| --- | --- | --- |
| Application ID | `app.terawallet.android.preview` | `app.terawallet.android` |
| Signing key | Expo's development key from the prebuild template | Your release keystore (Actions secrets below) |
| Built by | Every push to `main` touching `android/` | Manual run with `signed_release=true` on `main` |
| GitHub release | `android-preview` (prerelease) | `android-production` |
| Assets | `tera-android-preview.apk`, `tera-android-preview.json` | `tera-android.apk`, `tera-android.json` |
| Manifest request | `/api/mobile/android/manifest?channel=preview` | `/api/mobile/android/manifest?channel=production` |
| Minimum supported version | `ANDROID_MIN_SUPPORTED_VERSION_CODE` | `ANDROID_PRODUCTION_MIN_SUPPORTED_VERSION_CODE` |

- The app takes its channel from its own installed application ID, not from a build setting. It refuses a manifest that names the other channel or the other application ID.
- The backend reads only the matching GitHub release and asset names. It refuses a manifest whose `channel` or `applicationId` does not match, and caches each channel separately. A request without `channel` gets preview, which is what the site's download link and older preview builds ask for. Any other value gets `400`.
- A manifest with no `channel` field is treated as preview. Production manifests must say `"channel": "production"`.

### Manifest

The workflow writes the manifest with `scripts/release-manifest.mjs`, in the same run that built the APK. It checks the manifest with the same `parseManifest` the app uses before it publishes it:

```json
{
  "platform": "android",
  "channel": "production",
  "applicationId": "app.terawallet.android",
  "versionCode": 57,
  "versionName": "0.1.0",
  "minSupportedVersionCode": 1,
  "sha256": "<SHA-256 of the APK built in this run>",
  "notes": "<release_notes input>",
  "publishedAt": "2026-09-22T00:00:00.000Z"
}
```

The version code is the workflow run number. The backend adds `downloadUrl` and `sizeBytes` from the release asset, so a manifest can never point the app at another file. The workflow uploads the APK before its manifest. Between the two uploads, the old digest does not match the new file, so the app refuses it.

### Signing keys

Android installs an update only when the application ID **and** the signing certificate match the installed app. The workflow reads both from each built APK with `scripts/verify-apk.sh` (`aapt2` and `apksigner`). If either is wrong, it stops before it publishes.

- Production: the certificate must equal the `ANDROID_RELEASE_CERT_SHA256` variable. A production run fails at the start if that variable is not set.
- Preview: the certificate is printed in the log. If you set `ANDROID_PREVIEW_CERT_SHA256`, the workflow also compares it.
- Keep the release keystore. If you lose it or change it, every installed production app refuses all later APKs. Owners must then uninstall and restore from their recovery phrase.

### Older installs

An installed app with no updater inside it cannot be told to update itself. Any build installed before the updater existed needs **one manual download** of its channel's APK. After that, updates come through the bubble.

Production builds made before channel support asked for the preview manifest. Update those by hand to a production APK from the `android-production` release.

### Setup the owner must do

1. **Production signing** (Settings → Secrets and variables → Actions → *Secrets*): `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` (see the table below).
2. **Production certificate** (*Variables*): set `ANDROID_RELEASE_CERT_SHA256` to the SHA-256 of your release signing certificate. Get it with `keytool -list -v -keystore tera-release.jks -alias <alias>` (the `SHA256:` line; colons are allowed). It is public and is not a secret.
3. **Floors** (optional *variables*): `ANDROID_MIN_SUPPORTED_VERSION_CODE` for preview and `ANDROID_PRODUCTION_MIN_SUPPORTED_VERSION_CODE` for production. With the default of `1`, the bubble never says an update is required.
4. **Backend**: deploy the backend so `/api/mobile/android/manifest` accepts `?channel=`. Until you deploy it, production apps get no answer, and preview works as before.
5. **First production release**: run the `Android wallet` workflow manually on `main` with `signed_release=true` and optional `release_notes`. That creates the `android-production` release.

## Public GitHub Actions builds

The `Android wallet` workflow runs only in **TeraWalletRH/TeraWallet**. Pushes affecting `android/` build an installable **Tera Preview** APK with bundled JavaScript (no Metro server). Download it from the workflow's artifact. Its application ID is `app.terawallet.android.preview` and it uses Expo's development signing key: use a disposable wallet for preview testing.

The build pins the owner-confirmed signer `0x5b2759f9620f54a5E1651A567Ebd8381F07f9f05`. To rotate it, set this public repository **Actions variable**, matching your backend signer, then rebuild:

| Variable | Value |
| --- | --- |
| `EXPO_PUBLIC_POLICY_SIGNER_PUBLIC_KEY` | Policy signer's Ethereum address, **never its private key** |

Invalid or mismatched signatures fail closed. Default public API and RPC URLs are in the workflow. No backend private keys, Relay key, Groq key or seed phrase belongs in the Android environment.

For a distribution build, add these **Actions secrets**, set `ANDROID_RELEASE_CERT_SHA256` (see [Signing keys](#signing-keys)), and manually run the workflow on `main` with `signed_release=true`:

| Secret | Purpose |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Base64-encoded release keystore |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Release signing alias |
| `ANDROID_KEY_PASSWORD` | Alias password |

The release produces an APK and AAB for `app.terawallet.android`; the workflow run number sets the version code. The APK and its manifest are published to the `android-production` GitHub release. The AAB is kept only as a workflow artifact. Preserve the signing keystore for future updates. Preview and production installs have separate storage; preview does not upgrade into production. This workflow does not publish to Google Play.

## iOS

Same source, built and signed through [EAS](https://expo.dev/eas) instead of a local keystore — there is no `ios/` directory in the repo; it, like `android/`, is regenerated on demand by `expo prebuild` (Expo calls this Continuous Native Generation) and is gitignored.

**Apple side, one-time setup**, done in the Apple Developer Portal / App Store Connect, not from this repo:

1. An **organization** Apple Developer Program membership. Apple's guideline 3.1.5(b)(i) requires apps that facilitate cryptocurrency transactions to be submitted under an organization account, not an individual one — an individual-account submission will be rejected.
2. Register the bundle identifiers `app.terawallet.ios` (production) and `app.terawallet.ios.preview` (internal/preview) and create the corresponding App Store Connect app record(s).
3. Generate an **App Store Connect API key** (Users and Access → Integrations → App Store Connect API) for non-interactive `eas submit`. Note its Key ID, Issuer ID, and download the `.p8` file once — Apple only lets you download it once.
4. A privacy policy URL for the App Store listing (required for any app handling financial/wallet data) and App Store screenshots — neither is produced by this repo.

**Expo/EAS side, one-time setup:**

```sh
cd android
bunx eas-cli login          # or set EXPO_TOKEN for CI
bunx eas-cli init           # links this project to an EAS project id — already done (see extra.eas.projectId in app.json)
bunx eas-cli credentials    # let EAS generate/manage the iOS distribution cert + provisioning profile
```

`eas credentials` needs a human at the keyboard — signing setup means logging into the Apple Developer account interactively (Apple ID, password, 2FA), which a robot access token cannot do, so this step cannot run in CI. When it asks which profile, choose **production**: that's App Store/TestFlight-type signing, and it's the only profile with credentials set up. **preview** uses ad hoc distribution, which additionally needs every test device's UDID registered in Apple's portal before EAS can build for it — skipped for now since the App Store is the actual target, not on-device preview builds.

`eas.json`'s `submit.production.ios.appleTeamId` and `ascAppId` are already filled in with the values from App Store Connect.

**CI** (`.github/workflows/ios.yml`) builds via EAS on every push touching `android/**`, the same trigger the Android workflow uses, defaults to the `production` profile (the only one with credentials), and needs one repository secret to authenticate the CLI:

| Secret | Purpose |
| --- | --- |
| `EXPO_TOKEN` | Authenticates `eas-cli` to the terawallet Expo/EAS account |

Submission to App Store Connect is not automatic — it only runs from a manual `workflow_dispatch` with `submit=true` on the `production` profile, and needs three more secrets:

| Secret | Purpose |
| --- | --- |
| `EXPO_ASC_API_KEY_ID` | App Store Connect API key ID |
| `EXPO_ASC_API_ISSUER_ID` | App Store Connect API issuer ID |
| `ASC_API_KEY_P8_BASE64` | The `.p8` key file, base64-encoded |

**Local build**, on a Mac with Xcode:

```sh
cd android
cp .env.example .env
bun install
bunx eas-cli build --platform ios --profile production   # cloud build, no local signing needed
# or, to build locally instead of on EAS's infrastructure:
bun run prebuild:ios
cd ios && pod install && cd ..
```

`production` is both what a device acceptance build is made from and what `submit:ios` uploads to App Store Connect — the same signed build goes to TestFlight first, then to the App Store once it passes review. `preview` stays available in `eas.json` if ad hoc device-registered builds are ever wanted later, but has no credentials set up and will fail until `eas credentials` is run for it.

## Local development

Requires Node 22, Bun, Java 17 and Android SDK for native Android builds. A local iOS build additionally needs a Mac with Xcode and CocoaPods; see [iOS](#ios) for the EAS-based alternative that needs neither.

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

Copy the public signer address into `.env` before building. A local build is the preview app unless `TERA_SIGNED_RELEASE=true`. The generated native project is ignored and recreated with Expo prebuild. Changes belong in app config, source or plugins.

## Signing and privacy boundaries

Every send requires password or biometric confirmation. The client rebuilds transfer and swap calldata, checks chain 4663, exact amounts, recipients and bounded approvals, verifies quote expiry, then simulates before signing. Maximum transaction gas cost is capped at **0.001 ETH per step**; actual network fees vary. Each approval in a multi-step swap/bridge is its own transaction and may succeed even if a later step fails. A signed hash is saved before broadcasting; uncertain submissions must be checked in Activity, never blindly retried.

Bridge validation binds the source deposit to the reviewed Relay quote metadata; destination delivery still depends on Relay. V4 pools with nonzero hooks are rejected in this version. Liquidity and backend availability determine executable routes. A service session token permits proposal preparation, not spending authority.

SecureStore protects the encrypted seed at rest. The mnemonic and derived signing key necessarily exist in JavaScript memory while unlocked; this is not hardware-isolated transaction signing and has not been independently audited. Screen capture is allowed for demos. Android backup is disabled (`allowBackup: false`); on iOS the wallet secret is written with `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (`src/storage.ts`), which keeps it out of iCloud Keychain sync and out of encrypted device backups the same way — both platforms end up with the same guarantee, that recovery material never leaves the device except by explicit seed-phrase export. App uninstall/erase removes local recovery material; chain transactions cannot be deleted. The RPC sees requests and broadcasts, and assistant/Relay requests disclose their required input to those services.

## Device acceptance checks

Use a disposable phrase and small amounts. Automated tests do not replace physical-device checks.

1. Create a wallet, verify word backup, lock/unlock, restart and restore the same address by importing its phrase.
2. Try a wrong password, cancel biometrics, change biometric enrollment, background during setup/unlock/signing and verify locking.
3. Verify balances, review a transfer's complete recipient/amount and confirm password authorization. Check the receipt after restarting the app.
4. Review BUY/SELL quotes and reject an expired quote. Confirm every approval is bounded, and interrupted steps never resend automatically.
5. Bridge a small supported amount; verify source confirmation separately from Relay delivery.
6. Test English/Chinese, larger system fonts, keyboard layout, retained drafts, data deletion and wallet erasure/recovery.

Production distribution requires device acceptance and a review of custody/signing code in addition to a successful build.

## NFTs

The NFT gallery finds ERC-721 and ERC-1155 tokens from Robinhood Chain and sends them through the app's transaction review. Metadata and pictures load directly from third-party collection servers and the public Pinata IPFS gateway. These hosts see your network address and the requested token; some pictures may fail to load.
