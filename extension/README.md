# Tera Wallet for Chrome

The Tera wallet as a browser extension: sites on Robinhood Chain can find it
(`window.ethereum` and EIP-6963) and ask to connect, and the owner decides.

**This version (0.3) connects, signs and sends.** A connected site gets the
wallet's address, can read the chain through it, and can ask for:

- **Transactions** (`eth_sendTransaction`), described in words by
  `core/dapp-send.js`. ETH sends and token transfers read as "Send 5 USDG".
  An approval says who can spend what, and in red when it's unlimited or for
  a contract Tera doesn't know. Approving a whole NFT collection is red. Any
  other contract call is unknown and shows the ETH it also sends. Tera
  simulates every transaction first and won't offer one that would fail. It
  picks the gas and fees itself (the site's suggestions are ignored), caps
  the fee at 0.001 ETH like the app, and refuses if the wallet can't cover
  amount plus fee. A recipient that looks like someone you've paid but isn't
  is called out. The hash is saved before the broadcast, and an uncertain
  broadcast is never retried. Every transaction is listed under **Recent
  transactions** with its status and an explorer link.
- **Messages** (`personal_sign`): shown as text. Bytes that aren't text are
  marked unknown. A Sign-In with Ethereum message for a different site than
  the one asking is flagged as phishing.
- **Typed data** (`eth_signTypedData_v4`, v3): explained by the app's own
  check (`core/typed-data.js`). Permits are red. Requests for another chain
  are refused.

Red or unknown requests need "I understand" ticked first, and every request
needs the password. One request per site at a time. Contract creation,
`eth_sign` and `eth_signTransaction` are refused.

## Build and try it

```sh
bun install && (cd android && bun install)
bun run build:extension          # → dist-extension/
```

To test sending without real funds, build against a local chain:
`anvil --chain-id 4663 --port 8547`, then
`TERA_EXTENSION_RPC=http://127.0.0.1:8547 bun run build:extension`. Never
ship a build made with `TERA_EXTENSION_RPC` set.

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
(what a signature request asks and how risky it is) and
`public/tera/core/dapp-send.js` (what a transaction does, and whether the
wallet can pay for it), each with its own test file in `tests/frontend/`.

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
