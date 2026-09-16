import { assertWallet, isHash, sameAddress, parseUnits, formatUnits } from "./core.js";

export function checkBridgeQuote(q, input, now = Date.now()) {
  if (!q || !isHash(q.requestId) || !Number.isFinite(q.expiresAt) || now >= q.expiresAt)
    throw new Error("Bridge quote expired. Request a fresh quote.");
  for (const field of ["ownerAddress", "recipient", "amount", "destinationChainId"])
    if (q.input?.[field] !== input[field]) throw new Error("Bridge quote does not match your request.");
  if (q.input?.originCurrency && q.input.originCurrency !== input.originCurrency) throw new Error("Bridge quote does not match your source asset.");
  if (q.input?.destinationCurrency && q.input.destinationCurrency !== input.destinationCurrency) throw new Error("Bridge quote does not match your destination asset.");
  if (![8453, 792703809].includes(input.destinationChainId) || !Array.isArray(q.steps) ||
      !["approve,deposit", "deposit"].includes(q.steps.map(s => s.id).join(",")))
    throw new Error("Unsupported bridge steps.");
  if (!/^\d+$/.test(q.amountOut) || !/^\d+$/.test(q.minimumAmountOut) || BigInt(q.minimumAmountOut) <= 0n ||
      BigInt(q.minimumAmountOut) > BigInt(q.amountOut) ||
      BigInt(q.minimumAmountOut) < BigInt(q.amountOut) * 9950n / 10000n) throw new Error("Invalid bridge output.");
  const word = s => s.slice(2).toLowerCase().padStart(64, "0");
  const token = q.input.originCurrency || "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
  const deposit = "0x4cd00e387622c35bddb9b4c962c136462338bc31";
  const amount = BigInt(input.amount).toString(16).padStart(64, "0");
  for (const tx of q.steps) {
    if (tx.chainId !== 4663) throw new Error("Unexpected source network.");
    const data = String(tx.data).toLowerCase();
    if (tx.id === "approve") {
      if (token === "0x0000000000000000000000000000000000000000" || BigInt(tx.value) !== 0n || !sameAddress(tx.to, token) || data !== `0x095ea7b3${word(deposit)}${amount}`)
        throw new Error("Unexpected token approval.");
    } else if (!sameAddress(tx.to, deposit) || (token === "0x0000000000000000000000000000000000000000" ? (!/^0x49290c1c[\da-f]{128}$/.test(data) || data.slice(0, 74) !== `0x49290c1c${word(input.ownerAddress)}` || BigInt(tx.value) !== BigInt(input.amount)) : (!/^0xe8017952[\da-f]{256}$/.test(data) || BigInt(tx.value) !== 0n || data.slice(10, 74) !== word(input.ownerAddress) || data.slice(74, 138) !== word(token) || data.slice(138, 202) !== amount)))
      throw new Error("Unexpected deposit transaction.");
  }
}

