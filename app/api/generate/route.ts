import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 220;

// Tried in order for every shot. If the primary model fails or returns no
// image, we fall back to the next one. Nano Banana Pro is primary — it
// handles precise compositional/proportion instructions (like an exact
// hem-length marker) more reliably than the faster Flash models, which is
// worth the extra latency for this use case. Kept to 2 models (not 3) so
// worst-case fallback time stays bounded. Override via env vars.
const MODEL_CHAIN = [
  process.env.GEMINI_MODEL || "gemini-3-pro-image",
  process.env.GEMINI_FALLBACK_MODEL || "gemini-2.5-flash-image",
].filter((m, i, arr) => arr.indexOf(m) === i); // dedupe if envs repeat a default

// Standing brand spec: this garment is a SHORT shirt, not a tunic/kurta length.
// GARMENT_LENGTH_FRONT_IN is kept for reference; the prompt itself leans on a
// visible-leg proportion cue (see BASE_INSTRUCTION) since image models can't
// measure inches directly from a photo.
const GARMENT_LENGTH_FRONT_IN = 26;

// HD output: request a higher resolution from models that support it
// (imageConfig.imageSize). Ignored harmlessly by models that don't.
const IMAGE_SIZE = process.env.GEMINI_IMAGE_SIZE || "2K"; // "1K" | "2K" | "4K"
const IMAGE_ASPECT_RATIO = "3:4";

const BASE_INSTRUCTION =
  "You are generating fashion e-commerce photography for a clothing brand, starting from " +
  "1 to 3 casual, non-professional reference photos of ONE garment/outfit, taken on a " +
  "regular phone camera — they may show the outfit laid flat, on a hanger, or worn, from " +
  "whatever angles were easiest to capture (there is no fixed order — treat them all as " +
  "views of the same garment), and the lighting or background may be rough. Cross-reference " +
  "all the photos provided so details visible in one (e.g. a close-up of embroidery) inform " +
  "the full-body shots too.\n\n" +
  "Follow these constraints in this exact priority order — if any of them conflict, the " +
  "one listed first wins:\n\n" +
  `1. LENGTH (HIGHEST PRIORITY — this has been wrong in previous attempts, fix it ` +
  `deliberately): this is a SHORT SHIRT, styled like an oversized camp-collar shirt worn ` +
  `loose over trousers — it is NOT a kurta, tunic, dress, or duster, and must never be ` +
  `drawn that long. If a HEM MARKER reference image is provided (identified in its own ` +
  `instructions below), it is the single, authoritative, non-negotiable source of truth for ` +
  `hem height — align the generated hem exactly with the marked line's height on the body, ` +
  `overriding every other length cue below. If no hem marker is provided, fall back to this ` +
  `test: when the model stands straight, at least ` +
  `75% of her trouser leg length at the front, and at least 80% at the back (the back hem ` +
  `sits higher / shows more leg than the front), measured from waist to ankle, must ` +
  `be clearly visible ` +
  `below the shirt hem. The hem itself sits at the hip / upper trouser pocket area — well ` +
  `above mid-thigh, for both front and back. Before finalizing the ` +
  `image, check: does the shirt cover less than a third of the leg? If it covers more than ` +
  `that, it is wrong — redraw it shorter. Sleeve length must also be reproduced exactly as ` +
  `shown in the reference photos, never stretched.\n\n` +
  `2. PANTS COLOUR (HIGHEST PRIORITY — this has also been wrong in previous attempts): ` +
  `look very carefully at what colour the trousers are in the reference photos and copy ` +
  `that exact colour, tone and saturation — do not lighten it, cool it down, warm it up, ` +
  `or substitute a similar-looking shade. If the reference photos don't clearly show the ` +
  `trousers, use the exact same colour as the top garment (not a coordinating shade — the ` +
  `same colour), consistently across all 4 shots.\n\n` +
  "3. FABRIC: the garment and trousers are linen. Render linen's true visual qualities — a " +
  "matte, slightly nubby woven texture (not smooth or silky), soft natural creases and " +
  "gentle structure rather than a fluid drape. Do not render it as silk, satin, or " +
  "polyester.\n\n" +
  "4. GARMENT DESIGN: reproduce the cut, embroidery, print and proportions exactly as " +
  "shown. For any part not visible in any of the photos, infer it naturally and " +
  "consistently with what is shown.\n\n" +
  "5. TROUSER STYLE: straight-cut, ankle-length, no cuffs.\n\n" +
  "6. BACKDROP: the exact same warm, soft beige-to-tan seamless studio backdrop in every " +
  "image, so all 4 shots look like the same session.\n\n" +
  "Generate a single new photorealistic image of a professional model wearing this exact " +
  "outfit, shot as clean studio fashion photography with soft, even lighting.";

