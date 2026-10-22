// Net balance delta simulation wrapper
// @ts-ignore
import { calculateNetBalanceDelta as coreCalculateDelta } from "../../public/tera/core/verdict.js";

export type NetDeltaItem = {
  asset: string;
  amount: string;
  symbol: string;
  formatted: string;
  isGas?: boolean;
  /** Its dollar value, when it's a token the wallet knows and has a price for. */
  usd?: number;
  /** A token the wallet doesn't know (core/balance-changes.js). */
  unknown?: boolean;
};

export type NetBalanceDelta = {
  pays: NetDeltaItem[];
  receives: NetDeltaItem[];
  summary: string;
  hasDeltas: boolean;
  /** Permissions the transaction gives, in words. */
  approvals?: string[];
  unknownToken?: boolean;
  /** "chain": the network's simulation of every step; otherwise read from the review. */
  source?: "chain" | "estimate";
};

export function calculateNetBalanceDelta(opts: any): NetBalanceDelta {
  try {
    return coreCalculateDelta(opts) as NetBalanceDelta;
  } catch {
    return {
      pays: [],
      receives: [],
      summary: "",
      hasDeltas: false,
    };
  }
}
