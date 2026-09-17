// The inference runtime for the on-device assistant engine.
//
// This is the one vendor bundle the engine needs. It is kept separate from
// `public/tera/wallet/engine.worker.js` on purpose: the worker holds the logic
// an owner should be able to read and is covered by the build manifest, and
// this holds transformers.js, which is not something anyone is going to audit
// in a browser tab.
//
// Every path below is on this origin. That is the entire point of the build:
// transformers.js would happily fetch weights from a model hub and its
// WebAssembly runtime from a CDN, and either one would put a party on the
// egress panel that the assistant is supposed to be removing. `allowRemoteModels`
// is off so a missing local file fails loudly instead of silently reaching out.

import { env, pipeline, type TextGenerationPipeline } from "@huggingface/transformers";

/** Where `bun run build:model` puts the weights and the ONNX Runtime binaries. */
export const MODEL_BASE = "/tera/model/";
export const MODEL_ID = "smollm2-135m-instruct";

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = MODEL_BASE;
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = `${MODEL_BASE}ort/`;
// Threads need cross-origin isolation, which this page does not have and should
// not need. One thread is slower and works everywhere.
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;

export interface LoadProgress {
  file?: string;
  loaded?: number;
  total?: number;
  status?: string;
}

let generator: TextGenerationPipeline | null = null;

/** Build the pipeline from the local files. Repeated calls reuse the first one. */
export async function load(onProgress?: (progress: LoadProgress) => void) {
  if (generator) return;
  generator = (await pipeline("text-generation", MODEL_ID, {
    dtype: "q8",
    device: "wasm",
    progress_callback: (progress: LoadProgress) => onProgress?.(progress),
  })) as TextGenerationPipeline;
}

export function ready() {
  return generator !== null;
}

export interface Turn {
  messages: { role: string; content: string }[];
  maxNewTokens: number;
}

export async function generate(turn: Turn): Promise<string> {
  if (!generator) throw new Error("The on-device model has not been loaded.");
  const output = await generator(turn.messages as never, {
    max_new_tokens: turn.maxNewTokens,
    do_sample: false,
    return_full_text: false,
  });
  const first = Array.isArray(output) ? output[0] : output;
  const generated = (first as { generated_text?: unknown })?.generated_text;
  if (typeof generated === "string") return generated.trim();
  if (Array.isArray(generated)) {
    const last = generated.at(-1) as { content?: string } | undefined;
    if (last?.content) return String(last.content).trim();
  }
  throw new Error("The on-device model returned nothing readable.");
}

/** Release the pipeline and its memory. Used by the wipe control. */
export async function unload() {
  await generator?.dispose?.();
  generator = null;
}
