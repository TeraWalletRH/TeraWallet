import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  keccak256,
  type Address,
  type Hash,
} from "viem";
import { chain, RPC, sources, type Tx } from "./config";
import { currentAccount, sessionVersion } from "./storage";
import { txCheck } from "./validation";
// retryCount: 0 stays on the wallet transport used for sending a
// transaction (below) — retrying a broadcast is a real idempotency risk.
// Reading a balance has no such risk, and no retries here means a single
// transient network blip fails the whole refresh outright, which reads to
// an owner as "the transfer I received isn't showing up."
export const client = createPublicClient({
  chain,
  transport: http(RPC, { timeout: 20000, retryCount: 2 }),
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
  progress: (s: string) => void,
) {
  if (sending) throw new Error("A transaction is already in progress.");
  sending = true;
  const version = sessionVersion();
  const owner = currentAccount().address;
  const active = () => {
    // Android can briefly report background while a native surface has focus.
    // The vault session and selected account determine whether the wallet is
    // actually still available to sign. A real lock increments its version.
    if (
      version !== sessionVersion() ||
      currentAccount().address !== owner
    )
      throw new Error("Wallet locked. Review again. / 钱包已锁定，请重新审核。");
    verify();
  };
  try {
    for (let index = 0; index < steps.length; index++) {
      active();
      if ((await client.getChainId()) !== chain.id) throw new Error("RPC network mismatch.");
      const tx = steps[index];
      txCheck(tx);
      progress(`${index + 1}/${steps.length} · Checking transaction / 正在检查交易`);
      if (tx.data !== "0x" && !(await client.getCode({ address: tx.to })))
        throw new Error("Contract unavailable. / 合约不可用。");
      const simulation = await client.call({
        account: owner,
        to: tx.to,
        data: tx.data,
        value: BigInt(tx.value),
      });
      if (
        (tx.data.startsWith("0xa9059cbb") || tx.data.startsWith("0x095ea7b3")) &&
        simulation.data &&
        simulation.data !== "0x" &&
        BigInt(simulation.data) !== 1n
      )
        throw new Error("Token rejected this transaction. / 代币拒绝了该交易。");
      const wallet = createWalletClient({
        chain,
        transport: http(RPC, { timeout: 20000, retryCount: 0 }),
      });
      const request = await wallet.prepareTransactionRequest({
        account: owner,
        to: tx.to,
        data: tx.data,
        value: BigInt(tx.value),
        type: "eip1559",
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
      // Persist the deterministic hash BEFORE broadcasting. Never blindly retry
      // after a timeout: a node may have accepted the signed transaction.
      await record({
        hash,
        status: "broadcasting",
        step: index + 1,
        totalSteps: steps.length,
        createdAt: Date.now(),
      });
      active();
      progress("Submitting / 正在提交");
      await client.sendRawTransaction({ serializedTransaction: serialized });
      await record({
        hash,
        status: "pending",
        step: index + 1,
        totalSteps: steps.length,
        createdAt: Date.now(),
      });
      if (index < steps.length - 1) {
        progress("Waiting for approval confirmation / 等待授权确认");
        const receipt = await client.waitForTransactionReceipt({ hash, timeout: 90000 });
        if (receipt.status !== "success") throw new Error("Approval reverted. / 授权交易失败。");
        active();
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