export async function sendBridge(provider, quote, input, active, onHash, onProgress) {
  checkBridgeQuote(quote, input);
  for (const tx of quote.steps) {
    active();
    checkBridgeQuote(quote, input);
    await assertWallet(provider, input.ownerAddress, 4663);
    const request = { from: input.ownerAddress, to: tx.to, data: tx.data, value: tx.value };
    const code = await provider.request({ method: "eth_getCode", params: [tx.to, "latest"] });
    if (!code || code === "0x") throw new Error("Bridge contract is unavailable on this network.");
    await provider.request({ method: "eth_call", params: [request, "latest"] });
    const gas = await provider.request({ method: "eth_estimateGas", params: [request] });
    active();
    checkBridgeQuote(quote, input);
    await assertWallet(provider, input.ownerAddress, 4663);
    active();
    onProgress(tx.id === "approve" ? "Approve the exact USDG allowance in your wallet." : "Review and sign the bridge deposit in your wallet.");
    const hash = await provider.request({ method: "eth_sendTransaction", params: [{ ...request, gas, chainId: "0x1237" }] });
    if (!isHash(hash)) throw new Error("Wallet returned no valid transaction hash. Check wallet activity before retrying.");
    await onHash(tx.id, hash);
    if (tx.id === "deposit") return hash;
    onProgress("Waiting for the USDG allowance to confirm…");
    let confirmed = false;
    for (let i = 0; i < 40; i++) {
      active();
      const receipt = await provider.request({ method: "eth_getTransactionReceipt", params: [hash] });
      if (receipt) {
        if (receipt.status !== "0x1") throw new Error("Token approval reverted.");
        confirmed = true; break;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    if (!confirmed) throw new Error("Approval is still pending. Check wallet activity, then request a fresh quote after confirmation.");
  }
}

export function bridgeView({ esc, pair, button, records, owner, demo }) {
  return `<div class="note">Bridge ETH or USDG from Robinhood Chain to Base or Solana. Paste the destination address; your connected Robinhood wallet signs the deposit.</div>
  <section class="panel"><form id="bridge-form">
  <div class="field"><label for="bridge-source">From</label><select id="bridge-source" name="source"><option value="0x5fc5360d0400a0fd4f2af552add042d716f1d168">Robinhood Chain · USDG</option><option value="0x0000000000000000000000000000000000000000">Robinhood Chain · ETH</option></select></div>
  <div class="field"><label for="bridge-chain">Destination chain</label><select id="bridge-chain" name="destination"><option value="8453">Base</option><option value="792703809">Solana</option></select></div>
  <div class="field"><label for="bridge-token">Destination token</label><select id="bridge-token" name="destinationCurrency"><option value="0x0000000000000000000000000000000000000000">ETH</option><option value="0x833589fcd6edb6e08f4c7c32d4f71b54bda02913">USDC</option></select></div>
  <div class="field"><label for="bridge-recipient">Destination wallet address</label><input id="bridge-recipient" name="recipient" autocomplete="off" required placeholder="Paste the receiving wallet address"></div>
  <div class="field"><label for="bridge-amount">Amount</label><input id="bridge-amount" name="amount" inputmode="decimal" required placeholder="10.00"></div>
  <p class="micro">The token list updates for the selected chain. Review the full address carefully. Relay receives your source and destination addresses and amount.</p>
  <p role="alert"></p><button class="btn" ${!owner || demo ? "disabled" : ""}>Get bridge quote ↗</button></form></section>
  <div class="section-label">Bridge delivery history</div>${records.map((r, i) => `<article class="panel">${pair("Destination", r.destinationChainId === 8453 ? "Base · USDC" : "Solana · USDC")}${pair("Recipient", r.recipient)}${pair("USDG input", formatUnits(r.amount, 6))}${pair("Delivery status", r.status || "waiting")}${pair("Relay reference", r.requestId)}${r.depositHash ? pair("Source deposit", r.depositHash) : ""}${(r.destinationHashes || []).map(h => pair(r.status === "refund" ? "Refund transaction" : "Delivery transaction", h)).join("")}${r.error ? `<p role="alert">${esc(r.error)}</p>` : ""}${button("Refresh delivery status", "bridge-status", `data-index="${i}"`)}</article>`).join("") || '<p class="micro">No bridges on this device. Unlock the encrypted vault to restore saved tracking.</p>'}`;
}

export function bridgeFormInput(form, ownerAddress) {
  const data = new FormData(form);
  const source = String(data.get("source"));
  const decimals = source === "0x0000000000000000000000000000000000000000" ? 18 : 6;
  return { ownerAddress, recipient: String(data.get("recipient")).trim(), originCurrency: source, destinationCurrency: String(data.get("destinationCurrency")), destinationChainId: Number(data.get("destination")), amount: parseUnits(String(data.get("amount")).trim(), decimals) };
}
