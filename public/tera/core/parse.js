// Deterministic answering, ahead of any model.
//
// Most of what an owner asks this wallet has an exact answer that already
// exists in the code: what the policy check evaluates is a field in
// `checks.js`, what the relay learns is a line in `ohttp.js`, what a wipe
// cannot reach is a list in `wipe.js`. Those strings are written carefully,
// reviewed, and tested. Handing the same question to a language model replaces
// them with a paraphrase that is at best as good and cannot be checked.
//
// So this runs first. A matched question is answered from the module that
// defines the truth, and the answer names that module so the owner can go and
// read it. Nothing is generated, nothing is sent, and nothing can drift: if
// someone edits `GATE_EXPLANATIONS`, the answer changes with it.
//
// Three rules hold this together, and each one is a test:
//
//   It never guesses. A pattern either matches or it does not. There is no
//   score to tune and no threshold to creep downwards, because the failure of a
//   confident wrong answer is much worse here than the failure of no answer.
//
//   It never answers about the owner's own data. "What is my balance" is not a
//   question this can answer — it has no balance — so it is not in the grammar
//   at all, and falls through to an engine that can say so.
//
//   It never produces a transaction. The most it will do with "send 50 USDG to
//   0x…" is carry the parts into the proposal composer for the owner to submit
//   themselves, through the same five checks as anything else.

export const ANSWER = "answer";
export const NAVIGATE = "navigate";
export const COMPOSE = "compose";
export const NONE = "none";

const list = (items) => items.map((item) => `- ${item}`).join("\n");

/**
 * The grammar.
 *
 * Every topic states which module it reads from, so the citation under an
 * answer is derived rather than written twice. `build` receives the live
 * exports; it never holds a copy of the text it quotes.
 *
 * ORDER IS PRECEDENCE, and it is load-bearing. These topics share vocabulary:
 * "what does the policy check do" matches the five-check summary as readily as
 * the single-check answer, and "the owner approval boundary" matches the
 * approval check. The most specific reading is listed first in each case, so a
 * question is answered as narrowly as it was asked.
 */
