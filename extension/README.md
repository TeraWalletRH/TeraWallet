# Tera Wallet for Chrome

The Tera wallet as a browser extension: a wallet in the toolbar, and one
that sites on Robinhood Chain can find (`window.ethereum` and EIP-6963) and
ask to connect, with the owner deciding.

**This version (0.8) is the wallet in the popup, with swaps and staking,
and a new setup.** Installing Tera opens a welcome tab (`welcome.html`,
`src/welcome.ts`), and so does the popup until there's a wallet: Chrome
closes the popup whenever it loses focus, which is every time someone
switches to the note their phrase is in.

- **Create a new wallet** opens the Tera web wallet, where the phrase is made
  and backed up, and the web wallet hands it straight back
  (`android/src/handoff.ts`). The welcome tab makes a one-time P-256 key pair
  (the private half can't be exported) and opens
  `/app#tera-extension=<extension id>.<public key>.<session>`. After the
  backup check, the web wallet seals the phrase to that key (ECDH, HKDF,
  AES-GCM) and sends it with `chrome.runtime.sendMessage`, which Chrome only
  allows from terawallet.app (`externally_connectable`). The background
  worker keeps it, in memory, only if a welcome tab is waiting for that
  session, and only that tab can open it. The web wallet keeps nothing,
  unless the owner also chooses to use the wallet there, and Tera's servers
  are never involved.
- **I already have a wallet** offers a recovery phrase (12 or 24 numbered
  boxes; paste the whole phrase into the first and it fills them, numbering
  and all; misspelt words show in red) or a private key. Either shows the
  wallet's address once it's valid, before anything is stored.
- **Create a password**, with a strength meter (`core/onboarding.js`): 8
  characters at least, as before; the meter only advises.
- **You're all set**, with the steps to pin Tera to the toolbar, ticked off
  as soon as Chrome reports it pinned.

The secret stays in the welcome tab's memory between the step it's typed in
and the password step, which hands it to the background worker to seal.

**The look.** Settings → Appearance (and the last setup step) picks System,
Light, Dark or Black (true black, for OLED screens). `src/theme.ts` runs in
each page's `<head>` before it paints, so nothing flashes the wrong colours,
and a change reaches every open Tera page at once. Buttons and type follow
the app: the mark's gold-to-copper gradient for the main action, and Plus
Jakarta Sans (SIL OFL), shipped inside the extension.

Click the toolbar icon:

- **Wallet**: the total value, and what the wallet holds (ETH, USDG, and any
  asset from Tera's registry with a balance), each with its dollar value.
  Balances are read from the chain; the registry and prices come from Tera's
  API, and neither request says which wallet is asking. The registry is
  checked by `core/wallet-send.js`: it can't relabel USDG or ETH.
- **Send**: ETH or a token, to a 0x address. The recipient is checked as you
  type (not the zero address, not the token's own contract, and a lookalike
  of someone you've paid is called out), the amount can't exceed the balance,
  and ETH's Max keeps the network fee back. Review opens the same window a
  site's request does, with the same simulation, fee cap and plain-words
  description, and a note when you've never sent to that address before.
  An unfinished send survives the popup closing.
- **Swap**: buy or sell any asset in Tera's registry for USDG (TERA trades
  against ETH), as in the app. The quote comes from Tera's API under Tera's
  signed policy, and the app's own check (`android/src/proposals.ts`)
  rebuilds every byte of every step on this computer; a quote that differs
  is refused. The review shows what you pay, what you should get, the least
  you can get after your slippage limit, the price impact (refused past 15%,
  ticked past 5%), and each step by name. Approvals are for the exact
  amount, never unlimited. Steps go out one at a time, each simulated just
  before it's sent, and the next waits for the one before to confirm. A
  quote over 90 seconds old is fetched again and shown before anything is
  signed.
- **Stake**: TERA, flexible or locked for 30, 45 or 90 days. The deposit is
  checked to be exactly a TERA transfer of that amount to Tera's pool
  (`core/staking.js`), and is remembered until Tera's service credits it.
  Claiming, unstaking and unlocking sign a request that Tera's treasury then
  pays out; the text is rebuilt here and anything else is refused unsigned
  (`core/wallet-swap.js`).
- **Receive**: the address and its QR code.
- **Activity**: recent transactions with their status, and every signature.
- **Settings**: connected sites, and removing the wallet.

Tera never stays unlocked, so there's nothing to lock on blur or after a
timeout: every send and signature asks for the password, and the key is
opened only for that one step.

**Sites.** Before a connection request ever shows an approval window, the
site's domain is checked against a known-phishing list (MetaMask's own
maintained, open-source blocklist), fetched and cached locally and refreshed
at most once a day; a listed domain is refused outright, with no window shown
at all (`src/phishing.ts`). A connected site gets the wallet's address, can
read the chain through it, and can ask for:

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
| `src/popup.ts` | extension page | the wallet: balances, send, receive, activity, settings |
| `src/approve.ts` | extension page | the window that reviews every connection, signature and send |
| `src/shared.ts` | both | what the worker and the pages agree on |

The rules are in `public/tera/core/dapp-connect.js` (which sites may connect,
what each request is, wrong-password waits) and `public/tera/core/dapp-sign.js`
(what a signature request asks and how risky it is) and
`public/tera/core/dapp-send.js` (what a transaction does, and whether the
wallet can pay for it), `public/tera/core/wallet-send.js` (the popup's
assets, amounts and recipients) and `public/tera/core/wallet-swap.js`
(swap reviews and staking requests), each with its own test file in
`tests/frontend/`.

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