const SHOTS: { label: string; prompt: string }[] = [
  {
    label: "Full look — front",
    prompt: `Compose a full-body, front-facing shot. The model stands naturally, and the entire garment is visible from head to toe. This is a SHORT shirt (about ${GARMENT_LENGTH_FRONT_IN}" from shoulder to hem on a standard model) — before finalizing, check that at least 75% of the trouser leg is visible below the hem. If less leg is showing than that, the shirt is drawn too long — shorten it.`,
  },
  {
    label: "Full look — back",
    prompt: `Compose a full-body back shot. The model stands naturally, showing the back of the garment from head to toe. The back hem is SHORTER than the front — before finalizing, check that at least 80% of the trouser leg is visible below the back hem. If less leg is showing than that, the shirt is drawn too long — shorten it.`,
  },
  {
    label: "Three-quarter angle",
    prompt:
      "Compose a three-quarter angle, full-body shot. The model's arms and hands hang straight and relaxed by her sides (NOT on her hip, NOT crossed) — a simple, natural standing pose that clearly shows the drape and silhouette of the garment.",
  },
  {
    label: "Detail close-up",
    prompt:
      "Compose a tight close-up cropped from the shoulder to the waist, still clearly showing the model's body and the garment as worn — not a flat fabric swatch — in sharp focus on the embroidery, print and linen texture of the garment.",
  },
];

type InlinePart = { inlineData: { mimeType: string; data: string } };
type GeminiPart = {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
};

async function fileToInlinePart(file: File): Promise<InlinePart> {
  const buf = Buffer.from(await file.arrayBuffer());
  return {
    inlineData: {
      mimeType: file.type || "image/jpeg",
      data: buf.toString("base64"),
    },
  };
}

function dataUrlToInlinePart(dataUrl: string): InlinePart {
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
// couple of times with a short delay before moving on to the next model —
// these spikes are usually brief, so a short wait often just works.
// If every model fails, throws the last error (prefixed with which models
// were attempted) so the UI can show something useful.
async function generateOneShot(
  apiKey: string,
  referenceParts: InlinePart[],
  shotPrompt: string,
  notes: string
) {
  const promptText = `${BASE_INSTRUCTION} ${shotPrompt}${
    notes ? `\n\nAdditional direction from the brand: ${notes}` : ""
  }`;

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
        break; // not transient, or out of retries — move to next model
      }
    }
  }
  throw new Error(
    `All models failed (tried ${MODEL_CHAIN.join(", ")}). Last error: ${
      lastError?.message
    }`
  );
}

// A hard ceiling on total time for one shot's generation — across every
// model and every retry combined. Even with 2 models x 2 attempts x 30s
// each, this stops any single shot from silently running past ~100s; if
// it's exceeded, the shot is marked failed and the app moves on rather
// than continuing to wait.
const OVERALL_SHOT_TIMEOUT_MS = 100_000;

function withOverallTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
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

const ANCHOR_NOTE =
  "\n\nIMPORTANT — the LAST attached image is a studio photo already generated earlier in " +
  "this same shoot, of this same model wearing this same outfit. Treat it as the single " +
  "source of truth for the top's colour, the trousers' colour, and the fabric rendering — " +
  "match it exactly, more reliable than the original phone photos. Only the pose/angle " +
  "should differ, per the instructions below.";

const HEM_MARKER_NOTE =
  "\n\nHEM MARKER: one of the attached images has a bright coloured line drawn across the " +
  "garment, marking the EXACT height the hem must end at on the body. This is not a design " +
  "element of the garment itself — it is an annotation showing you precisely where the hem " +
  "falls. Measure the generated garment's hem against this marked line's height (relative to " +
  "the body, e.g. relative to the hip/waistband) and reproduce that exact height. This " +
  "overrides any percentage or fraction guidance elsewhere in these instructions.";

