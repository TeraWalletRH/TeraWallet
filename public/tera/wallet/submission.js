// Where an approved transaction actually goes, and who sees it on the way.
//
// This module exists because the obvious feature here would have been wrong.
// The plan was to offer private submission — Flashbots Protect, or a similar
// MEV-protected route — so that an approved proposal is not visible in a public
// mempool before it is included. On this chain there is no public mempool to be
// visible in, and those services do not serve it. Shipping a toggle for them
// would have produced a control that changes nothing and a claim that is false.
//
// What is true is less comfortable and worth saying plainly: an Arbitrum Orbit
// chain is ordered by a sequencer, and "no public mempool" does not mean nobody
// sees the transaction early. It means exactly one party does, exclusively,
// before anyone else, and that party decides the order. Replacing a crowd of
// searchers with a single privileged observer is a different trust model, not
// the absence of one.
//
// So this describes the path instead of pretending to change it. Everything the
// owner cannot move is named as something they cannot move, with the reason.

/** How a chain decides what happens next, which is what sets who sees a transaction first. */
export const MODELS = {
  // One sequencer orders transactions first-come, first-served. Robinhood Chain
  // and every other Arbitrum Orbit chain work this way.
  sequenced: {
    id: "sequenced",
    label: "Ordered by a sequencer",
    summary:
      "Transactions go straight to a sequencer, which puts them in order as they arrive. There is no public queue for anyone else to watch.",
    // The correction this module exists to make.
    correction:
      "This is often described as protection from front-running, and against a crowd of strangers it is. It is not privacy. One party sees your transaction before anyone else, in full, and decides where it lands in the order. Nothing here stops that party doing what a public queue would have let everyone do.",
  },
  // A peer-to-peer mempool, as on Ethereum mainnet. Kept so the panel stays
  // correct if this wallet is ever pointed at such a chain, rather than
  // describing the chain it was written for and getting the other one wrong.
  publicMempool: {
    id: "publicMempool",
    label: "Broadcast to a public mempool",
    summary:
      "Transactions are broadcast to a peer-to-peer network and sit in a public queue until a block builder includes one. Anyone can read that queue.",
    correction:
      "Every pending transaction is visible to anyone who looks, which is what makes front-running and sandwiching possible. A private submission route is worth having on a chain like this.",
  },
};

/** What an owner is owed about the submission path before it is described to them. */
export const SUBMISSION_LIMITS = [
  "Nothing in this wallet makes a confirmed transaction private. Once it is ordered, the sender, recipient, asset and amount are public and permanent.",
  "Your wallet extension's own provider sees the transaction before the chain does. Moving balance reads to your own endpoint did not move this, and it cannot be moved from a web page.",
  "MEV-protection services such as Flashbots Protect are Ethereum mainnet infrastructure. They do not serve this chain, so this wallet does not offer them: a control that changes nothing would be worse than none.",
];

/**
 * Why submission cannot be pointed somewhere else from a page like this one.
 *
 * It is a real technical limit rather than a decision, and it is stated as such
 * so nobody reading this later mistakes it for something still to be built.
 */
export const WHY_FIXED =
  "A browser wallet signs and sends in a single step: eth_sendTransaction does both, and wallet extensions do not expose eth_signTransaction to a page. There is no signed transaction for this wallet to hand anywhere else, so the route is your wallet's to choose, not this page's.";

const hop = (id, name, when, learns, note, extra = {}) => ({
  id,
  name,
  when,
  learns,
  note,
  ...extra,
});

/**
 * The ordered path an approved transaction takes.
 *
 * `receiptSync` is whether the owner has chosen to send the hash to Tera for
 * their audit trail; it is the one hop on this list that is optional, and it is
 * marked so rather than being left out when it is off.
 */
export function describeSubmission({
  model = "sequenced",
  chainId = 4663,
  chainName = "Robinhood Chain",
  sequencerHost = "",
  explorerHost = "",
  receiptSync = false,
} = {}) {
  const chosen = MODELS[model] || MODELS.sequenced;
  const sequenced = chosen.id === "sequenced";
  const hops = [
    hop(
      "wallet-provider",
      "Your wallet extension's provider",
      "First, the moment you approve",
      [
        "The whole signed transaction, before anything else sees it",
        "That it came from you, and from the network address you are on",
      ],
      "Chosen in your wallet extension, not here. This page cannot see which provider it is, and cannot send the transaction anywhere else — see the note below.",
      { movable: false },
    ),
    sequenced
      ? hop(
          "sequencer",
          `${chainName} sequencer`,
          "Next, before anyone else",
          [
            "The whole transaction, exclusively, before it is public",
            "Where it lands in the order, which it decides",
            "That this transaction and your earlier ones came from the same account",
          ],
          "A single party with no public queue to check it against. This wallet cannot route around it: it is how the chain is ordered.",
          { host: sequencerHost, movable: false, privileged: true },
        )
      : hop(
          "mempool",
          "The public mempool",
          "Next, while it waits to be included",
          [
            "The whole transaction, readable by anyone watching",
            "Enough time to place another transaction in front of yours",
          ],
          "On a chain with a public queue this is where a private submission route would help. This one does not have such a queue.",
          { movable: true },
        ),
    hop(
      "ledger",
      `${chainName} itself`,
      "Once it is ordered",
      [
        "Sender, recipient, asset, amount and time",
        "The link between this transaction and every other one from the same address",
      ],
      "Public and permanent. No setting in this wallet changes what the ledger records.",
      { movable: false, permanent: true },
    ),
  ];
  if (explorerHost)
    hops.push(
      hop(
        "explorer",
        "Block explorer",
        "Only if you open the link",
        ["The network address you are on", "Which transaction you looked at, which ties it to you"],
        "Nothing reaches it until you click through. Copy the hash and look it up elsewhere to avoid it.",
        { host: explorerHost, movable: true, onDemand: true },
      ),
    );
  hops.push(
    hop(
      "tera-receipt",
      "Tera, for your audit trail",
      receiptSync ? "After it confirms, because you turned this on" : "Not at all, unless you ask",
      receiptSync
        ? ["The transaction hash and the action it settles", "That the action reached the chain"]
        : ["Nothing. The receipt stays on this device."],
      receiptSync
        ? "You can stop syncing receipts at any time. What was already sent stays sent."
        : "Receipts are reconciled locally. Tera is told only if you choose to sync one.",
      { movable: true, optional: true, active: receiptSync },
    ),
  );
  return {
    model: chosen,
    chainId,
    chainName,
    sequenced,
    hops,
    // Counted rather than asserted, so the headline cannot drift from the list.
    privileged: hops.filter((entry) => entry.privileged).length,
    // Parties the transaction must pass through that the owner could send it
    // somewhere else instead. A hop that is only reached on demand, or only when
    // the owner opts in, is avoidable rather than movable, and counting it here
    // would overstate how much of this path is in the owner's hands.
    movable: hops.filter((entry) => entry.movable && !entry.optional && !entry.onDemand).length,
    limits: SUBMISSION_LIMITS,
    whyFixed: WHY_FIXED,
  };
}
