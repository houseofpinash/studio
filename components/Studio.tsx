"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import JSZip from "jszip";

type ResultImage = {
  label: string;
  dataUrl: string | null;
  error: string | null;
  modelUsed?: string | null;
};

export default function Studio() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const hemMarkerInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [hemMarkerFile, setHemMarkerFile] = useState<File | null>(null);
  const [hemMarkerPreview, setHemMarkerPreview] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState("");
  const [results, setResults] = useState<ResultImage[] | null>(null);
  const [regeneratingIndex, setRegeneratingIndex] = useState<number | null>(
    null
  );

  useEffect(() => {
    if (!loading) return;
    const interval = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [loading]);

  const addFiles = useCallback(
    (incoming: FileList | null) => {
      if (!incoming || incoming.length === 0) return;
      const next = [...files, ...Array.from(incoming)].slice(0, 3);
      setFiles(next);
      setPreviews(next.map((f) => URL.createObjectURL(f)));
      setResults(null);
      setError("");
    },
    [files]
  );

  function removeFile(index: number) {
    const next = files.filter((_, i) => i !== index);
    setFiles(next);
    setPreviews(next.map((f) => URL.createObjectURL(f)));
  }

  function setHemMarker(incoming: FileList | null) {
    const picked = incoming?.[0];
    if (!picked) return;
    setHemMarkerFile(picked);
    setHemMarkerPreview(URL.createObjectURL(picked));
    setResults(null);
    setError("");
  }

  function removeHemMarker() {
    setHemMarkerFile(null);
    setHemMarkerPreview(null);
  }

  async function handleGenerate() {
    if (files.length === 0) return;
    setLoading(true);
    setElapsedSeconds(0);
    setError("");
    setResults(null);

    const form = new FormData();
    files.forEach((f) => form.append("references", f));
    form.append("notes", notes);
    if (hemMarkerFile) form.append("hemMarker", hemMarkerFile);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Generation failed.");
      } else {
        setResults(data.images);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setError("Cancelled.");
      } else {
        setError("Couldn't reach the server. Try again.");
      }
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  }

  function cancelGenerate() {
    abortControllerRef.current?.abort();
  }

  async function regenerateShot(index: number) {
    if (files.length === 0 || !results) return;
    setRegeneratingIndex(index);
    setError("");

    const form = new FormData();
    files.forEach((f) => form.append("references", f));
    form.append("notes", notes);
    form.append("shotIndex", String(index));
    if (hemMarkerFile) form.append("hemMarker", hemMarkerFile);

    // Anchor to the front shot (if it exists) so colour/fabric stays
    // consistent with the rest of the set, same as a full run does.
    if (index !== 0 && results[0]?.dataUrl) {
      try {
        const anchorRes = await fetch(results[0].dataUrl);
        const anchorBlob = await anchorRes.blob();
        form.append(
          "anchorImage",
          new File([anchorBlob], "anchor-front.png", {
            type: anchorBlob.type || "image/png",
          })
        );
      } catch {
        // If this fails for any reason, just proceed without an anchor.
      }
    }

    try {
      const res = await fetch("/api/generate", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok || !data.images?.[0]) {
        setError(data.error || "Regeneration failed.");
      } else {
        const updated = [...results];
        updated[index] = data.images[0];
        setResults(updated);
      }
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setRegeneratingIndex(null);
    }
  }

  async function downloadAllAsZip() {
    if (!results) return;
    const zip = new JSZip();
    const available = results.filter((r) => r.dataUrl);

    await Promise.all(
      available.map(async (img) => {
        const res = await fetch(img.dataUrl!);
        const blob = await res.blob();
        const filename = `${img.label
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")}.png`;
        zip.file(filename, blob);
      })
    );

    const zipBlob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pinash-4-looks.zip";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleLogout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  function downloadImage(dataUrl: string, label: string) {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `pinash-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`;
    a.click();
  }

  async function shareImage(dataUrl: string, label: string) {
    const filename = `pinash-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`;
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const file = new File([blob], filename, { type: blob.type || "image/png" });

      const nav = navigator as Navigator & {
        canShare?: (data?: ShareData) => boolean;
      };

      if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
        await nav.share({
          files: [file],
          title: `House of Pinash — ${label}`,
          text: `House of Pinash — ${label}`,
        });
        return;
      }

      // No native share sheet (typical on desktop browsers) — download the
      // image and open WhatsApp Web so it can be attached manually.
      downloadImage(dataUrl, label);
      window.open(
        `https://wa.me/?text=${encodeURIComponent(
          `House of Pinash — ${label} (image downloaded, attach it here)`
        )}`,
        "_blank"
      );
    } catch {
      setError("Couldn't share this image directly — try downloading and sharing it manually.");
    }
  }

  return (
    <main className="min-h-screen bg-bone">
      <header className="flex items-center justify-between px-6 md:px-10 py-6 border-b hairline">
        <div>
          <p className="label-eyebrow">Atelier Studio</p>
          <h1 className="font-display text-2xl md:text-3xl text-ink tracking-tight">
            House of Pinash
          </h1>
        </div>
        <button
          onClick={handleLogout}
          className="label-eyebrow border hairline px-4 py-2 hover:bg-plate transition-colors"
        >
          Log out
        </button>
      </header>

      <div className="max-w-5xl mx-auto px-6 md:px-10 py-10 flex flex-col gap-10">
        {/* Upload plate */}
        <section>
          <p className="label-eyebrow mb-3">
            Step 01 — Reference photos ({files.length}/3)
          </p>
          <div
            onClick={() => files.length < 3 && inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              addFiles(e.dataTransfer.files);
            }}
            className={`border hairline border-dashed bg-plate/40 transition-colors px-6 py-10 text-center ${
              files.length < 3
                ? "hover:bg-plate/60 cursor-pointer"
                : "opacity-50 cursor-not-allowed"
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => addFiles(e.target.files)}
            />
            <p className="font-display text-lg text-ink mb-1">
              Drop 1 to 3 quick phone photos of the outfit here
            </p>
            <p className="text-sm text-stone font-sans">
              Regular camera clicks are fine — any angles you have (front,
              back, a close-up). 4 different model shots come out.
            </p>
          </div>

          {previews.length > 0 && (
            <div className="grid grid-cols-3 gap-3 mt-4 max-w-md">
              {previews.map((src, i) => (
                <div
                  key={i}
                  className="relative aspect-[3/4] border hairline bg-plate overflow-hidden group"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt={`Reference ${i + 1}`}
                    className="w-full h-full object-cover"
                  />
                  <button
                    onClick={() => removeFile(i)}
                    className="absolute top-1 right-1 bg-ink/80 text-bone text-xs w-6 h-6 flex items-center justify-center hover:bg-mauve"
                    aria-label={`Remove photo ${i + 1}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Hem marker */}
        <section>
          <p className="label-eyebrow mb-3">
            Step 02 — Hem length marker (optional, but recommended for accuracy)
          </p>
          <p className="text-sm text-stone font-sans mb-3 max-w-xl">
            Draw a bright line across one of your reference photos at the
            exact height the hem should end, and upload it here. This is the
            single most reliable way to get the length right — much stronger
            than a written description.
          </p>
          {hemMarkerPreview ? (
            <div className="relative w-40 aspect-[3/4] border hairline bg-plate overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={hemMarkerPreview}
                alt="Hem marker reference"
                className="w-full h-full object-cover"
              />
              <button
                onClick={removeHemMarker}
                className="absolute top-1 right-1 bg-ink/80 text-bone text-xs w-6 h-6 flex items-center justify-center hover:bg-mauve"
                aria-label="Remove hem marker photo"
              >
                ×
              </button>
            </div>
          ) : (
            <div
              onClick={() => hemMarkerInputRef.current?.click()}
              className="border hairline border-dashed bg-plate/40 hover:bg-plate/60 transition-colors cursor-pointer px-6 py-6 text-center max-w-md"
            >
              <input
                ref={hemMarkerInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => setHemMarker(e.target.files)}
              />
              <p className="text-sm font-sans text-ink">
                Upload a marked-up photo showing the exact hem height
              </p>
            </div>
          )}
        </section>

        {/* Notes */}
        <section>
          <p className="label-eyebrow mb-3">Step 03 — Direction (optional)</p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. model with a warm skin tone, outdoor golden-hour light, relaxed pose…"
            rows={3}
            className="w-full bg-plate/40 border hairline px-4 py-3 font-sans text-sm focus:outline-none focus:ring-2 focus:ring-mauve/40"
          />
        </section>

        <section>
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={handleGenerate}
              disabled={files.length === 0 || loading}
              className="bg-ink text-bone font-sans text-sm tracking-wide px-8 py-3 hover:bg-mauve transition-colors disabled:opacity-40 disabled:cursor-not-allowed w-full sm:w-auto"
            >
              {loading
                ? `Generating… (${elapsedSeconds}s)`
                : results
                ? "Regenerate all 4 shots"
                : "Generate 4 model shots"}
            </button>
            {loading && (
              <button
                onClick={cancelGenerate}
                className="border hairline px-4 py-3 text-sm font-sans tracking-wide hover:bg-plate transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
          {loading && (
            <p className="text-sm text-stone font-sans mt-2">
              Front look generates first (usually the slower step with Nano
              Banana Pro), then back, three-quarter, and detail generate
              together.
            </p>
          )}
          {error && (
            <p className="text-sm font-sans text-[#8a3b2e] mt-3">{error}</p>
          )}
        </section>

        {/* Results */}
        {results && (
          <section>
            <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
              <p className="label-eyebrow">Step 04 — Results</p>
              {results.some((r) => r.dataUrl) && (
                <button
                  onClick={downloadAllAsZip}
                  className="bg-ink text-bone px-4 py-2 text-xs font-sans tracking-wide hover:bg-mauve transition-colors"
                >
                  Download all 4 (ZIP)
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {results.map((img, i) => (
                <div key={i} className="border hairline bg-plate/40">
                  <div className="aspect-[3/4] bg-plate flex items-center justify-center overflow-hidden relative">
                    {regeneratingIndex === i ? (
                      <p className="text-sm text-stone font-sans px-6 text-center">
                        Regenerating…
                      </p>
                    ) : img.dataUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={img.dataUrl}
                        alt={img.label}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <p className="text-sm text-[#8a3b2e] font-sans px-6 text-center">
                        {img.error || "Couldn't generate this shot."}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 px-4 py-3">
                    <span className="label-eyebrow">
                      Look 0{i + 1} — {img.label}
                    </span>
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => regenerateShot(i)}
                        disabled={regeneratingIndex !== null || loading}
                        className="border hairline px-3 py-2 text-xs font-sans tracking-wide hover:bg-plate transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Regenerate
                      </button>
                      {img.dataUrl && (
                        <>
                          <button
                            onClick={() => downloadImage(img.dataUrl!, img.label)}
                            className="border hairline px-3 py-2 text-xs font-sans tracking-wide hover:bg-plate transition-colors"
                          >
                            Download HD
                          </button>
                          <button
                            onClick={() => shareImage(img.dataUrl!, img.label)}
                            className="bg-[#25D366] text-white px-3 py-2 text-xs font-sans tracking-wide hover:opacity-90 transition-opacity"
                          >
                            Share to WhatsApp
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
