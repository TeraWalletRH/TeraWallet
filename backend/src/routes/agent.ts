import { Router, type Request, type Response } from "express";
import { isAddress, parseUnits } from "viem";
import { env } from "../env";
import { SUPPORTED_RWA_ASSETS } from "../data/assets";
import { runGatePipeline } from "../pipeline/gates";
import { buildPreparedTransaction, UnsupportedActionError } from "../pipeline/builder";
import { type UserIntent } from "../pipeline/types";
import { logger } from "../logging";
import { authorizeServiceSession, ServiceSessionAuthorizationError } from "./session";
import { savePreparedIntent } from "./intent";

const router = Router();

async function resolveRecipientTarget(target: string): Promise<{ address: `0x${string}`; tag?: string }> {
  if (target.startsWith("@")) {
    const rawTag = target.replace(/^@+/, "");
    if (process.env.NODE_ENV === "test") {
      const mockTags: Record<string, `0x${string}`> = {
        alice: "0x1111111111111111111111111111111111111111",
        bob: "0x2222222222222222222222222222222222222222",
        carol: "0x3333333333333333333333333333333333333333",
      };
      if (mockTags[rawTag.toLowerCase()]) {
        return { address: mockTags[rawTag.toLowerCase()], tag: `@${rawTag}` };
      }
    }
    try {
      const { resolveTag } = await import("../tags");
      const res = await resolveTag(rawTag);
      if (res.address && isAddress(res.address)) {
        return { address: res.address as `0x${string}`, tag: `@${rawTag}` };
      }
    } catch {
      // Fall through to error
    }
    throw new Error(`Could not resolve tag @${rawTag} to a registered wallet address.`);
  }

  if (isAddress(target)) {
    return { address: target as `0x${string}` };
  }
  throw new Error(`Invalid recipient address or tag: ${target}`);
}

/**
 * POST /api/agent/propose
 * Formulates a typed UserIntent from natural language, evaluates all 5 gates, and returns the prepared transaction.
 */
