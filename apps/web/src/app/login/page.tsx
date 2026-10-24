"use client";

import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError(null);
    setLoading(true);
    try {
      await api.login(String(form.get("username")), String(form.get("password")));
      const next = new URLSearchParams(window.location.search).get("next");
      // Only follow same-site paths to avoid an open redirect. Use a full
      // navigation: the client router may hold a prefetched redirect from
      // before the session cookie existed.
      window.location.replace(next?.startsWith("/") && !next.startsWith("//") ? next : "/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Sign in</h1>
      <form onSubmit={onSubmit} className="card space-y-4">
        <div>
          <label htmlFor="username" className="label">
            Username
          </label>
          <input id="username" name="username" className="input" autoComplete="username" required />
        </div>
        <div>
          <label htmlFor="password" className="label">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            className="input"
            autoComplete="current-password"
            required
          />
        </div>
        {error && <p className="alert-error">{error}</p>}
        <button type="submit" className="btn w-full" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
