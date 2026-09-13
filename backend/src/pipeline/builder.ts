import { encodeFunctionData, keccak256, toHex, stringToBytes } from "viem";
import { type UserIntent, type GateResult, type PreparedTransaction } from "./types";
import {
  TerraAccountAbi,
  TerraAccountFactoryAbi,
  V4VenueAbi,
  IERC3643Abi,
  getDeployments,
} from "../chain/metadata";
import { env } from "../env";

export function buildPreparedTransaction(
  intent: UserIntent,
  accountAddress: `0x${string}`,
  gates: GateResult[]
): PreparedTransaction {
  const deployments = getDeployments(env.rhcChainId);
  const amountBig = BigInt(intent.amount);

  let targetContract: `0x${string}` = intent.assetAddress;
  let callValue = 0n;
  let innerData: `0x${string}`;

  if (intent.actionType === "BUY") {
    targetContract = deployments.venue;
    innerData = encodeFunctionData({
      abi: V4VenueAbi,
      functionName: "buy",
      args: [intent.assetAddress, amountBig],
    });
  } else if (intent.actionType === "SELL") {
    targetContract = deployments.venue;
    // 0.5% default slippage
    const minPayout = (amountBig * 995n) / 1000n;
    innerData = encodeFunctionData({
      abi: V4VenueAbi,
      functionName: "sell",
      args: [intent.assetAddress, amountBig, minPayout],
    });
  } else if (intent.actionType === "CLAIM_YIELD") {
    targetContract = deployments.venue;
    innerData = encodeFunctionData({
      abi: V4VenueAbi,
      functionName: "claimYield",
      args: [intent.assetAddress],
    });
  } else {
    // TRANSFER
    const recipient = intent.recipient ?? intent.ownerAddress;
    innerData = encodeFunctionData({
      abi: IERC3643Abi,
      functionName: "transfer",
      args: [recipient, amountBig],
    });
  }

  // Outer call: TerraAccount.execute(targetContract, callValue, innerData)
  const outerData = encodeFunctionData({
    abi: TerraAccountAbi,
    functionName: "execute",
    args: [targetContract, callValue, innerData],
  });

  // Action hash calculation
  const actionHash = keccak256(
    stringToBytes(`${intent.ownerAddress}-${intent.assetAddress}-${intent.amount}-${intent.actionType}-${Date.now()}`)
  );

  return {
    to: accountAddress,
    data: outerData,
    value: toHex(callValue),
    chainId: env.rhcChainId,
    actionHash,
    intent,
    gates,
  };
}

export function encodeCounterfactualAddressCall(owner: `0x${string}`, salt: `0x${string}`): `0x${string}` {
  return encodeFunctionData({
    abi: TerraAccountFactoryAbi,
    functionName: "getAddress",
    args: [owner, salt],
  });
}
