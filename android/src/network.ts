import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  fallback,
  http,
  keccak256,
  type Address,
  type Hash,
} from "viem";
import { chain, RPC, RPCS, sources, type Tx } from "./config";
import { currentAccount, notePending, sessionVersion } from "./storage";
import { txCheck } from "./validation";
import { networkSpeed as speedCore } from "./core";
// retryCount: 0 stays on the wallet transport used for sending a
// transaction (below) — retrying a broadcast is a real idempotency risk.
// Reading a balance has no such risk, and no retries here means a single
// transient network blip fails the whole refresh outright, which reads to
// an owner as "the transfer I received isn't showing up."
export const client = createPublicClient({
  chain,
  transport: fallback(
    RPCS.map((url) => http(url, { timeout: 20000, retryCount: 2 })),
  ),
});
export async function balances(
  address: Address,
  tokens: Array<{ symbol: string; address: string }> = sources,
) {
  if ((await client.getChainId()) !== chain.id) throw new Error("RPC network mismatch.");
  const values = await Promise.allSettled(
    tokens.map(async (token) => {
      if (token.address === "0x0000000000000000000000000000000000000000")
        return [token.symbol, (await client.getBalance({ address })).toString()] as const;
      return [
        token.symbol,
        (
          await client.readContract({
            address: token.address as Address,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [address],
          })
        ).toString(),
      ] as const;
    }),
  );
  // A paused or non-standard RWA contract must not blank the entire wallet.
  // Keep successful ETH/USDG reads and surface unavailable token balances as zero.
  return Object.fromEntries(
    values.map((result, index) =>
      result.status === "fulfilled" ? result.value : [tokens[index].symbol, "0"],
    ),
  ) as Record<string, string>;
}
let sending = false;
export async function execute(
  steps: Tx[],
  verify: () => void,
  record: (row: any) => Promise<void>,
) {
  if (sending) throw new Error("A transaction is already in progress.");
  sending = true;
  const version = sessionVersion();
  const owner = currentAccount().address;
  const active = () => {
    // Android can briefly report background while a native surface has focus.
    // The vault session and selected account determine whether the wallet is
    // actually still available to sign. A real lock increments its version.
    if (version !== sessionVersion() || currentAccount().address !== owner)
      throw new Error("Wallet locked. Review again. / 钱包已锁定，请重新审核。");
    verify();
  };
  // The chain cannot change between two steps of the same transaction, so it
  // is read once here instead of once per step. It is read again after any
  // wait for a receipt, because that wait is the only point where enough time
  // passes for the answer to have become stale.
  const checkChain = async () => {
    if ((await client.getChainId()) !== chain.id) throw new Error("RPC network mismatch.");
  };
  // One wallet client for the whole run. Building one per step threw away the
  // chain id viem had already cached on it and paid for it again every step.
  const wallet = createWalletClient({
    chain,
    transport: http(RPC, { timeout: 20000, retryCount: 0 }),
  });
  try {
    await checkChain();
    for (let index = 0; index < steps.length; index++) {
      active();
      const tx = steps[index];
      txCheck(tx);
      // The code read and the simulation do not depend on each other, so they
      // go out together rather than one after the other. They are still judged
      // in the original order, so a missing contract is still reported as a
      // missing contract rather than as whatever the simulation said about it.
      const [code, simulated] = await Promise.allSettled([
        tx.data !== "0x" ? client.getCode({ address: tx.to }) : Promise.resolve(undefined),
        client.call({
          account: owner,
          to: tx.to,
          data: tx.data,
          value: BigInt(tx.value),
        }),
      ]);
      if (tx.data !== "0x") {
        if (code.status === "rejected") throw code.reason;
        if (!code.value) throw new Error("Contract unavailable. / 合约不可用。");
      }
      if (simulated.status === "rejected") throw simulated.reason;
      const simulation = simulated.value;
      if (
        (tx.data.startsWith("0xa9059cbb") || tx.data.startsWith("0x095ea7b3")) &&
        simulation.data &&
        simulation.data !== "0x" &&
        BigInt(simulation.data) !== 1n
      )
        throw new Error("Token rejected this transaction. / 代币拒绝了该交易。");
      // The nonce, the gas estimate and the fees do not depend on each other,
      // so they are read together and handed to viem rather than left for it
      // to collect one at a time. They are still read fresh on every step:
      // fees move while a step waits to confirm, and a fee carried over from
      // the step before is how a transaction gets stuck.
      const [nonce, gas, fees] = await Promise.all([
        client.getTransactionCount({ address: owner, blockTag: "pending" }),
        client.estimateGas({
          account: owner,
          to: tx.to,
          data: tx.data,
          value: BigInt(tx.value),
        }),
        client.estimateFeesPerGas(),
      ]);
      const request = await wallet.prepareTransactionRequest({
        account: owner,
        to: tx.to,
        data: tx.data,
        value: BigInt(tx.value),
        type: "eip1559",
        nonce,
        gas,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      });
      if (request.gas * request.maxFeePerGas > 1000000000000000n)
        throw new Error(
          "Network fee exceeds the reviewed 0.001 ETH per-step limit. / 网络手续费超过每步 0.001 ETH 的限额。",
        );
      active();
      const serialized = await currentAccount().signTransaction({
        type: "eip1559",
        chainId: chain.id,
        nonce: request.nonce,
        to: tx.to,
        data: tx.data,
        value: BigInt(tx.value),
        gas: request.gas,
        maxFeePerGas: request.maxFeePerGas,
        maxPriorityFeePerGas: request.maxPriorityFeePerGas,
      });
      active();
      const hash = keccak256(serialized);
      const createdAt = Date.now();
      // Persist the deterministic hash BEFORE broadcasting. Never blindly retry
      // after a timeout: a node may have accepted the signed transaction.
      //
      // Only the hash waits here. It goes to its own small sealed file, so the
      // guarantee costs a few hundred bytes instead of re-encrypting the whole
      // wallet, which used to put every past transaction between the owner and
      // this one. The full history row is written once the bytes are gone.
      await notePending({
        hash,
        owner,
        step: index + 1,
        totalSteps: steps.length,
        createdAt,
      });
      // The row the owner actually sees. It is started here rather than after
      // the broadcast, so the transaction still appears the moment it is
      // signed — but it is not waited on, because its write is the expensive
      // one and the hash it protects is already safe above. If it fails, the
      // pending file still has the hash and loadData puts the row back.
      void record({
        hash,
        status: "broadcasting",
        step: index + 1,
        totalSteps: steps.length,
        createdAt,
      }).catch(() => {});
      active();
      await client.sendRawTransaction({ serializedTransaction: serialized });
      await record({
        hash,
        status: "pending",
        step: index + 1,
        totalSteps: steps.length,
        createdAt,
      });
      if (index < steps.length - 1) {
        const receipt = await client.waitForTransactionReceipt({ hash, timeout: 90000 });
        if (receipt.status !== "success") throw new Error("An earlier step failed on chain, so the steps after it were not sent. / 前一步在链上失败，之后的步骤未发送。");
        active();
        // Minutes may have passed here, so the network is worth checking again
        // before the next step is signed against it.
        await checkChain();
      }
    }
  } finally {
    sending = false;
  }
}
export async function transactionStatus(hash: Hash) {
  try {
    return (await client.getTransactionReceipt({ hash })).status === "success"
      ? "confirmed"
      : "reverted";
  } catch {
    return "pending";
  }
}

/**
 * One reading of the network for the speed label: the newest block, timed,
 * one SAMPLE_BLOCKS older for the average block time, and the gas price.
 * A failure reads as offline rather than throwing.
 */
export async function probeNetwork() {
  try {
    const started = Date.now();
    const newest = await client.getBlock({ blockTag: "latest" });
    const latencyMs = Date.now() - started;
    const back = BigInt(speedCore.SAMPLE_BLOCKS);
    const [older, gasPriceWei] = await Promise.all([
      client
        .getBlock({ blockNumber: newest.number > back ? newest.number - back : 0n })
        .catch(() => null),
      client.getGasPrice().catch(() => null),
    ]);
    return speedCore.reading({ newest, older, latencyMs, gasPriceWei });
  } catch {
    return speedCore.offline();
  }
}

/** Where and when a transaction landed, and what it paid, or null while it has not. */
export async function confirmation(hash: Hash) {
  try {
    const receipt = await client.getTransactionReceipt({ hash });
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    return {
      block: Number(receipt.blockNumber),
      timestamp: Number(block.timestamp),
      feeWei: receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n),
      ok: receipt.status === "success",
    };
  } catch {
    return null;
  }
}
