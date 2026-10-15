# Tera Wallet for Chrome

The Tera wallet as a browser extension: sites on Robinhood Chain can find it
(`window.ethereum` and EIP-6963) and ask to connect, and the owner decides.

**This version (0.1) connects only.** A connected site gets the wallet's
address and can read the chain through it. Signing (transactions, messages,
typed data) is refused with the standard `4200 unsupported` error until the
approval screens for it ship.

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
| `src/background.ts` | the extension's worker | every decision, the connected-site list |
| `src/vault.ts` | the extension's worker | the sealed wallet |
| `src/popup.ts`, `src/approve.ts` | extension pages | the toolbar popup and the connect window |

The rules (which sites may connect, what each request is, wrong-password
waits) are in `public/tera/core/dapp-connect.js`, tested by
`tests/frontend/dapp-connect.test.js`.

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
