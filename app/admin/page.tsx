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

  function download(dataUrl: string, label: string) {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${label.toLowerCase().replace(/\s+/g, "-")}.jpg`;
    a.click();
  }

  return (
    <main className="min-h-screen bg-bone px-6 md:px-10 py-10">
      <div className="max-w-6xl mx-auto flex flex-col gap-8">
        <div>
          <p className="label-eyebrow mb-2">One-time setup</p>
          <h1 className="font-display text-3xl text-ink mb-3">
            Choose the house models
          </h1>
          <p className="text-sm text-stone font-sans max-w-2xl">
            Generates 10 varied portrait candidates at once so you can browse
            and pick the ones you actually like. Download your 3 favourites,
            rename them <code>model-1.jpg</code>, <code>model-2.jpg</code>, and{" "}
            <code>model-3.jpg</code>, place them in{" "}
            <code>public/house-models/</code>, then commit and push. Not
            happy with any of these? Just generate again for a fresh batch —
            nothing is saved until you download and commit it.
          </p>
        </div>

        <button
          onClick={generate}
          disabled={loading}
          className="bg-ink text-bone font-sans text-sm tracking-wide px-8 py-3 hover:bg-mauve transition-colors disabled:opacity-40 disabled:cursor-not-allowed w-fit"
        >
          {loading ? "Generating 10 portraits…" : "Generate 10 portraits"}
        </button>

        {error && <p className="text-sm font-sans text-[#8a3b2e]">{error}</p>}

        {results && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
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
                    <p className="text-xs text-[#8a3b2e] font-sans px-3 text-center">
                      {r.error || "Failed"}
                    </p>
                  )}
                </div>
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-xs font-sans text-stone">{r.label}</span>
                  {r.dataUrl && (
                    <button
                      onClick={() => download(r.dataUrl!, r.label)}
                      className="text-xs font-sans underline decoration-line underline-offset-4 hover:text-mauve"
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
