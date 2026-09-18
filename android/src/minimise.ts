// Prompt minimisation, as this app sees it.
//
// This file used to be a hand-written parallel of the web wallet's
// minimise.js. The two drifted, in the way two copies always do, and the drift
// was not cosmetic: the web version redacts call-data payloads as [DATA_n] and
// this one had no rule for them at all, so a message mentioning calldata went
// to the assistant service from a phone in full and from a browser redacted.
// Both surfaces claimed the same thing about what leaves the device, and on one
// of them the claim was false.
//
// So there is no implementation here any more. The rules live once, in
// public/tera/core/minimise.js, and this is the adapter that keeps App.tsx's
// existing imports working.

import * as core from "../../public/tera/core/minimise.js";

export type Placeholder = { token: string; kind: string; value: string };
export type MinimiseResult = {
  text: string;
  skeleton: string;
  placeholders: Placeholder[];
  kept: { kind: string; value: string }[];
};

/** Named PROPOSAL_KEEP here since App.tsx has always called it that; it is the
 * core's PROPOSE_KEEP and must never be redefined. */
export const PROPOSAL_KEEP: string[] = core.PROPOSE_KEEP;

/** Human labels per kind, which this app did not have before. */
export const KIND_LABELS: Record<string, string> = core.KIND_LABELS;

export const minimise = core.minimise as (
  text: string,
  options?: { owner?: string; keep?: string[]; labels?: string[] },
) => MinimiseResult;

export const rehydrate = core.rehydrate as (text: string, placeholders: Placeholder[]) => string;

export const residual = core.residual as (text: string, keep?: string[]) => string[];

export const keptKinds = core.keptKinds as (result: MinimiseResult) => string[];

export const summary = core.summary as (result: MinimiseResult) => string[];
