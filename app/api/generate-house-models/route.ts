import { NextResponse } from "next/server";
import { generateOneShot, withOverallTimeout, OVERALL_SHOT_TIMEOUT_MS } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 220;

// One-time-use endpoint: generates 10 varied portrait candidates so you can
// browse and hand-pick which ones become the brand's fixed house models.
// Download whichever ones you like, save them as public/house-models/
// model-1.jpg / model-2.jpg / model-3.jpg, and commit — the main
// /api/generate route then picks one at random for every fresh photoshoot.
const PORTRAIT_BASE =
  "Generate a photorealistic studio portrait (head and shoulders) of an Indian woman, " +
  "direct gaze at the camera. Warm beige-to-tan seamless studio backdrop, soft even " +
  "studio lighting, clean professional fashion-lookbook quality. She is wearing a simple " +
  "plain neutral top (not a specific outfit) so the focus is entirely on her face.";

const PORTRAIT_VARIATIONS: string[] = [
  "Mid-20s, warm medium-brown skin tone, sleek dark hair in a low bun, oval face, soft natural makeup, minimal jewellery, calm neutral expression.",
  "Late-20s, deep brown skin tone, loose wavy shoulder-length hair, a rounder face shape, minimal makeup, small gold earrings, a slight natural smile.",
  "Early-30s, light-medium skin tone, hair pulled back in a high ponytail, sharp cheekbones, defined brows, calm neutral expression.",
  "Mid-20s, tan skin tone, long straight hair worn loose, heart-shaped face, a bold defined lip, confident direct gaze.",
  "Late-20s, deep brown skin tone, a short sleek bob haircut, angular face, minimal makeup, a soft warm smile.",
  "Early-30s, warm olive skin tone, a single loose braid, round face, a small nose stud, warm genuine smile.",
  "Mid-20s, medium-brown skin tone, natural curly shoulder-length hair, oval face, natural makeup, a serious composed expression.",
  "Late-20s, fair skin tone, a sleek high bun, a defined jawline, statement earrings, direct confident gaze.",
  "Early-30s, deep brown skin tone, loose waves past the shoulders, a soft round face, a small bindi, gentle warm smile.",
  "Mid-20s, tan skin tone, a side-swept bob haircut, high cheekbones, minimal jewellery, calm neutral expression.",
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
    PORTRAIT_VARIATIONS.map(async (variation, i) => {
      const label = `Portrait ${i + 1}`;
      try {
        const { dataUrl } = await withOverallTimeout(
          generateOneShot(apiKey, [], `${PORTRAIT_BASE} ${variation}`),
          OVERALL_SHOT_TIMEOUT_MS,
          label
        );
        return { label, dataUrl, error: null as string | null };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Generation failed.";
        return { label, dataUrl: null as string | null, error: message };
      }
    })
  );

  return NextResponse.json({ models: results });
}