router.post("/api/agent/propose", async (req: Request, res: Response) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
    const unsupportedFields = Object.keys(body).filter((field) => !["prompt", "ownerAddress", "sessionToken"].includes(field));
    if (unsupportedFields.length > 0) {
      res.status(400).json({
        success: false,
        error: "Proposal payload only accepts prompt, ownerAddress, and an optional sessionToken",
        unsupportedFields,
      });
      return;
    }

    const { prompt, ownerAddress, sessionToken } = body as {
      prompt?: string;
      ownerAddress?: string;
      sessionToken?: string;
    };

    if (!prompt || !ownerAddress) {
      res.status(400).json({
        success: false,
        error: "prompt and ownerAddress are required",
      });
      return;
    }

    // Transaction fields are extracted from the owner's words and checked by
    // the deterministic pipeline. A language model cannot invent spend terms.
    let explanation = "";
    let intentDraft: Partial<UserIntent> = {};
    {
      const lowerPrompt = prompt.toLowerCase();
      const mentions = (word: string) => new RegExp(`\\b${word.toLowerCase()}\\b`).test(lowerPrompt);
      const matchedAsset = SUPPORTED_RWA_ASSETS.find((asset) =>
        mentions(asset.symbol) || (!!asset.underlyingTicker && mentions(asset.underlyingTicker)))
        ?? [...SUPPORTED_RWA_ASSETS].sort((a, b) => b.name.length - a.name.length).find((asset) =>
          lowerPrompt.includes(asset.name.toLowerCase()) ||
          lowerPrompt.includes(asset.name.toLowerCase().split(" (")[0]) ||
          mentions(asset.name.split(" ")[0]));

      let action: "BUY" | "SELL" | "TRANSFER" | "CLAIM_YIELD" | undefined;
      if (
        lowerPrompt.includes("buy") ||
        lowerPrompt.includes("invest") ||
        lowerPrompt.includes("allocate") ||
        lowerPrompt.includes("purchase")
      ) {
        action = "BUY";
      } else if (
        lowerPrompt.includes("sell") ||
        lowerPrompt.includes("liquidate") ||
        lowerPrompt.includes("exit")
      ) {
        action = "SELL";
      } else if (
        lowerPrompt.includes("claim") ||
        lowerPrompt.includes("harvest") ||
        lowerPrompt.includes("collect") ||
        lowerPrompt.includes("dividend")
      ) {
        action = "CLAIM_YIELD";
      } else if (lowerPrompt.includes("send") || lowerPrompt.includes("transfer")) {
        action = "TRANSFER";
      }

      let isBatchTransfer = false;
      let batchTransfers: Array<{ recipient: `0x${string}`; amount: string; tag?: string }> = [];

      if (action === "TRANSFER") {
        const pairRegex = /(?:(?:send|transfer)\s+)?(?:\$?\s*(\d+(?:\.\d+)?))\s*(?:[A-Za-z0-9_-]+)?\s+(?:to\s+)?(@[a-z0-9_]{3,20}|0x[a-fA-F0-9]{40})|(?:\$?\s*(\d+(?:\.\d+)?))\s+(?:to\s+)?(@[a-z0-9_]{3,20}|0x[a-fA-F0-9]{40})|(?:to\s+)?(@[a-z0-9_]{3,20}|0x[a-fA-F0-9]{40})\s*(?:[:,-]\s*|\s+(?:amount\s+)?)\s*(?:\$?\s*(\d+(?:\.\d+)?))/gi;
        const rawMatches = [...prompt.matchAll(pairRegex)];

        if (rawMatches.length > 1) {
          const parsedItems: Array<{ target: string; amountText: string }> = [];
          for (const m of rawMatches) {
            const amount = m[1] ?? m[3] ?? m[6];
            const target = m[2] ?? m[4] ?? m[5];
            if (amount && target) {
              parsedItems.push({ target, amountText: amount });
            }
          }

          if (parsedItems.length > 1 && matchedAsset) {
            isBatchTransfer = true;
            let totalAmountBig = 0n;
            const items: typeof batchTransfers = [];
            const summaryParts: string[] = [];

            for (const p of parsedItems) {
              let resolved;
              try {
                resolved = await resolveRecipientTarget(p.target);
              } catch (err: any) {
                res.status(422).json({ success: false, error: err?.message || `Could not resolve recipient ${p.target}` });
                return;
              }

              let units: string;
              try {
                units = parseUnits(p.amountText, matchedAsset.decimals).toString();
              } catch {
                res.status(422).json({ success: false, error: "Amount has too many decimal places for this asset." });
                return;
              }

              if (BigInt(units) <= 0n) {
                res.status(422).json({ success: false, error: "Enter an amount greater than zero." });
                return;
              }

              totalAmountBig += BigInt(units);
              items.push({
                recipient: resolved.address,
                amount: units,
                tag: resolved.tag,
              });
              summaryParts.push(`${resolved.tag ?? `${resolved.address.slice(0, 6)}...${resolved.address.slice(-4)}`}: ${p.amountText} ${matchedAsset.symbol}`);
            }

            batchTransfers = items;
            const totalUnits = totalAmountBig.toString();
            const totalFormatted = (Number(totalAmountBig) / 10 ** matchedAsset.decimals).toString();

            intentDraft = {
              assetAddress: matchedAsset.address,
              actionType: "TRANSFER",
              amount: totalUnits,
              recipient: items[0].recipient,
              transfers: items,
            };

            explanation = `You are about to batch transfer a total of ${totalFormatted} ${matchedAsset.symbol} to ${items.length} recipients (${summaryParts.join(", ")}). Review the unified transaction before signing.`;
          }
        }
      }

      if (!isBatchTransfer) {
        const withoutAddresses = prompt.replace(/0x[a-fA-F0-9]{40}/g, "")
          .replace(/@[a-z0-9_]{3,20}/gi, "")
          .replace(/\bchain(?:\s+id)?\s*[:#]?\s*\d+\b/gi, "");
        const amounts = [...withoutAddresses.matchAll(/(?:\$|\b)(\d+(?:\.\d+)?)(?![\d.])/g)];
        if (!matchedAsset || !action || amounts.length !== 1) {
          res.status(422).json({ success: false, error: "Specify an action, supported asset, and exact amount." });
          return;
        }
        const amountText = amounts[0][1];
        const inputDecimals = action === "BUY" ? (matchedAsset.symbol === "TERA" ? 18 : 6) : matchedAsset.decimals;
        let amountUnits: string;
        try { amountUnits = parseUnits(amountText, inputDecimals).toString(); }
        catch { res.status(422).json({ success: false, error: "Amount has too many decimal places for this asset." }); return; }
        if (BigInt(amountUnits) <= 0n) {
          res.status(422).json({ success: false, error: "Enter an amount greater than zero." });
          return;
        }

        let singleRecipient = prompt.match(/0x[a-fA-F0-9]{40}/)?.[0] as `0x${string}` | undefined;
        let singleTag: string | undefined;
        if (!singleRecipient && action === "TRANSFER") {
          const tagMatch = prompt.match(/@[a-z0-9_]{3,20}/i)?.[0];
          if (tagMatch) {
            try {
              const resolved = await resolveRecipientTarget(tagMatch);
              singleRecipient = resolved.address;
              singleTag = resolved.tag;
            } catch (err: any) {
              res.status(422).json({ success: false, error: err?.message || `Could not resolve tag ${tagMatch}` });
              return;
            }
          }
        }

        intentDraft = {
          assetAddress: matchedAsset.address,
          actionType: action,
          amount: amountUnits,
          maxSpendUsdCents: action === "BUY" && matchedAsset.symbol !== "TERA" ? Math.round(Number(amountText) * 100) : undefined,
          ...(action === "TRANSFER" ? { recipient: singleRecipient } : {}),
        };

        explanation = action === "BUY"
          ? `You are about to buy ${matchedAsset.symbol} using ${amountText} ${matchedAsset.symbol === "TERA" ? "ETH" : "USDG"}. Review the quote before signing.`
          : `You are about to ${action === "TRANSFER" ? "send" : action.toLowerCase()} ${amountText} ${matchedAsset.symbol}${singleTag ? ` to ${singleTag}` : ""}. Review the transaction before signing.`;
      }
    }

    const walletAddress = ownerAddress as `0x${string}`;
    const actionType = intentDraft.actionType as UserIntent["actionType"];

    if (actionType === "TRANSFER") {
      if (intentDraft.transfers && intentDraft.transfers.length > 1) {
        // Validated in batch step
      } else if (!intentDraft.recipient || !isAddress(intentDraft.recipient)) {
        res.status(422).json({
          success: false,
          error: "Transfers require a valid recipient address in the request.",
        });
        return;
      }
    }

    const fullIntent: UserIntent = {
      ownerAddress: walletAddress,
      accountAddress: walletAddress,
      assetAddress: intentDraft.assetAddress as `0x${string}`,
      actionType,
      amount: intentDraft.amount!,
      ...(intentDraft.maxSpendUsdCents !== undefined ? { maxSpendUsdCents: intentDraft.maxSpendUsdCents } : {}),
      ...(actionType === "TRANSFER"
        ? {
            recipient: intentDraft.recipient,
            ...(intentDraft.transfers ? { transfers: intentDraft.transfers } : {}),
          }
        : {}),
    };

    // A connected agent token can prepare only the action and asset selected
    // by its owner. This is an API capability check, never wallet authority.
    let sessionAuthorization;
    if (sessionToken) {
      sessionAuthorization = await authorizeServiceSession(
        sessionToken,
        fullIntent.actionType,
        fullIntent.assetAddress,
      );
      if (sessionAuthorization.accountAddress.toLowerCase() !== walletAddress.toLowerCase()) {
        res.status(403).json({
          success: false,
          error: "Session token belongs to a different wallet.",
        });
        return;
      }
    }

    // 2. Evaluate all 5 deterministic gates
    const gates = await runGatePipeline(fullIntent);
    const hasFailedGate = gates.some((g) => !g.passed);

    if (hasFailedGate) {
      const failed = gates.find((g) => !g.passed);
      res.status(422).json({
        success: false,
        error: failed?.reason ?? "Intent was blocked by a deterministic gate",
        explanation,
        intent: fullIntent,
        gates,
      });
      return;
    }

    // 3. Build prepared transaction for owner wallet execution
    const preparedTransaction = await buildPreparedTransaction(
      fullIntent,
      walletAddress,
      gates
    );
    await savePreparedIntent(fullIntent, walletAddress, preparedTransaction, gates);

    res.status(200).json({
      success: true,
      explanation,
      intent: fullIntent,
      gates,
      preparedTransaction,
      ...(sessionAuthorization ? { sessionAuthorization } : {}),
    });
  } catch (error) {
    if (error instanceof ServiceSessionAuthorizationError) {
      res.status(error.status).json({ success: false, error: error.message });
      return;
    }
    if (error instanceof UnsupportedActionError) {
      const status = error.action === "SWAP_QUOTE_RPC_UNAVAILABLE" ? 503 : error.action.startsWith("SWAP") ? 422 : 501;
      res.status(status).json({
        success: false,
        error: error.message,
        action: error.action,
        supported: false,
        quoteUnavailable: error.action.startsWith("SWAP"),
      });
      return;
    }
    logger.error(req, "agent.proposal_failed", error);
    res.status(500).json({
      success: false,
      error: "Internal server error during agent proposal generation",
    });
  }
});