export const TOPICS = [
  {
    id: "boundary",
    module: "boundary.js",
    patterns: [
      /\b(?:approval|owner)\s+boundary\b/i,
      /\bwhat happens when i (?:approve|sign)\b/i,
      /\bwho can (?:sign|move)\b.{0,20}\b(?:for me|my (?:funds|assets))\b/i,
      /\bcan tera (?:sign|move|spend)\b/i,
    ],
    build: ({ stages, sideNotes, owner }) => ({
      title: "The owner approval boundary",
      body: `${list(stages.map((stage) => `${stage.label}${stage.side === owner ? " — **your key**" : ""}`))}\n\n**${sideNotes[owner].title}.** ${sideNotes[owner].note}`,
    }),
  },
  {
    id: "gate",
    module: "checks.js",
    // Resolved to a specific gate by `gateFor` below, so a question about one
    // check is not answered with the summary of all five.
    patterns: [
      /\b(?:what|how)\b.{0,40}\b(?:build anchor|asset registry|eligibility|preflight|policy check|policy gate|risk check|risk engine|owner approval|approval controller)\b/i,
      /\b(?:build anchor|asset registry|eligibility preflight|policy check|risk check|owner approval)\b.{0,20}\b(?:do|does|mean|check|evaluate)/i,
    ],
    build: ({ gateLabels, gateExplanations }, slots) => {
      const gate = slots.gate;
      const detail = gateExplanations[gate];
      return {
        title: gateLabels[gate],
        body: `**What it evaluates.** ${detail.rule}\n\n**Who evaluates it.** ${detail.evaluatedBy}\n\n**What it is given.** ${detail.inputs.join(", ")}\n\n**What is withheld from it.** ${detail.withheld.join(", ")}\n\n**What a pass does not mean.** ${detail.meaning}`,
      };
    },
  },
  {
    id: "gates",
    module: "checks.js",
    patterns: [
      /\b(?:what|which)\b.{0,30}\b(?:checks?|gates?)\b/i,
      /\bfive\s+(?:checks?|gates?)\b/i,
      /\bhow\b.{0,20}\bchecked\b/i,
    ],
    build: ({ gateLabels, gateExplanations, gates }) => ({
      title: "The five checks",
      body: `Every prepared action passes the same five checks, in order. Each one can only narrow what is allowed; nothing the assistant writes can widen it.\n\n${list(
        gates.map(
          (gate, index) => `${index + 1}. **${gateLabels[gate]}** — ${gateExplanations[gate].rule}`,
        ),
      )}\n\nThe last one is the boundary: nothing executes until you sign it in your own wallet.`,
    }),
  },
  {
    id: "minimise",
    module: "minimise.js",
    patterns: [
      /\bprompt minimisation\b/i,
      /\bminimis[ez]\b/i,
      /\bwhat (?:is|gets) (?:replaced|removed)\b.{0,30}\b(?:message|prompt)\b/i,
    ],
    build: ({ kindLabels, proposeKeep }) => ({
      title: "Prompt minimisation",
      body: `Before an assistant message is sent, these are replaced with placeholders on this device, and the reply is re-hydrated here so you read your own values back:\n\n${list(
        Object.values(kindLabels),
      )}\n\nPreparing a proposal keeps ${proposeKeep.map((kind) => kindLabels[kind].toLowerCase()).join(", ")} as typed, because Tera reads them out of the text to build the transaction you review. A question keeps none of them.\n\nIt removes the values, not the context. It does not make you anonymous.`,
    }),
  },
  {
    id: "oblivious",
    module: "ohttp.js",
    patterns: [
      /\boblivious\b/i,
      /\bohttp\b/i,
      /\b(?:ip|network) address\b.{0,40}\b(?:hidden|see|know|learn)/i,
      /\bwho sees my (?:ip|network address)\b/i,
    ],
    build: ({ ohttpLimits }) => ({
      title: "Oblivious HTTP",
      body: `A request is sealed to Tera's gateway key in this browser and handed to a relay someone else runs. The relay has your network address and a blob it cannot read; Tera has the request and a connection from the relay. Neither holds both halves.\n\n${list(ohttpLimits)}`,
    }),
  },
  {
    id: "engine",
    module: "engine.js",
    patterns: [
      /\bon[-\s]?device\b/i,
      /\b(?:local|offline)\s+(?:model|assistant|engine)\b/i,
      /\bruns? (?:in|on) (?:my|this) (?:browser|tab|device)\b/i,
    ],
    build: ({ engineLimits }) => ({
      title: "The on-device engine",
      body: `A small model can run in this tab, so a question is answered without any request being made. It is opt-in because the weights are a large one-time download from this site.\n\nWhat it cannot do:\n\n${list(engineLimits)}`,
    }),
  },
  {
    id: "submission",
    module: "submission.js",
    patterns: [
      /\bmempool\b/i,
      /\bfront[-\s]?run/i,
      /\bsequencer\b/i,
      /\bwho sees my transaction\b/i,
      /\b(?:mev|sandwich)\b/i,
    ],
    build: ({ submissionModel, submissionLimits, whyFixed }) => ({
      title: "Where an approved transaction goes",
      body: `**${submissionModel.label}.** ${submissionModel.summary}\n\n${submissionModel.correction}\n\n${list(submissionLimits)}\n\n${whyFixed}`,
    }),
  },
  {
    id: "vault",
    module: "vault.js",
    patterns: [
      /\bencrypted (?:local )?(?:vault|storage)\b/i,
      /\bwhat (?:is|does) (?:the )?vault\b/i,
      /\bwhere (?:are|is) my drafts? (?:stored|kept)\b/i,
    ],
    build: () => ({
      title: "The encrypted local vault",
      body: `Drafts, device-side transaction records, bridge tracking, personal presets and proposal version history are encrypted in this browser. The key is derived from a wallet signature plus a random salt and an epoch, so it can be retired and replaced, and an optional passphrase is run through PBKDF2 on top.\n\nUnlocking signs a local storage message only. It does not approve a transaction and it does not send a key to Tera. The passphrase protects this browser's copy; it is not a second factor for anything Tera holds.`,
    }),
  },
  {
    id: "recovery",
    module: "recovery.js",
    patterns: [
      /\brecovery (?:shares?|set|file)\b/i,
      /\bshamir\b/i,
      /\bsecond device\b/i,
      /\bhow do i (?:export|move|restore)\b.{0,25}\bvault\b/i,
    ],
    build: () => ({
      title: "Recovery shares and export",
      body: `An export bundle is the vault encrypted under a passphrase you type — whoever has the file and the passphrase has the contents, so the passphrase is the whole protection.\n\nA recovery set encrypts the same contents under a random key and splits that key into shares; any threshold of them rebuilds it. Fewer than the threshold reveal nothing.\n\nNeither recovers the wallet itself. They recover what this browser stored. And the share holders are people: any threshold of them, acting together, open the vault without you. Nothing here stops that, detects it, or tells you it happened.`,
    }),
  },
  {
    id: "wipe",
    module: "wipe.js",
    patterns: [
      /\bwipe\b/i,
      /\bdelete everything\b/i,
      /\bclear (?:my )?(?:data|browser|storage)\b/i,
    ],
    build: ({ wipeLimits }) => ({
      title: "Wiping this browser",
      body: `One control destroys every local artefact this site has stored, across every account this browser has held, and rescans afterwards to report what is left rather than assuming the removals worked. The cached on-device model goes with it.\n\nWhat a wipe cannot reach:\n\n${list(wipeLimits)}`,
    }),
  },
  {
    id: "balances",
    module: "endpoint.js",
    patterns: [
      /\bwho (?:sees|knows) (?:my|which) (?:balances?|addresses?)\b/i,
      /\b(?:own|custom|personal) (?:rpc|endpoint|node)\b/i,
      /\bhow are balances read\b/i,
    ],
    build: ({ readMethods }) => ({
      title: "How balances are read",
      body: `By default every balance is read through your wallet extension's own network provider, which means that provider learns every address you look at. Balances are never sent to Tera.\n\nPointing those reads at your own node, or an endpoint you chose, moves that knowledge to a party you picked — it does not make it disappear. More than one endpoint means each account is read by a different operator, so no single one sees the whole set.\n\nOnly reads go there: ${readMethods.join(", ")}. Signing, simulation, gas estimation and receipts stay with your wallet, because what the wallet signs must be what the wallet saw.`,
    }),
  },
  {
    id: "local",
    module: "privacy.js",
    patterns: [
      /\bwhat (?:never )?leaves (?:my|this) (?:device|browser|computer)\b/i,
      /\bwhat (?:do|does) (?:you|tera) (?:see|get|receive|know)\b/i,
      /\bwhat (?:is|gets) sent to tera\b/i,
    ],
    build: ({ localOnly }) => ({
      title: "What never leaves this device",
      body: list(localOnly.map((item) => `**${item.label}** — ${item.detail}`)),
    }),
  },
];

