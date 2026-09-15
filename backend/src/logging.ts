import { createHash, randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

const SENSITIVE_KEY = /(address|amount|prompt|message|calldata|(^|_)data$|txhash|actionhash|raw.?intent|prepared.?tx|portfolio|scope)/i;

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(String(value)).digest("hex").slice(0, 16)}`;
}

function redactText(value: string): string {
  return value
    .replace(/0x[a-f\d]{40,}/gi, (match) => digest(match))
    .replace(/\b\d+(?:\.\d+)?\b/g, (match) => digest(match));
}

export function redactForLog(value: unknown, key = ""): unknown {
  if (SENSITIVE_KEY.test(key)) return digest(typeof value === "string" ? value : JSON.stringify(value));
  if (value instanceof Error) return { name: value.name, message: redactText(value.message) };
  if (Array.isArray(value)) return value.map((item) => redactForLog(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactForLog(entryValue, entryKey)]));
  }
  return value;
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  req.requestId = randomUUID();
  res.setHeader("X-Request-ID", req.requestId);
  next();
}

export function logEvent(level: "warn" | "error" | "info", requestId: string | undefined, event: string, details?: unknown): void {
  const record = { requestId: requestId ?? "startup", event, ...(details === undefined ? {} : { details: redactForLog(details) }) };
  const output = JSON.stringify(record);
  if (level === "error") console.error(output);
  else if (level === "warn") console.warn(output);
  else console.info(output);
}

export const logger = {
  warn: (req: Request, event: string, details?: unknown) => logEvent("warn", req.requestId, event, details),
  error: (req: Request, event: string, details?: unknown) => logEvent("error", req.requestId, event, details),
};
