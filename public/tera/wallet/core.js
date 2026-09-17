export const GATES = [
  "asset_registry",
  "eligibility_preflight",
  "policy_vault",
  "risk_engine",
  "approval_controller",
];
export const ZERO_ADDRESS = `0x${"0".repeat(40)}`;
export const isAddress = (value) => typeof value === "string" && /^0x[\da-f]{40}$/i.test(value);
export const isHash = (value) => typeof value === "string" && /^0x[\da-f]{64}$/i.test(value);
export const sameAddress = (a, b) =>
  isAddress(a) && isAddress(b) && a.toLowerCase() === b.toLowerCase();

export function parseUnits(value, decimals) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36)
    throw new Error("Invalid asset precision.");
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error("Enter a positive decimal amount.");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals)
    throw new Error(`This asset supports at most ${decimals} decimal places.`);
  const amount = BigInt(whole + fraction.padEnd(decimals, "0"));
  if (amount <= 0n || amount >= 2n ** 256n)
    throw new Error("Amount is outside the supported range.");
  return amount.toString();
}

export function formatUnits(value, decimals = 18) {
  const digits = BigInt(value)
    .toString()
    .padStart(decimals + 1, "0");
  if (!decimals) return digits;
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  return digits.slice(0, -decimals) + (fraction ? `.${fraction}` : "");
}

export function evaluateLocalPolicy(intent, bundle, signerAddress, now = Date.now()) {
  if (!bundle || !bundle.signature || !bundle.rules || !sameAddress(bundle.signer, signerAddress))
    return "The signed policy bundle could not be verified.";
  const expires = Date.parse(bundle.expiresAt);
  if (!Number.isFinite(expires) || now > expires) return "The signed policy bundle has expired.";
  if (
    !Array.isArray(bundle.rules.allowedActions) ||
    !bundle.rules.allowedActions.includes(intent.actionType)
  )
    return "This action is blocked by the signed local policy.";
  if (
    intent.maxSpendUsdCents &&
    Number(intent.maxSpendUsdCents) > Number(bundle.rules.maxSingleTradeUsdCents)
  )
    return "This proposal exceeds the signed local spending limit.";
  return null;
}

export class ApiError extends Error {
  constructor(message, payload, status) {
    super(message);
    this.payload = payload;
    this.status = status;
  }
}

