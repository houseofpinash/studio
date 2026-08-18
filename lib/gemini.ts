// Shared model-calling logic used by both /api/generate (garment shots) and
// /api/generate-house-models (one-time model portrait generation).

export const MODEL_CHAIN = [
  process.env.GEMINI_MODEL || "gemini-3-pro-image",
  process.env.GEMINI_FALLBACK_MODEL || "gemini-2.5-flash-image",
].filter((m, i, arr) => arr.indexOf(m) === i);

export const IMAGE_SIZE = process.env.GEMINI_IMAGE_SIZE || "2K";
export const IMAGE_ASPECT_RATIO = "3:4";

export type InlinePart = { inlineData: { mimeType: string; data: string } };
type GeminiPart = {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
};

export async function fileToInlinePart(file: File): Promise<InlinePart> {
  const buf = Buffer.from(await file.arrayBuffer());
  return {
    inlineData: {
      mimeType: file.type || "image/jpeg",
      data: buf.toString("base64"),
    },
  };
}

export function dataUrlToInlinePart(dataUrl: string): InlinePart {
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  return {
    inlineData: {
      mimeType: match?.[1] || "image/png",
      data: match?.[2] || "",
    },
  };
}

const CALL_TIMEOUT_MS = 30_000;

// gemini-2.5-flash-image (the original Nano Banana) doesn't document support
// for imageConfig.imageSize/aspectRatio the way the newer models do — sending
// it anyway risks an internal error on Google's side. Only the newer models
// get the HD/aspect-ratio config; the older one gets a plain request.
const MODELS_SUPPORTING_IMAGE_CONFIG = new Set([
  "gemini-3-pro-image",
  "gemini-3.1-flash-image",
]);

async function callModel(
  apiKey: string,
  model: string,
  referenceParts: InlinePart[],
  promptText: string
) {
  const body: {
    contents: { role: string; parts: unknown[] }[];
    generationConfig?: { imageConfig: { imageSize: string; aspectRatio: string } };
  } = {
    contents: [
      {
        role: "user",
        parts: [...referenceParts, { text: promptText }],
      },
    ],
  };

  if (MODELS_SUPPORTING_IMAGE_CONFIG.has(model)) {
    body.generationConfig = {
      imageConfig: {
        imageSize: IMAGE_SIZE,
        aspectRatio: IMAGE_ASPECT_RATIO,
      },
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      }
    );
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `${model} timed out after ${CALL_TIMEOUT_MS / 1000}s (no response).`
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`${model} error (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const candidate = data?.candidates?.[0];
  const parts: GeminiPart[] = candidate?.content?.parts || [];
  const imagePart = parts.find((p) => p.inlineData?.data);

  if (!imagePart?.inlineData?.data) {
    const textPart = parts.find((p) => p.text)?.text;
    const finishReason = candidate?.finishReason;
    const promptFeedback = data?.promptFeedback?.blockReason;
    const safetyRatings = candidate?.safetyRatings
      ?.filter((r: { probability?: string }) => r.probability && r.probability !== "NEGLIGIBLE")
      ?.map((r: { category?: string; probability?: string }) => `${r.category}:${r.probability}`)
      ?.join(", ");

    const diagnostics = [
      finishReason ? `finishReason=${finishReason}` : null,
      promptFeedback ? `blockReason=${promptFeedback}` : null,
      safetyRatings ? `safety=[${safetyRatings}]` : null,
    ]
      .filter(Boolean)
      .join(" ");

    throw new Error(
      textPart ||
        (diagnostics
          ? `${model} returned no image (${diagnostics}).`
          : `${model} returned no image. Raw response: ${JSON.stringify(data).slice(0, 500)}`)
    );
  }

  return `data:${imagePart.inlineData.mimeType || "image/png"};base64,${imagePart.inlineData.data}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientError(err: Error) {
  return (
    /\b503\b/.test(err.message) ||
    /UNAVAILABLE/i.test(err.message) ||
    /\b500\b/.test(err.message) ||
    /\bINTERNAL\b/i.test(err.message) ||
    /IMAGE_OTHER/i.test(err.message) ||
    /finishReason=OTHER\b/i.test(err.message)
  );
}

const MAX_TRANSIENT_RETRIES = 1;
const TRANSIENT_RETRY_DELAY_MS = 2500;

// Tries each model in MODEL_CHAIN in order, returning the first success.
// For a transient error (503 / "high demand"), retries the SAME model a
// couple of times with a short delay before moving on to the next model.
// If every model fails, throws the last error (prefixed with which models
// were attempted) so the UI can show something useful.
export async function generateOneShot(
  apiKey: string,
  referenceParts: InlinePart[],
  promptText: string
) {
  let lastError: Error | null = null;
  for (const model of MODEL_CHAIN) {
    for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
      try {
        const dataUrl = await callModel(apiKey, model, referenceParts, promptText);
        return { dataUrl, modelUsed: model };
      } catch (err) {
        const errorObj =
          err instanceof Error ? err : new Error("Generation failed.");
        lastError = errorObj;
        if (isTransientError(errorObj) && attempt < MAX_TRANSIENT_RETRIES) {
          await sleep(TRANSIENT_RETRY_DELAY_MS);
          continue;
        }
        break;
      }
    }
  }
  throw new Error(
    `All models failed (tried ${MODEL_CHAIN.join(", ")}). Last error: ${
      lastError?.message
    }`
  );
}

// A hard ceiling on total time for one generation — across every model and
// retry combined.
export const OVERALL_SHOT_TIMEOUT_MS = 100_000;

export function withOverallTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms / 1000}s overall.`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}
