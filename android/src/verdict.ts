// Net balance delta simulation wrapper
// @ts-ignore
import { calculateNetBalanceDelta as coreCalculateDelta } from "../../public/tera/core/verdict.js";

export type NetDeltaItem = {
  asset: string;
  amount: string;
  symbol: string;
  formatted: string;
  isGas?: boolean;
};

export type NetBalanceDelta = {
  pays: NetDeltaItem[];
  receives: NetDeltaItem[];
  summary: string;
  hasDeltas: boolean;
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
