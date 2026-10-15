# Tera Wallet for Chrome

The Tera wallet as a browser extension: sites on Robinhood Chain can find it
(`window.ethereum` and EIP-6963) and ask to connect, and the owner decides.

**This version (0.2) connects and signs messages.** A connected site gets the
wallet's address, can read the chain through it, and can ask for signatures:

- `personal_sign`: the message is shown as text. Bytes that aren't text are
  shown as hex and marked unknown. A Sign-In with Ethereum message for a
  different site than the one asking is flagged as phishing.
- `eth_signTypedData_v4` (and v3): explained in plain words by the same check
  the app uses (`core/typed-data.js`). Permits are red. Anything unrecognised
  is unknown. A request for another chain is refused.
- Red or unknown requests need "I understand" ticked before Sign works, and
  every signature needs the password. One request per site at a time.
- Every signature is listed under **Recent signatures** in the popup, on this
  computer only.

`eth_sign` (raw hashes) is refused for good. Sending transactions is refused
with `4200 unsupported` until its approval screen ships.

## Build and try it

```sh
bun install && (cd android && bun install)
bun run build:extension          # → dist-extension/
```

Then in Chrome: `chrome://extensions` → turn on **Developer mode** → **Load
unpacked** → pick `dist-extension/`. Pin Tera from the puzzle-piece menu.

## How it's put together

| File | Runs in | Holds |
| --- | --- | --- |
| `src/inpage.ts` | the site's page | the provider object; nothing secret |
| `src/content.ts` | the site's tab, isolated | nothing; relays messages |
| `src/background.ts` | the extension's worker | every decision, the connected-site list, the signature log |
| `src/vault.ts` | the extension's worker | the sealed wallet |
| `src/popup.ts`, `src/approve.ts` | extension pages | the toolbar popup and the connect window |

The rules are in `public/tera/core/dapp-connect.js` (which sites may connect,
what each request is, wrong-password waits) and `public/tera/core/dapp-sign.js`
(what a signature request asks and how risky it is), tested by
`tests/frontend/dapp-connect.test.js` and `tests/frontend/dapp-sign.test.js`.

- The wallet is sealed with the owner's password exactly as the web app seals
  it (PBKDF2-SHA256, 600,000 rounds, AES-GCM), in `chrome.storage.local`,
  which content scripts are denied.
- Which site is asking comes from Chrome (the port's sender), never from the
  page.
- Only https sites and http on localhost can connect. A connection is per
  origin; disconnecting from the popup tells the site immediately.
- Connecting needs the password. Five wrong tries, then a wait that doubles
  from 30 seconds to 15 minutes.
- No remote code: every script is bundled, and the extension pages' CSP is
  `script-src 'self'`.

No contracts change: the extension uses the same keys and the same chain as
the app.