/**
 * POST /api/agent/chat
 * General RWA compliance and advisory assistant explaining ERC-3643, Robinhood Chain, and limits.
 */
router.post("/api/agent/chat", async (req: Request, res: Response) => {
  try {
    const { message } = req.body;
    if (!message) {
      res.status(400).json({ success: false, error: "message is required" });
      return;
    }

    if (!env.groqApiKey) {
      res.status(200).json({
        success: true,
        reply: "I can explain a transaction or prepare a proposal. Tell me the asset, amount, and action; you review before signing.",
      });
      return;
    }

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.groqApiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        model: env.groqModel,
        messages: [
          {
            role: "system",
            content:
              "You are Tera Wallet's concise assistant. Answer the exact question in one or two short sentences, at most 45 words. Use plain language. For transaction risk, distinguish verified facts from unknowns. Never claim to have checked a wallet, recipient, contract, gas, route, or quote unless that data is supplied. Suggest one practical next step only when useful. Never claim a transaction is safe or approved.",
          },
          { role: "user", content: message },
        ],
        temperature: 0.3,
        max_tokens: 100,
      }),
    });

    if (!response.ok) {
      throw new Error(`Groq returned ${response.status}`);
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const generated = (data.choices?.[0]?.message?.content ?? "I couldn't answer just now.").trim();
    const words = generated.replace(/[#*`]/g, "").split(/\s+/);
    const reply = words.slice(0, 45).join(" ");

    res.status(200).json({
      success: true,
      reply,
    });
  } catch (error) {
    logger.error(req, "agent.chat_failed", error);
    res.status(200).json({
      success: true,
      reply: "I couldn't answer just now. Try again, or prepare a proposal to see the wallet's checks before signing.",
    });
  }
});

export default router;
