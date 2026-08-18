"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Incorrect password.");
        setLoading(false);
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Try again.");
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-bone px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <p className="label-eyebrow mb-3">Atelier Access</p>
          <h1 className="font-display text-4xl tracking-tight text-ink">
            House of Pinash
          </h1>
        </div>

        <form
          onSubmit={handleSubmit}
          className="border hairline bg-plate/40 px-8 py-9 flex flex-col gap-5"
        >
          <label className="flex flex-col gap-2">
            <span className="label-eyebrow">Studio password</span>
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-bone border hairline px-4 py-3 text-ink font-sans focus:outline-none focus:ring-2 focus:ring-mauve/40"
              placeholder="••••••••"
            />
          </label>

          {error && (
            <p className="text-sm font-sans text-[#8a3b2e]">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            className="mt-2 bg-ink text-bone font-sans text-sm tracking-wide py-3 hover:bg-mauve transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? "Checking…" : "Enter studio"}
          </button>
        </form>
      </div>
    </main>
  );
}
