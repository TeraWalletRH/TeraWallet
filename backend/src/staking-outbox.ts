/** Allowed payout state changes. Signed bytes are durable before any broadcast. */
export type PayoutStatus = 'requested' | 'signed' | 'broadcast' | 'confirmed' | 'failed';
const transitions: Record<PayoutStatus, PayoutStatus[]> = {
  requested: ['signed', 'failed'], signed: ['broadcast', 'failed'], broadcast: ['confirmed', 'failed'], confirmed: [], failed: ['signed'],
};
export function canTransition(from: PayoutStatus, to: PayoutStatus) { return transitions[from].includes(to); }
export function payoutTotal(principal: bigint, reward: bigint) {
  const total = principal + reward;
  if (total <= 0n) throw new Error('Payout must have a positive amount.');
  return total;
}
export function payoutAuthorizationMessage(action: 'claim' | 'unstake', wallet: string, epochId: string, amount: string, idempotencyKey: string) {
  return `Tera staking ${action}\nWallet: ${wallet.toLowerCase()}\nEpoch: ${epochId}\nAmount: ${amount}\nRequest: ${idempotencyKey}`;
}

export function lockPayoutAuthorizationMessage(wallet: string, lockId: string, amount: string, idempotencyKey: string) {
  return `Tera fixed staking unlock\nWallet: ${wallet.toLowerCase()}\nLock: ${lockId}\nAmount: ${amount}\nRequest: ${idempotencyKey}`;
}

