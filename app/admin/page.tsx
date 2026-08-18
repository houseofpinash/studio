"use client";

import { useState } from "react";

type ModelResult = {
  label: string;
  dataUrl: string | null;
  error: string | null;
};

export default function AdminPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<ModelResult[] | null>(null);

  async function generate() {
    setLoading(true);
    setError("");
    setResults(null);
    try {
      const res = await fetch("/api/generate-house-models", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Generation failed.");
      } else {
        setResults(data.models);
      }
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setLoading(false);
    }
  }

  function download(dataUrl: string, index: number) {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `model-${index + 1}.jpg`;
    a.click();
  }

  return (
    <main className="min-h-screen bg-bone px-6 md:px-10 py-10">
      <div className="max-w-4xl mx-auto flex flex-col gap-8">
        <div>
          <p className="label-eyebrow mb-2">One-time setup</p>
          <h1 className="font-display text-3xl text-ink mb-3">
            Generate the 3 house models
          </h1>
          <p className="text-sm text-stone font-sans max-w-2xl">
            This generates 3 distinct model portraits once. Download each one,
            save them into <code>public/house-models/</code> as{" "}
            <code>model-1.jpg</code>, <code>model-2.jpg</code>, and{" "}
            <code>model-3.jpg</code>, then commit and push. Every future
            generation will randomly pick one of these 3 for the whole
            photoshoot, so the same person appears consistently across all 4
            shots.
          </p>
        </div>

        <button
          onClick={generate}
          disabled={loading}
          className="bg-ink text-bone font-sans text-sm tracking-wide px-8 py-3 hover:bg-mauve transition-colors disabled:opacity-40 disabled:cursor-not-allowed w-fit"
        >
          {loading ? "Generating 3 portraits…" : "Generate 3 house models"}
        </button>

        {error && <p className="text-sm font-sans text-[#8a3b2e]">{error}</p>}

        {results && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {results.map((r, i) => (
              <div key={i} className="border hairline bg-plate/40">
                <div className="aspect-[3/4] bg-plate flex items-center justify-center overflow-hidden">
                  {r.dataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={r.dataUrl}
                      alt={r.label}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <p className="text-sm text-[#8a3b2e] font-sans px-4 text-center">
                      {r.error || "Failed"}
                    </p>
                  )}
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="label-eyebrow">
                    model-{i + 1}.jpg
                  </span>
                  {r.dataUrl && (
                    <button
                      onClick={() => download(r.dataUrl!, i)}
                      className="text-sm font-sans underline decoration-line underline-offset-4 hover:text-mauve"
                    >
                      Download
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