/** Pages this wallet has, and the words an owner uses for them. */
export const DESTINATIONS = [
  { page: "approvals", patterns: [/\bapprovals?\b/i, /\bpending (?:actions?|proposals?)\b/i] },
  // Listed before "policy" so "show me the privacy policy" lands on the panel
  // an owner is asking for rather than on their spending limits.
  { page: "privacy", patterns: [/\bprivacy\b/i] },
  { page: "receipts", patterns: [/\breceipts?\b/i] },
  { page: "sessions", patterns: [/\b(?:agent )?sessions?\b/i, /\bsession tokens?\b/i] },
  { page: "policy", patterns: [/\b(?:private )?policy\b/i, /\bmy limits\b/i, /\bpresets?\b/i] },
  { page: "bridge", patterns: [/\bbridge\b/i] },
  { page: "assets", patterns: [/\basset registry\b/i, /\bassets?\b/i] },
  { page: "settings", patterns: [/\bsettings\b/i] },
];

const GATE_WORDS = [
  // Gate zero first. It is the check on the wallet rather than on the action, and it is
  // the one whose name shares words with the summary question — the specific check has to
  // win over the general one, or "what does the build anchor check?" is answered with a
  // list of five other things.
  // The name is spelled out rather than imported, as the five below are: this module
  // answers from whatever `gateExplanations` it is handed and deliberately imports
  // nothing. `anchor.js` exports the same string as GATE_ZERO.
  [/\bbuild anchor\b/i, "build_anchor"],
  [/\basset registry\b/i, "asset_registry"],
  [/\b(?:eligibility|preflight)\b/i, "eligibility_preflight"],
  [/\bpolicy\b/i, "policy_vault"],
  [/\brisk\b/i, "risk_engine"],
  [/\b(?:owner )?approval\b/i, "approval_controller"],
];

function gateFor(message) {
  const found = GATE_WORDS.find(([pattern]) => pattern.test(message));
  return found ? found[1] : "";
}

