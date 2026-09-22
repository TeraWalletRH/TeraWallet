#!/usr/bin/env bash
# Refuse to publish an APK that could not update the app it is published for.
#
# Android installs an update only when the application ID and the signing
# certificate both match the installed app. A file that differs in either is
# refused by the installer or, worse, installed as a second app beside the
# first. So both are read out of the built file and compared, along with the
# version code the manifest will claim.
#
#   verify-apk.sh <apk> <application-id> <version-code> [certificate-sha256]
#
# The certificate is compared when given; its SHA-256 is printed either way.
set -euo pipefail

apk="$1"
expected_id="$2"
expected_code="$3"
expected_cert="${4:-}"

sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
test -n "$sdk" || { echo "ANDROID_HOME is not set." >&2; exit 1; }
tools="$sdk/build-tools/$(ls "$sdk/build-tools" | sort -V | tail -1)"

badging="$("$tools/aapt2" dump badging "$apk" | head -1)"
actual_id="$(sed -n "s/.*package: name='\([^']*\)'.*/\1/p" <<<"$badging")"
actual_code="$(sed -n "s/.*versionCode='\([^']*\)'.*/\1/p" <<<"$badging")"

if [ "$actual_id" != "$expected_id" ]; then
  echo "::error::$apk is $actual_id, expected $expected_id." >&2
  exit 1
fi
if [ "$actual_code" != "$expected_code" ]; then
  echo "::error::$apk has version code $actual_code, expected $expected_code." >&2
  exit 1
fi

echo "Using build-tools $(basename "$tools")"
signers="$("$tools/apksigner" verify --print-certs "$apk" | tr -d '\r')"
# The wording of these lines differs between build-tools versions ("Signer #1
# certificate …", "Signer (minSdkVersion=…) certificate …"), and one key can
# be listed once per signature scheme. So match any signer's certificate
# digest, leave out the source stamp (which is not the app's signing key), and
# count distinct certificates rather than lines.
certs="$(grep -iv 'stamp' <<<"$signers" \
  | sed -n 's/.*[Ss]igner.*certificate SHA-256 digest: *\([0-9A-Fa-f]\{64\}\).*/\1/p' \
  | tr 'A-F' 'a-f' | sort -u)"
if [ -z "$certs" ] || [ "$(wc -l <<<"$certs")" -ne 1 ]; then
  echo "::error::$apk must be signed by exactly one certificate. apksigner reported:" >&2
  echo "$signers" >&2
  exit 1
fi
echo "$expected_id $actual_code signed by certificate SHA-256 $certs"

if [ -n "$expected_cert" ]; then
  normalised="$(tr -d ': ' <<<"$expected_cert" | tr 'A-F' 'a-f')"
  if [ "$certs" != "$normalised" ]; then
    echo "::error::$apk is signed by $certs, but installed $expected_id apps are signed by $normalised." >&2
    exit 1
  fi
fi
