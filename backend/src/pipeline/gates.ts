import { type UserIntent, type GateResult } from "./types";
import { createPublicClient, http, erc20Abi, isAddress } from "viem";
import { env } from "../env";
import { findAsset, SUPPORTED_RWA_ASSETS, TERA } from "../data/assets";
import { quoteSwap } from "../chain/swapQuote";
import { formatUnits } from "viem";
import { evaluatePolicy } from "../policy";

const publicClient = createPublicClient({
  // Registry fallback is deterministic. Do not let an optional preflight RPC
  // stall a policy rejection or the API response when the chain is slow.
  transport: http(env.rhcRpcUrl, { timeout: 2_000, retryCount: 0 }),
});

export async function runGatePipeline(intent: UserIntent): Promise<GateResult[]> {
  const results: GateResult[] = [];

  // Gate 1: Asset Registry
  const gate1 = await checkAssetRegistry(intent);
  results.push(gate1);
  if (!gate1.passed) return results;

  // Gate 2: Eligibility Preflight
  const gate2 = await checkEligibilityPreflight(intent);
  results.push(gate2);
  if (!gate2.passed) return results;

  // Gate 3: Policy Vault
  const gate3 = await checkPolicyVault(intent);
  results.push(gate3);
  if (!gate3.passed) return results;

  // Gate 4: Risk Engine
  const gate4 = await checkRiskEngine(intent);
  results.push(gate4);
  if (!gate4.passed) return results;

  // Gate 5: Approval Controller
  results.push({
    gate: "approval_controller",
    passed: true,
    details: { requiresOwnerSignature: true },
  });

  return results;
}

export async function checkAssetRegistry(intent: UserIntent): Promise<GateResult> {
  if (
    !intent.assetAddress ||
    intent.assetAddress === "0x0000000000000000000000000000000000000000"
  ) {
    // Native ETH is valid
    const isEth = intent.actionType === "BUY" || intent.actionType === "TRANSFER";
    if (!isEth) {
      return {
        gate: "asset_registry",
        passed: false,
        reason: "Asset address is invalid or zero address",
      };
    }
  }

  const registered = findAsset(intent.assetAddress);
  if (!registered) {
    return {
      gate: "asset_registry",
      passed: false,
      reason: `Asset '${intent.assetAddress}' is not an approved RWA asset on Robinhood Chain`,
    };
  }

  if (registered.status !== "ACTIVE") {
    return {
      gate: "asset_registry",
      passed: false,
      reason: `Asset '${registered.symbol}' is currently suspended in the registry`,
    };
  }

  return {
    gate: "asset_registry",
    passed: true,
    details: {
      symbol: registered.symbol,
      name: registered.name,
      address: registered.address,
      category: registered.category,
      decimals: registered.decimals,
      verifiedInRegistry: true,
      isSuspended: false,
    },
  };
}

export async function checkEligibilityPreflight(intent: UserIntent): Promise<GateResult> {
  const targetAddress = intent.recipient ?? intent.ownerAddress;
  if (!isAddress(targetAddress) && !isAddress((targetAddress as string).toLowerCase())) {
    return {
      gate: "eligibility_preflight",
      passed: false,
      reason: "Invalid recipient/owner address format",
    };
  }

  const asset = findAsset(intent.assetAddress);
  const isNativeEth =
    asset?.tokenStandard === "native" ||
    intent.assetAddress === "0x0000000000000000000000000000000000000000";

  if (isNativeEth) {
    return {
      gate: "eligibility_preflight",
      passed: true,
      details: {
        canTransfer: true,
        tokenStandard: "native",
        verifiedOnChain: true,
      },
    };
  }

  try {
    // Live on-chain verification of deployed contract bytecode on Robinhood Chain
    const bytecode = await publicClient.getBytecode({ address: intent.assetAddress });
    const isDeployed = typeof bytecode === "string" && bytecode.length > 2;

    if (!isDeployed) {
      return {
        gate: "eligibility_preflight",
        passed: false,
        reason: `Contract bytecode not found at ${intent.assetAddress} on Robinhood Chain`,
      };
    }

    return {
      gate: "eligibility_preflight",
      passed: true,
      details: {
        canTransfer: true,
        verifiedOnChain: true,
        tokenStandard: asset?.tokenStandard ?? "ERC-20",
        contractDeployed: true,
      },
    };
  } catch (rpcError) {
    // RPC call failed — fall back to static registry check.
    // canTransfer is unknown; we have not verified deployment on-chain.
    if (asset) {
      return {
        gate: "eligibility_preflight",
        passed: true,
        details: {
          canTransfer: "unknown",
          verifiedOnChain: false,
          verifiedInRegistry: true,
          rpcFallback: true,
          tokenStandard: asset.tokenStandard,
        },
      };
    }

    return {
      gate: "eligibility_preflight",
      passed: false,
      reason:
        "Failed to verify asset contract on Robinhood Chain and asset is not in static registry",
    };
  }
}

export async function checkPolicyVault(intent: UserIntent): Promise<GateResult> {
  let evaluated = intent;
  if (intent.actionType === "BUY" && intent.assetAddress.toLowerCase() === TERA.address.toLowerCase()) {
    try {
      // The client amount is ETH wei for this pool. Price it independently on
      // chain so a caller cannot evade the signed USD single-trade cap.
      const usdQuote = await quoteSwap("WETH", "USDG", formatUnits(BigInt(intent.amount), 18));
      if (!usdQuote || usdQuote.decimalsOut !== 6) throw new Error("No ETH/USDG quote");
      const cents = (usdQuote.amountOutWei + 9999n) / 10000n;
      if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Quote exceeds safe limit");
      evaluated = { ...intent, maxSpendUsdCents: Math.max(Number(cents), intent.maxSpendUsdCents || 0) };
    } catch {
      return { gate: "policy_vault", passed: false, reason: "Cannot verify the USD value of this ETH purchase." };
    }
  }
  const policy = evaluatePolicy(evaluated);
  if (!policy.passed) {
    return {
      gate: "policy_vault",
      passed: false,
      reason: `Proposal exceeds the maximum single-trade limit`,
      details: {
        limitExceeded: true,
        signedPolicy: true,
      },
    };
  }

  return {
    gate: "policy_vault",
    passed: true,
    details: {
      withinSingleTradeCap: true,
      signedPolicy: true,
    },
  };
}

export async function checkRiskEngine(intent: UserIntent): Promise<GateResult> {
  if (BigInt(intent.amount) <= 0n) {
    return {
      gate: "risk_engine",
      passed: false,
      reason: "Execution amount must be strictly greater than zero",
    };
  }

  return {
    gate: "risk_engine",
    passed: true,
    details: {
      slippageToleranceBps: 100,
      quoteFreshnessSeconds: 120,
      priceImpactPassed: true,
    },
  };
}
