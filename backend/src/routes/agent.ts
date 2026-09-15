import { Router, type Request, type Response } from "express";
import { env } from "../env";
import { SUPPORTED_RWA_ASSETS, findAsset } from "../data/assets";
import { runGatePipeline } from "../pipeline/gates";
import { buildPreparedTransaction, UnsupportedActionError } from "../pipeline/builder";
import { type UserIntent } from "../pipeline/types";

const router = Router();

const SYSTEM_PROMPT = `
You are the Tera Wallet AI Agent Assistant on Robinhood Chain (Chain ID: 4663).
The core principle of Tera Wallet is:
"The agent formulates an intent. Tera Wallet determines whether the intent is permitted. The owner retains final authority."

Your task:
Analyze the user's natural language request regarding Real World Assets (RWAs) and tokenized assets on Robinhood Chain.
Select the most appropriate approved asset from the Robinhood Asset Registry:
${JSON.stringify(
  SUPPORTED_RWA_ASSETS.map((a) => ({
    symbol: a.symbol,
    name: a.name,
    address: a.address,
    category: a.category,
    minInvestment: `$${a.minInvestmentUsd}`,
    decimals: a.decimals,
  })),
  null,
  2
)}

Determine the intent actionType (BUY, SELL, TRANSFER, CLAIM_YIELD).
Determine the token amount in base units (e.g. 18 decimals for equities/WETH/ETH, 6 decimals for USDG).
Calculate maxSpendUsdCents (e.g. $100 = 10000 cents).

You MUST respond strictly with a valid JSON object matching this schema:
{
  "explanation": "Brief explanation of the proposed action, why this asset was chosen, and that it requires owner approval.",
  "intent": {
    "assetAddress": "0x...",
    "actionType": "BUY" | "SELL" | "TRANSFER" | "CLAIM_YIELD",
    "amount": "1000000000000000000",
    "maxSpendUsdCents": 10000
  }
}
Do not include markdown formatting or backticks around the JSON.
`;


/**
 * POST /api/agent/propose
 * Formulates a typed UserIntent from natural language, evaluates all 5 gates, and returns the prepared transaction.
 */
router.post("/api/agent/propose", async (req: Request, res: Response) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
    const unsupportedFields = Object.keys(body).filter((field) => !["prompt", "ownerAddress"].includes(field));
    if (unsupportedFields.length > 0) {
      res.status(400).json({
        success: false,
        error: "Proposal payload only accepts prompt and ownerAddress",
        unsupportedFields,
      });
      return;
    }

    const { prompt, ownerAddress } = body as { prompt?: string; ownerAddress?: string };

    if (!prompt || !ownerAddress) {
      res.status(400).json({
        success: false,
        error: "prompt and ownerAddress are required",
      });
      return;
    }

    let explanation = "Drafted supervised RWA intent proposal based on user request.";
    let intentDraft: Partial<UserIntent> = {};

    // 1. Attempt AI synthesis via Groq Qwen
    if (env.groqApiKey) {
      try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.groqApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: env.groqModel,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: prompt },
            ],
            temperature: 0.1,
            max_tokens: 500,
          }),
        });

        if (response.ok) {
          const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
          const content = data.choices?.[0]?.message?.content?.trim() ?? "";
          const cleaned = content.replace(/```json/g, "").replace(/```/g, "").trim();
          const parsed = JSON.parse(cleaned);

          if (parsed.explanation) explanation = parsed.explanation;
          if (parsed.intent) intentDraft = parsed.intent;
        }
      } catch (aiErr) {
        console.warn("Groq agent reasoning fallback to heuristic parser:", aiErr);
      }
    }

    // Heuristic fallback if LLM was skipped or failed
    if (!intentDraft.assetAddress) {
      const lowerPrompt = prompt.toLowerCase();
      let matchedAsset = findAsset("SPCX") ?? SUPPORTED_RWA_ASSETS[0];

      // Check all assets and aliases
      for (const asset of SUPPORTED_RWA_ASSETS) {
        if (
          lowerPrompt.includes(asset.symbol.toLowerCase()) ||
          lowerPrompt.includes(asset.name.toLowerCase()) ||
          (asset.underlyingTicker && lowerPrompt.includes(asset.underlyingTicker.toLowerCase()))
        ) {
          matchedAsset = asset;
          break;
        }
      }

      let action: "BUY" | "SELL" | "TRANSFER" | "CLAIM_YIELD" = "BUY";
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

      const matchNum = prompt.match(/\$?(\d+(\.\d+)?)/);
      const parsedDollars = matchNum ? parseFloat(matchNum[1]) : 100;
      const multiplier = BigInt(10) ** BigInt(matchedAsset.decimals);
      const amountUnits = (BigInt(Math.floor(parsedDollars)) * multiplier).toString();

      intentDraft = {
        assetAddress: matchedAsset.address,
        actionType: action,
        amount: amountUnits,
        maxSpendUsdCents: Math.floor(parsedDollars * 100),
      };

      explanation = `Drafted proposal to ${action} $${parsedDollars} worth of ${matchedAsset.symbol} (${matchedAsset.name}) on Robinhood Chain. Verified through deterministic compliance checks before owner signature.`;
    }


    const walletAddress = ownerAddress as `0x${string}`;
    const fullIntent: UserIntent = {
      ownerAddress: walletAddress,
      accountAddress: walletAddress,
      assetAddress: intentDraft.assetAddress as `0x${string}`,
      actionType: (intentDraft.actionType as any) ?? "BUY",
      amount: String(intentDraft.amount ?? "100000000"),
      maxSpendUsdCents: intentDraft.maxSpendUsdCents ?? 10000,
    };

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
    const preparedTransaction = buildPreparedTransaction(
      fullIntent,
      walletAddress,
      gates
    );

    res.status(200).json({
      success: true,
      explanation,
      intent: fullIntent,
      gates,
      preparedTransaction,
    });
  } catch (error) {
    if (error instanceof UnsupportedActionError) {
      res.status(501).json({
        success: false,
        error: error.message,
        action: error.action,
        supported: false,
      });
      return;
    }
    console.error("Agent proposal error:", error);
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
        reply:
          "Tera Wallet enforces private authorization for supervised RWA agents on Robinhood Chain. Every intent is strictly evaluated across 5 deterministic gates (Asset Registry, ERC-3643 Eligibility Preflight, Policy Vault, Risk Engine, and Owner Approval Controller) before any transaction is presented for your signature.",
      });
      return;
    }

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.groqApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.groqModel,
        messages: [
          {
            role: "system",
            content:
              "You are the Tera Wallet Advisor on Robinhood Chain. Explain RWA compliance, ERC-3643 standard, identity claims, and Tera Wallet's private-by-default architecture clearly and concisely.",
          },
          { role: "user", content: message },
        ],
        temperature: 0.3,
        max_tokens: 300,
      }),
    });

    if (!response.ok) {
      throw new Error(`Groq returned ${response.status}`);
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const reply = data.choices?.[0]?.message?.content ?? "No response generated";

    res.status(200).json({
      success: true,
      reply,
    });
  } catch (error) {
    console.error("Agent chat failed:", error);
    res.status(500).json({
      success: false,
      error: "Chat service unavailable",
    });
  }
});

export default router;
