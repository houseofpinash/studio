import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import {
  InlinePart,
  fileToInlinePart,
  dataUrlToInlinePart,
  generateOneShot,
  withOverallTimeout,
  OVERALL_SHOT_TIMEOUT_MS,
} from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 220;

// Standing brand spec: this garment is a SHORT shirt, not a tunic/kurta length.
// GARMENT_LENGTH_FRONT_IN is kept for reference; the prompt itself leans on a
// visible-leg proportion cue (see BASE_INSTRUCTION) since image models can't
// measure inches directly from a photo.
const GARMENT_LENGTH_FRONT_IN = 26;

const TOP_BASE_INSTRUCTION =
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

const TOP_SHOTS: { label: string; prompt: string }[] = [
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

// Dress variant: no trousers exist for this garment type at all, so every
// mention of pants/trouser colour, trouser style, and "% of leg visible"
// is dropped entirely rather than adapted — a dress can legitimately be
// mini, midi, or floor-length, so there's no single correct proportion to
// check against; the reference photos (and hem marker, if provided) are
// the only source of truth for length.
const DRESS_BASE_INSTRUCTION =
  "You are generating fashion e-commerce photography for a clothing brand, starting from " +
  "1 to 3 casual, non-professional reference photos of ONE dress, taken on a regular phone " +
  "camera — they may show the dress laid flat, on a hanger, or worn, from whatever angles " +
  "were easiest to capture (there is no fixed order — treat them all as views of the same " +
  "dress), and the lighting or background may be rough. Cross-reference all the photos " +
  "provided so details visible in one (e.g. a close-up of embroidery) inform the full-body " +
  "shots too. This is a DRESS — a single one-piece garment. Do NOT add trousers, pants, or " +
  "leggings underneath it; the model's legs (or feet, depending on length) should be bare " +
  "below the hem, exactly as a dress is worn.\n\n" +
  "Follow these constraints in this exact priority order — if any of them conflict, the " +
  "one listed first wins:\n\n" +
  "1. LENGTH (HIGHEST PRIORITY): match the dress length in the reference photos exactly — " +
  "it may be a mini, midi, or floor-length dress; whichever it is, reproduce that same " +
  "length precisely, do not shorten or lengthen it. If a HEM MARKER reference image is " +
  "provided (identified in its own instructions below), it is the single, authoritative, " +
  "non-negotiable source of truth for hem height — align the generated hem exactly with the " +
  "marked line's height on the body, overriding every other length cue. Sleeve length (if " +
  "any) must also be reproduced exactly as shown in the reference photos, never stretched.\n\n" +
  "2. FABRIC: the dress is linen. Render linen's true visual qualities — a matte, slightly " +
  "nubby woven texture (not smooth or silky), soft natural creases and gentle structure " +
  "rather than a fluid drape. Do not render it as silk, satin, or polyester.\n\n" +
  "3. GARMENT DESIGN: reproduce the cut, embroidery, print and proportions exactly as " +
  "shown. For any part not visible in any of the photos, infer it naturally and " +
  "consistently with what is shown.\n\n" +
  "4. BACKDROP: the exact same warm, soft beige-to-tan seamless studio backdrop in every " +
  "image, so all 4 shots look like the same session.\n\n" +
  "Generate a single new photorealistic image of a professional model wearing this exact " +
  "dress (nothing else on the lower body), shot as clean studio fashion photography with " +
  "soft, even lighting.";

const DRESS_SHOTS: { label: string; prompt: string }[] = [
  {
    label: "Full look — front",
    prompt:
      "Compose a full-body, front-facing shot. The model stands naturally, and the entire dress is visible from head to toe (or head to where the hem ends). Match the dress length exactly as shown in the reference photos.",
  },
  {
    label: "Full look — back",
    prompt:
      "Compose a full-body back shot. The model stands naturally, showing the back of the dress from head to toe (or head to where the hem ends). Match the dress length exactly as shown in the reference photos.",
  },
  {
    label: "Three-quarter angle",
    prompt:
      "Compose a three-quarter angle, full-body shot. The model's arms and hands hang straight and relaxed by her sides (NOT on her hip, NOT crossed) — a simple, natural standing pose that clearly shows the drape and silhouette of the dress.",
  },
  {
    label: "Detail close-up",
    prompt:
      "Compose a tight close-up cropped from the shoulder to the waist, still clearly showing the model's body and the dress as worn — not a flat fabric swatch — in sharp focus on the embroidery, print and linen texture of the dress.",
  },
];

type GarmentType = "top" | "dress";

function getPromptSet(garmentType: GarmentType) {
  return garmentType === "dress"
    ? { baseInstruction: DRESS_BASE_INSTRUCTION, shots: DRESS_SHOTS }
    : { baseInstruction: TOP_BASE_INSTRUCTION, shots: TOP_SHOTS };
}

function getAnchorNote(garmentType: GarmentType) {
  return garmentType === "dress"
    ? "\n\nIMPORTANT — the LAST attached image is a studio photo already generated earlier in " +
        "this same shoot, of this same model wearing this same dress. Treat it as the single " +
        "source of truth for the dress's colour and fabric rendering — match it exactly, more " +
        "reliable than the original phone photos. Only the pose/angle should differ, per the " +
        "instructions below."
    : "\n\nIMPORTANT — the LAST attached image is a studio photo already generated earlier in " +
        "this same shoot, of this same model wearing this same outfit. Treat it as the single " +
        "source of truth for the top's colour, the trousers' colour, and the fabric rendering — " +
        "match it exactly, more reliable than the original phone photos. Only the pose/angle " +
        "should differ, per the instructions below.";
}

const HEM_MARKER_NOTE =
  "\n\nHEM MARKER: one of the attached images has a bright coloured line drawn across the " +
  "garment, marking the EXACT height the hem must end at on the body. This is not a design " +
  "element of the garment itself — it is an annotation showing you precisely where the hem " +
  "falls. Measure the generated garment's hem against this marked line's height (relative to " +
  "the body, e.g. relative to the hip/waistband) and reproduce that exact height. This " +
  "overrides any percentage or fraction guidance elsewhere in these instructions.";

const FACE_NOTE =
  "\n\nHOUSE MODEL FACE: one of the attached images shows the exact person (face, skin tone, " +
  "hair) who must appear in this generated photo — this is a fixed brand model, not a random " +
  "choice. Use her face and general likeness precisely as shown in that reference photo. Do " +
  "not blend it with a different face or invent a new one; do not change her ethnicity, skin " +
  "tone, or facial features. Only her pose and the garment she's wearing should differ from " +
  "that reference.";

// The 3 fixed "house model" portraits live as static files, generated once
// via /api/generate-house-models and committed to the repo. One is picked
// at random for every fresh full run, then reused for the rest of that
// batch (and its regenerates) so the same person appears throughout.
const HOUSE_MODEL_COUNT = 3;

async function loadHouseModelPart(index: number): Promise<InlinePart | null> {
  try {
    const filePath = path.join(
      process.cwd(),
      "public",
      "house-models",
      `model-${index + 1}.jpg`
    );
    const buf = await fs.readFile(filePath);
    return { inlineData: { mimeType: "image/jpeg", data: buf.toString("base64") } };
  } catch {
    // No house model files yet (not generated/committed) — generation still
    // works fine without one, just without a fixed face.
    return null;
  }
}

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
  const houseModelIndexRaw = form.get("houseModelIndex");
  const requestedHouseModelIndex =
    typeof houseModelIndexRaw === "string" && houseModelIndexRaw !== ""
      ? Number(houseModelIndexRaw)
      : null;
  const garmentTypeRaw = form.get("garmentType");
  const garmentType: GarmentType = garmentTypeRaw === "dress" ? "dress" : "top";
  const { baseInstruction, shots: SHOTS } = getPromptSet(garmentType);
  const anchorNote = getAnchorNote(garmentType);

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
    houseModelPart: InlinePart | null,
    notes: string
  ): Promise<ShotResult> {
    const isFrontShot = shot.label === SHOTS[0].label;
    let partsForThisShot = referenceParts;
    let promptForThisShot = shot.prompt;

    if (anchorPart && !isFrontShot) {
      partsForThisShot = [...partsForThisShot, anchorPart];
      promptForThisShot += anchorNote;
    }
    if (hemMarkerPart) {
      partsForThisShot = [...partsForThisShot, hemMarkerPart];
      promptForThisShot += HEM_MARKER_NOTE;
    }
    // Only attach the house-model face reference when there's no anchor yet
    // (the anchor image, once it exists, already carries the chosen face
    // forward — attaching both would just be redundant).
    if (houseModelPart && !anchorPart) {
      partsForThisShot = [...partsForThisShot, houseModelPart];
      promptForThisShot += FACE_NOTE;
    }

    const fullPromptText = `${baseInstruction} ${promptForThisShot}${
      notes ? `\n\nAdditional direction from the brand: ${notes}` : ""
    }`;

    try {
      const { dataUrl, modelUsed } = await withOverallTimeout(
        generateOneShot(apiKey, partsForThisShot, fullPromptText),
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

    let anchorPart: InlinePart | null =
      anchorFile instanceof File ? await fileToInlinePart(anchorFile) : null;
    const hemMarkerPart: InlinePart | null =
      hemMarkerFile instanceof File ? await fileToInlinePart(hemMarkerFile) : null;

    // Pick (or reuse) which of the 3 fixed house-model faces to use for this
    // request. A fresh full run always rolls a new random one; a regenerate
    // reuses whichever index the client tells us was used for the rest of
    // the current on-screen set, so the face stays consistent within a batch.
    const houseModelIndex =
      requestedHouseModelIndex !== null &&
      requestedHouseModelIndex >= 0 &&
      requestedHouseModelIndex < HOUSE_MODEL_COUNT
        ? requestedHouseModelIndex
        : Math.floor(Math.random() * HOUSE_MODEL_COUNT);
    const houseModelPart = await loadHouseModelPart(houseModelIndex);

    let results: ShotResult[];

    if (shotIndex !== null) {
      results = [
        await runShot(
          shotsToRun[0],
          referenceParts,
          anchorPart,
          hemMarkerPart,
          houseModelPart,
          notes
        ),
      ];
    } else {
      const frontResult = await runShot(
        SHOTS[0],
        referenceParts,
        null,
        hemMarkerPart,
        houseModelPart,
        notes
      );
      if (frontResult.dataUrl) {
        anchorPart = dataUrlToInlinePart(frontResult.dataUrl);
      }

      const restResults = await Promise.all(
        SHOTS.slice(1).map((shot) =>
          runShot(shot, referenceParts, anchorPart, hemMarkerPart, houseModelPart, notes)
        )
      );

      results = [frontResult, ...restResults];
    }

    return NextResponse.json({ images: results, houseModelIndex });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
