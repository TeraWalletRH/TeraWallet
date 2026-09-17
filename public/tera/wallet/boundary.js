// The owner approval boundary. Every stage below is a real step that runs when
// an action is approved; the divider marks the single point where authority
// stops being Tera's and becomes the owner's key.

export const PREPARED = "prepared";
export const OWNER = "owner";

export const STAGES = [
  {
    id: "verify",
    side: PREPARED,
    label: "This wallet re-checks the prepared transaction",
    detail:
      "Recipient, amount, contract, network and the five check results are compared with what you reviewed. No network call is made.",
  },
  {
    id: "wallet",
    side: PREPARED,
    label: "Your account and network are confirmed",
    detail: "Read-only: eth_accounts and eth_chainId. Nothing is signed.",
  },
  {
    id: "contract",
    side: PREPARED,
    label: "The contract is confirmed to exist",
    detail: "Read-only: eth_getCode. Skipped for a native transfer, which has no contract.",
  },
  {
    id: "simulate",
    side: PREPARED,
    label: "The transaction is simulated",
    detail:
      "Read-only: eth_call. A token that would reject the transfer stops the action here, before you are asked for anything.",
  },
  {
    id: "gas",
    side: PREPARED,
    label: "The network fee is estimated",
    detail: "Read-only: eth_estimateGas.",
  },
  {
    id: "recheck",
    side: PREPARED,
    label: "The checks are repeated",
    detail:
      "Account, network and calldata are verified once more, in case your wallet changed while the reads were running.",
  },
  {
    id: "sign",
    side: OWNER,
    label: "You sign in your wallet",
    detail:
      "eth_sendTransaction. Tera cannot perform this step, and neither can this page. Your key is the only thing that can.",
  },
  {
    id: "confirm",
    side: OWNER,
    label: "An allowance is waited for",
    detail:
      "Only when an action needs more than one signature: the allowance must confirm on-chain before the next step is offered.",
    optional: true,
  },
  {
    id: "submitted",
    side: OWNER,
    // Not "broadcast": this chain has no peer-to-peer queue to broadcast into.
    // The transaction is handed to one sequencer, which reads it in full before
    // anyone else and decides where it lands. Calling that a broadcast made the
    // most privileged step on the path sound like the least.
    label: "The transaction is handed to the sequencer",
    detail:
      "Your wallet's provider passes it to the sequencer, which orders it. There is no public queue for a stranger to watch, and no way around that one party either. You pay the network fee. Tera learns the hash only if you choose to sync the receipt for your audit trail.",
  },
];

export const SIDE_NOTES = {
  [PREPARED]: {
    title: "Prepared — cannot move your assets",
    note: "Every call on this side is read-only. If the page or the service is wrong, this is where it is caught, and nothing has moved.",
  },
  [OWNER]: {
    title: "Yours — only your key can do this",
    note: "Authority crosses here. No part of Tera can sign for you, and no session key exists in this flow.",
  },
};

// The one place the sides change, which is the line the visualization draws.
export function boundaryIndex(stages = STAGES) {
  return stages.findIndex((stage) => stage.side === OWNER);
}

export function stagesFor({ nativeTransfer = false, steps = 1 } = {}) {
  return STAGES.filter((stage) => {
    if (stage.id === "contract" && nativeTransfer) return false;
    if (stage.id === "confirm" && steps < 2) return false;
    return true;
  });
}

export function initialProgress(stages = STAGES) {
  return Object.fromEntries(stages.map((stage) => [stage.id, "pending"]));
}

export function applyStage(progress, id, status, info = {}) {
  return {
    ...progress,
    [id]: status,
    ...(info.step ? { __step: info.step, __total: info.total } : {}),
  };
}

/**
 * Where the action has reached. `crossed` is the honest headline: until a
 * signature is requested, nothing the owner does can move value.
 */
export function progressSummary(progress, stages = STAGES) {
  const rows = stages.filter((stage) => progress[stage.id] && progress[stage.id] !== "pending");
  const failed = stages.find((stage) => progress[stage.id] === "failed");
  const crossed = stages.some(
    (stage) => stage.side === OWNER && ["running", "done", "failed"].includes(progress[stage.id]),
  );
  const submitted = progress.submitted === "done";
  if (failed)
    return {
      state: "failed",
      crossed,
      stage: failed.id,
      text:
        failed.side === OWNER
          ? "Stopped at your wallet. Nothing was submitted without your signature."
          : "Stopped before your wallet was asked for anything. No signature was requested and nothing moved.",
    };
  if (submitted)
    return {
      state: "submitted",
      crossed: true,
      stage: "submitted",
      text: "You approved it and it was broadcast.",
    };
  if (!rows.length)
    return {
      state: "idle",
      crossed: false,
      stage: null,
      text: "Not started. Nothing has been sent to your wallet.",
    };
  if (crossed)
    return {
      state: "owner",
      crossed: true,
      stage: "sign",
      text: "Your wallet has been asked to sign. The decision is yours.",
    };
  return {
    state: "preparing",
    crossed: false,
    stage: rows[rows.length - 1].id,
    text: "Running read-only checks. Your wallet has not been asked to sign anything.",
  };
}