export async function POST(req: NextRequest) {
  const rawApiKey = process.env.GEMINI_API_KEY;
  if (!rawApiKey) {
    return NextResponse.json(
      { error: "Server is missing GEMINI_API_KEY." },
      { status: 500 }
    );
  }
  const apiKey: string = rawApiKey;

  const form = await req.formData();
  const files = form
    .getAll("references")
    .filter((f): f is File => f instanceof File);
  const notes = (form.get("notes") as string) || "";
  const shotIndexRaw = form.get("shotIndex");
  const shotIndex =
    typeof shotIndexRaw === "string" && shotIndexRaw !== ""
      ? Number(shotIndexRaw)
      : null;
  const anchorFile = form.get("anchorImage");
  const hemMarkerFile = form.get("hemMarker");

  if (files.length === 0) {
    return NextResponse.json(
      { error: "Upload at least one reference photo." },
      { status: 400 }
    );
  }
  if (files.length > 3) {
    return NextResponse.json(
      { error: "Please upload 3 or fewer reference photos." },
      { status: 400 }
    );
  }
  if (
    shotIndex !== null &&
    (Number.isNaN(shotIndex) || shotIndex < 0 || shotIndex >= SHOTS.length)
  ) {
    return NextResponse.json({ error: "Invalid shot index." }, { status: 400 });
  }

  const shotsToRun = shotIndex !== null ? [SHOTS[shotIndex]] : SHOTS;

  type ShotResult = {
    label: string;
    dataUrl: string | null;
    error: string | null;
    modelUsed: string | null;
  };

  async function runShot(
    shot: { label: string; prompt: string },
    referenceParts: InlinePart[],
    anchorPart: InlinePart | null,
    hemMarkerPart: InlinePart | null,
    notes: string
  ): Promise<ShotResult> {
    const isFrontShot = shot.label === SHOTS[0].label;
    let partsForThisShot = referenceParts;
    let promptForThisShot = shot.prompt;

    if (anchorPart && !isFrontShot) {
      partsForThisShot = [...partsForThisShot, anchorPart];
      promptForThisShot += ANCHOR_NOTE;
    }
    if (hemMarkerPart) {
      partsForThisShot = [...partsForThisShot, hemMarkerPart];
      promptForThisShot += HEM_MARKER_NOTE;
    }

    try {
      const { dataUrl, modelUsed } = await withOverallTimeout(
        generateOneShot(apiKey, partsForThisShot, promptForThisShot, notes),
        OVERALL_SHOT_TIMEOUT_MS,
        shot.label
      );
      return { label: shot.label, dataUrl, error: null, modelUsed };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Generation failed.";
      return { label: shot.label, dataUrl: null, error: message, modelUsed: null };
    }
  }

  try {
    const referenceParts = await Promise.all(files.map(fileToInlinePart));

    // An anchor image (a previously generated shot of the same outfit) is used
    // as an extra reference for every shot after the front, so pants/top colour
    // and fabric stay consistent across the set instead of each shot re-guessing
    // independently from the original phone photos. It comes either from the
    // front shot generated just below, or (for a single-shot regenerate) from
    // the client.
    let anchorPart: InlinePart | null =
      anchorFile instanceof File ? await fileToInlinePart(anchorFile) : null;
    const hemMarkerPart: InlinePart | null =
      hemMarkerFile instanceof File ? await fileToInlinePart(hemMarkerFile) : null;

    let results: ShotResult[];

    if (shotIndex !== null) {
      // Single-shot regenerate — just run the one requested shot.
      results = [
        await runShot(shotsToRun[0], referenceParts, anchorPart, hemMarkerPart, notes),
      ];
    } else {
      // Full run: front generates first (it's the anchor), then back,
      // three-quarter, and detail all run in parallel against it — they
      // only depend on the front shot, not on each other, so there's no
      // need to make them wait in a line.
      const frontResult = await runShot(
        SHOTS[0],
        referenceParts,
        null,
        hemMarkerPart,
        notes
      );
      if (frontResult.dataUrl) {
        anchorPart = dataUrlToInlinePart(frontResult.dataUrl);
      }

      const restResults = await Promise.all(
        SHOTS.slice(1).map((shot) =>
          runShot(shot, referenceParts, anchorPart, hemMarkerPart, notes)
        )
      );

      results = [frontResult, ...restResults];
    }

    return NextResponse.json({ images: results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