/** Anything asking about the owner's own holdings. Deliberately unanswerable. */
const ABOUT_MY_DATA =
  /\b(?:my|our)\s+(?:balances?|holdings?|portfolio|positions?|funds?|money)\b|\bhow much (?:do i|have i)\b|\bwhat(?:'s| is) my balance\b/i;

// The symbol is optional, and its lookahead lives inside the optional group so
// that "pay 1,250 to 0x…" skips the group rather than reading "to" as an asset.
const TRANSFER =
  /\b(?:send|transfer|pay)\s+([\d,]+(?:\.\d+)?)(?:\s*(?!to\b)([A-Za-z]{2,6})\b)?\s*(?:to\s+)?(0x[\da-fA-F]{40})\b/i;

// The same sentence with a tag in place of the address. Both "to" and the "@"
// are required, where the address form makes "to" optional: an address is
// unmistakable and a bare word is not, and this module does not guess. So
// "send 50 usdg to @astra" is a transfer and "send 50 usdg to astra" is not.
//
// It yields `recipientTag`, never `recipient`. Turning a name into an address
// is a network call against the registry, and the rule at the top of this file
// is that nothing here resolves, fetches or produces a transaction — the
// composer does that, in front of the owner, and shows them both.
const TRANSFER_TAG =
  /\b(?:send|transfer|pay)\s+([\d,]+(?:\.\d+)?)(?:\s*(?!to\b)([A-Za-z]{2,6})\b)?\s*to\s+@([a-z][a-z0-9_]{1,18}[a-z0-9])\b/i;

const NAVIGATION = /\b(?:open|show|go to|take me to|where (?:is|are))\b/i;

/**
 * Read a message. Returns what kind of thing it is and, for an answer, which
 * topic — never the text, which `respond` builds from live module data.
 *
 * `matched` is binary on purpose. A parser that reports 0.7 confidence invites
 * someone to lower the threshold later, and the whole value of this layer is
 * that its answers are exactly right or absent.
 */
export function parse(message) {
  const text = String(message ?? "").trim();
  if (!text) return { kind: NONE, matched: false };

  // Asked before anything else: a question about the owner's own money must
  // never be caught by a topic pattern that happens to share a word with it.
  if (ABOUT_MY_DATA.test(text))
    return {
      kind: NONE,
      matched: false,
      reason: "This is about your own holdings, which nothing on this device can answer.",
    };

  const transfer = text.match(TRANSFER);
  if (transfer)
    return {
      kind: COMPOSE,
      matched: true,
      slots: {
        amount: transfer[1].replace(/,/g, ""),
        symbol: (transfer[2] || "").toUpperCase(),
        recipient: transfer[3],
      },
    };

  const tagged = text.match(TRANSFER_TAG);
  if (tagged)
    return {
      kind: COMPOSE,
      matched: true,
      slots: {
        amount: tagged[1].replace(/,/g, ""),
        symbol: (tagged[2] || "").toUpperCase(),
        recipientTag: tagged[3].toLowerCase(),
      },
    };

  if (NAVIGATION.test(text)) {
    const destination = DESTINATIONS.find((entry) =>
      entry.patterns.some((pattern) => pattern.test(text)),
    );
    if (destination) return { kind: NAVIGATE, matched: true, page: destination.page };
  }

  for (const topic of TOPICS) {
    if (!topic.patterns.some((pattern) => pattern.test(text))) continue;
    if (topic.id === "gate") {
      const gate = gateFor(text);
      // A question that matched the single-gate shape without naming a gate is
      // better served by the summary of all five than by a guess at which one.
      if (!gate) continue;
      return { kind: ANSWER, matched: true, topic: topic.id, slots: { gate } };
    }
    return { kind: ANSWER, matched: true, topic: topic.id, slots: {} };
  }
  return { kind: NONE, matched: false };
}

/**
 * Build the answer from the live exports.
 *
 * `sources` is passed in rather than imported so this module holds no copy of
 * any wallet text. If a limit is reworded in `ohttp.js`, the answer here is
 * reworded too, and no test has to remember to notice.
 */
export function respond(parsed, sources) {
  if (parsed?.kind !== ANSWER) return null;
  const topic = TOPICS.find((entry) => entry.id === parsed.topic);
  if (!topic) return null;
  const { title, body } = topic.build(sources, parsed.slots || {});
  return {
    title,
    body,
    module: topic.module,
    // What the owner is being told about where this came from. It is a
    // stronger claim than a model answer, not a weaker one, and it says so.
    note: `Answered from this wallet's own ${topic.module}, on this device. No model was used and no request was made, so this is the same text the panels show — not a summary of it.`,
  };
}