export function createApi(baseUrl, fetcher = fetch) {
  return async (path, body, options = {}) => {
    let response;
    try {
      response = await fetcher(`${baseUrl.replace(/\/$/, "")}${path}`, {
        method: options.method || (body === undefined ? "GET" : "POST"),
        headers:
          body === undefined
            ? { Accept: "application/json" }
            : { Accept: "application/json", "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(25000),
      });
    } catch (error) {
      // A transport that names its own failure is reporting something the owner
      // needs: a reply that did not authenticate, or a relay that refused. Only
      // an unexplained failure becomes the generic connection message.
      if (error?.transport) throw new ApiError(error.message, null, 0);
      throw new ApiError("Cannot reach Tera. Check your connection and try again.", null, 0);
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new ApiError(
        "Tera returned an unreadable response. Please try again.",
        null,
        response.status,
      );
    }
    if (!response.ok || !payload || payload.success !== true) {
      throw new ApiError(
        payload?.error || `Request failed (${response.status}).`,
        payload,
        response.status,
      );
    }
    return payload;
  };
}

// Only transactions whose exact effect can be checked against the owner's review
// are executable. The current swap API does not provide a quote.
export function executionIssue(proposal, owner, chainId, now = Date.now()) {
  const tx = proposal?.preparedTransaction;
  const intent = proposal?.intent || tx?.intent;
  if (!tx || !intent) return "No prepared transaction is available.";
  if (
    !sameAddress(intent.ownerAddress, owner) ||
    !sameAddress(intent.accountAddress || owner, owner)
  )
    return "This proposal belongs to a different wallet. Prepare it again.";
  if (tx.chainId !== chainId) return "The prepared transaction targets a different network.";
  if (!isAddress(tx.to) || tx.to === ZERO_ADDRESS || !isAddress(intent.assetAddress))
    return "The service returned an invalid contract address.";
  if (!isHash(tx.actionHash)) return "The service returned an invalid action reference.";
  if (
    !Array.isArray(proposal.gates) ||
    proposal.gates.length !== GATES.length ||
    !GATES.every(
      (name) => proposal.gates.filter((g) => g.gate === name && g.passed === true).length === 1,
    )
  )
    return "All five checks must pass before approval.";
  if (proposal.expiresAt) {
    const expiry =
      typeof proposal.expiresAt === "number" ? proposal.expiresAt : Date.parse(proposal.expiresAt);
    if (!Number.isFinite(expiry) || now > expiry)
      return "This proposal has expired. Prepare it again to refresh the checks.";
  }
  if (intent.actionType === "BUY" || intent.actionType === "SELL") {
    const quote = proposal.quote || tx.quote || proposal.preparedTransaction?.quote;
    if (!quote || !quote.amountOutWei || !quote.quotedAt || !quote.route)
      return "This swap has no verified live quote. Prepare it again.";
    if (!Array.isArray(tx.approvals)) return "Swap approvals are incomplete. Prepare it again.";
    if (Number.isFinite(Date.parse(quote.quotedAt)) && now - Date.parse(quote.quotedAt) > 120000)
      return "This swap quote is stale. Prepare it again.";
    return null;
  }
  if (intent.actionType === "CLAIM_YIELD")
    return "Yield claims are not yet supported by the transaction service.";
  if (intent.actionType !== "TRANSFER") return "Unsupported transaction action.";
  if (!isAddress(intent.recipient)) return "Specify a recipient in a new transfer proposal.";
  try {
    if (
      !/^\d+$/.test(intent.amount) ||
      BigInt(intent.amount) <= 0n ||
      BigInt(intent.amount) >= 2n ** 256n
    )
      return "Invalid transfer amount.";
    if (intent.assetAddress === ZERO_ADDRESS) {
      if (
        !sameAddress(tx.to, intent.recipient) ||
        tx.data !== "0x" ||
        BigInt(tx.value) !== BigInt(intent.amount)
      )
        return "The prepared transaction does not match the native ETH transfer you reviewed.";
      return null;
    }
    const expected = `0xa9059cbb${intent.recipient.slice(2).toLowerCase().padStart(64, "0")}${BigInt(intent.amount).toString(16).padStart(64, "0")}`;
    if (
      !sameAddress(tx.to, intent.assetAddress) ||
      tx.data?.toLowerCase() !== expected ||
      BigInt(tx.value) !== 0n
    )
      return "The prepared transaction does not match the transfer you reviewed.";
  } catch {
    return "The service returned an invalid transaction.";
  }
  return null;
}

export async function assertWallet(provider, owner, chainId) {
  const [accounts, chain] = await Promise.all([
    provider.request({ method: "eth_accounts" }),
    provider.request({ method: "eth_chainId" }),
  ]);
  if (!sameAddress(accounts[0], owner))
    throw new Error("Your wallet account changed. Review a new proposal.");
  if (Number(chain) !== chainId)
    throw new Error("Switch your wallet to the configured Robinhood Chain network.");
}

export async function sendPrepared(
  provider,
  proposal,
  owner,
  chainId,
  beforeSend = () => {},
  onStage = () => {},
) {
  // `onStage` reports where the action has reached so the owner can see the
  // moment authority moves from preparation to their own signature. It never
  // changes what runs.
  const report = (id, status, info) => {
    try {
      onStage(id, status, info || {});
    } catch {
      /* Progress reporting must never interrupt an approval. */
    }
  };
  const stage = async (id, info, run) => {
    report(id, "running", info);
    try {
      const value = await run();
      report(id, "done", info);
      return value;
    } catch (error) {
      report(id, "failed", { ...info, message: error?.message || "" });
      throw error;
    }
  };

  report("verify", "running", {});
  const issue = executionIssue(proposal, owner, chainId);
  if (issue) {
    report("verify", "failed", { message: issue });
    throw new Error(issue);
  }
  report("verify", "done", {});
  const tx = proposal.preparedTransaction;
  const nativeTransfer = proposal.intent.assetAddress === ZERO_ADDRESS;
  const steps = [...(tx.approvals || []), tx];
  const total = steps.length;
  await stage("wallet", { total }, () => assertWallet(provider, owner, chainId));
  let finalHash;
  for (const [index, step] of steps.entries()) {
    const info = { step: index + 1, total };
    const request = {
      from: owner,
      to: step.to,
      data: step.data,
      value: step.value,
      chainId: `0x${chainId.toString(16)}`,
    };
    if (!nativeTransfer) {
      await stage("contract", info, async () => {
        const code = await provider.request({ method: "eth_getCode", params: [step.to, "latest"] });
        if (!code || code === "0x" || code === "0x0")
          throw new Error(
            "No contract exists at a prepared transaction address on the selected network.",
          );
      });
    } else {
      report("contract", "skipped", info);
    }
    await stage("simulate", info, async () => {
      const simulation = await provider.request({
        method: "eth_call",
        params: [request, "latest"],
      });
      if (!nativeTransfer && simulation !== "0x" && !/^0x0{63}1$/i.test(simulation))
        throw new Error("The transaction failed wallet simulation.");
    });
    await stage("gas", info, () =>
      provider.request({ method: "eth_estimateGas", params: [request] }),
    );
    await stage("recheck", info, async () => {
      await assertWallet(provider, owner, chainId);
      const refreshedIssue = executionIssue(proposal, owner, chainId);
      if (refreshedIssue) throw new Error(refreshedIssue);
    });
    beforeSend();
    const hash = await stage("sign", info, async () => {
      const result = await provider.request({ method: "eth_sendTransaction", params: [request] });
      if (!isHash(result))
        throw new Error(
          "The wallet returned an invalid transaction hash. Check your wallet activity before retrying.",
        );
      return result;
    });
    finalHash = hash;
    if (step !== tx) {
      // Wait for each approval before the swap so the router can observe the new allowance.
      await stage("confirm", info, async () => {
        let receipt = null;
        for (let attempt = 0; attempt < 60 && !receipt; attempt++) {
          receipt = await provider.request({ method: "eth_getTransactionReceipt", params: [hash] });
          if (!receipt) await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        if (!receipt || receipt.status === "0x0")
          throw new Error("An approval transaction did not confirm. The swap was not submitted.");
      });
    }
  }
  report("submitted", "done", { total });
  return finalHash;
}

export async function checkReceipt(provider, record, chainId) {
  if (!isHash(record.txHash) || !isAddress(record.owner))
    throw new Error("Invalid transaction record.");
  if (Number(await provider.request({ method: "eth_chainId" })) !== chainId)
    throw new Error("Switch back to Robinhood Chain to check this transaction.");
  const receipt = await provider.request({
    method: "eth_getTransactionReceipt",
    params: [record.txHash],
  });
  if (!receipt) return "pending";
  if (
    !sameAddress(receipt.from, record.owner) ||
    !sameAddress(receipt.to, record.to) ||
    receipt.transactionHash?.toLowerCase() !== record.txHash.toLowerCase()
  )
    throw new Error("The transaction receipt does not match this action.");
  if (receipt.status === "0x0") return "reverted";
  if (receipt.status !== "0x1" || !receipt.blockHash)
    throw new Error("The transaction receipt is incomplete.");
  return "confirmed";
}

export function errorMessage(error) {
  if (error?.code === 4001)
    return "Request declined in your wallet. Nothing new was submitted by Tera.";
  if (error?.code === -32002)
    return "A request is already open in your wallet. Open it to continue.";
  return error?.message || "Something went wrong. Please try again.";
}
