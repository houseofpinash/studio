import { NextResponse } from "next/server";
import { generateOneShot, withOverallTimeout, OVERALL_SHOT_TIMEOUT_MS } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 220;

// One-time-use endpoint: generates 3 distinct "house model" portraits that
// become the brand's fixed set of faces. Run this once, download the 3
// results, save them as public/house-models/model-1.jpg / model-2.jpg /
// model-3.jpg, and commit — the main /api/generate route then picks one at
// random for every fresh photoshoot.
const HOUSE_MODEL_PROMPTS: { label: string; prompt: string }[] = [
  {
    label: "House model 1",
    prompt:
      "Generate a photorealistic studio portrait (head and shoulders) of an Indian woman in " +
      "her mid-20s, warm medium-brown skin tone, sleek dark hair in a low bun, oval face, soft " +
      "natural makeup, minimal jewellery, direct gaze at the camera, calm neutral expression. " +
      "Warm beige-to-tan seamless studio backdrop, soft even studio lighting, clean professional " +
      "fashion-lookbook quality. She is wearing a simple plain neutral top (not a specific " +
      "outfit) so the focus is entirely on her face.",
  },
  {
    label: "House model 2",
    prompt:
      "Generate a photorealistic studio portrait (head and shoulders) of an Indian woman in " +
      "her late 20s, deeper brown skin tone, loose wavy shoulder-length hair, a rounder face " +
      "shape, minimal makeup, small gold earrings, direct gaze at the camera, a slight natural " +
      "smile. Warm beige-to-tan seamless studio backdrop, soft even studio lighting, clean " +
      "professional fashion-lookbook quality. She is wearing a simple plain neutral top (not a " +
      "specific outfit) so the focus is entirely on her face.",
  },
  {
    label: "House model 3",
    prompt:
      "Generate a photorealistic studio portrait (head and shoulders) of an Indian woman in " +
      "her early 30s, light-medium skin tone, hair pulled back in a high ponytail, sharp " +
      "cheekbones, defined brows, direct gaze at the camera, calm neutral expression. Warm " +
      "beige-to-tan seamless studio backdrop, soft even studio lighting, clean professional " +
      "fashion-lookbook quality. She is wearing a simple plain neutral top (not a specific " +
      "outfit) so the focus is entirely on her face.",
  },
];

export async function POST() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server is missing GEMINI_API_KEY." },
      { status: 500 }
    );
  }

  const results = await Promise.all(
    HOUSE_MODEL_PROMPTS.map(async (m) => {
      try {
        const { dataUrl } = await withOverallTimeout(
          generateOneShot(apiKey, [], m.prompt),
          OVERALL_SHOT_TIMEOUT_MS,
          m.label
        );
        return { label: m.label, dataUrl, error: null as string | null };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Generation failed.";
        return { label: m.label, dataUrl: null as string | null, error: message };
      }
    })
  );

  return NextResponse.json({ models: results });
}
