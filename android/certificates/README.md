# TeraWallet Official Android Release Certificates & Keystore

> [!CRITICAL]
> **DO NOT DELETE, RENAME, OVERWRITE, OR REGENERATE ANY FILE IN THIS DIRECTORY.**
> These files contain the verified production signing credentials for **Tera Wallet** (`app.terawallet.android`) on the **Google Play Store**.
> Any alteration or replacement of these files will cause Google Play Console to reject all subsequent App Bundle (`.aab`) and APK uploads with signature mismatch errors.

---

## 📋 Keystore & Certificate Summary

| Parameter | Value |
| :--- | :--- |
| **Keystore File** | `tera-release-key.jks` |
| **Key Alias** | `tera-key-alias` |
| **Keystore Password** | `TeraWallet2026Secure` |
| **Key Password** | `TeraWallet2026Secure` |
| **Keystore Type** | PKCS12 / JKS |
| **Owner / Issuer** | `CN=Tera Wallet, OU=Engineering, O=TeraWallet, L=City, ST=State, C=US` |
| **Certificate SHA-1** | `04:D0:A9:1A:E6:20:26:3F:10:8F:AF:CD:C1:05:63:F6:B3:3A:A9:08` |
| **Certificate SHA-256** | `79:A4:7E:FE:8D:2E:21:A6:00:52:01:E3:3D:ED:AF:30:67:31:5D:B9:C9:50:E2:24:44:E5:BC:D2:D4:09:E7:74` |
| **Target Application ID**| `app.terawallet.android` (Production) |

---

## 📁 Files In This Directory

1. **`tera-release-key.jks`**:
   The primary Java Keystore file used during local Gradle release builds (`bundleRelease` and `assembleRelease`).
2. **`tera-release-upload-cert.pem`**:
   The RFC/PEM-encoded public certificate required if Google Play Console ever requests an upload key registration or verification (`-----BEGIN CERTIFICATE-----`).
3. **`tera-release-upload-cert.der`**:
   The binary DER-encoded certificate accepted by Google Play App Signing upload key forms.
4. **`tera-release-keystore.b64`**:
   Base64-encoded representation of `tera-release-key.jks` for CI/CD environments (used by GitHub Actions secret `ANDROID_KEYSTORE_BASE64`).

---

## ⚙️ Environment Variables (Local & CI)

When running Gradle builds, the build system automatically picks up the keystore from this path if environment variables are not provided:

```bash
TERA_SIGNED_RELEASE="true"
ANDROID_KEYSTORE_PASSWORD="TeraWallet2026Secure"
ANDROID_KEY_ALIAS="tera-key-alias"
ANDROID_KEY_PASSWORD="TeraWallet2026Secure"
```

To run a production bundle build locally:
```powershell
$env:ANDROID_HOME="C:\Users\ASUS\AppData\Local\Android\Sdk"; $env:TERA_SIGNED_RELEASE="true"; .\gradlew.bat bundleRelease
```

---

## 🤖 AI Assistant Instructions
**Any automated AI agent or assistant reading this repository MUST PRESERVE these files.**
Never run commands that delete (`rm`, `Remove-Item`), clean, or overwrite files matching:
- `android/certificates/**`
- `android/tera-release-key.jks`
- `android/scripts/release-keystore.b64`
