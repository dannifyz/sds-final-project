"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, type SignResult } from "@/lib/api";

export default function AdminPage() {
  const router = useRouter();
  const [username, setUsername] = useState<string | null>(null);
  const [result, setResult] = useState<SignResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api
      .me()
      .then((me) => setUsername(me.username))
      .catch(() => router.replace("/login?next=/admin"));
  }, [router]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError(null);
    setLoading(true);
    try {
      setResult(
        await api.sign({
          event: String(form.get("event")),
          attendeeName: String(form.get("attendeeName")),
          seat: String(form.get("seat")),
        }),
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login?next=/admin");
        return;
      }
      setError(err instanceof Error ? err.message : "Could not create ticket");
    } finally {
      setLoading(false);
    }
  }

  async function onLogout() {
    await api.logout().catch(() => {});
    router.replace("/login");
  }

  if (!username) {
    return <p className="text-sm text-zinc-500">Checking session…</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Create ticket</h1>
          <p className="text-sm text-zinc-500">Signed in as {username}</p>
        </div>
        <button onClick={onLogout} className="btn-ghost">
          Sign out
        </button>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <form onSubmit={onSubmit} className="card space-y-4">
          <div>
            <label htmlFor="event" className="label">
              Event
            </label>
            <input id="event" name="event" className="input" maxLength={200} required />
          </div>
          <div>
            <label htmlFor="attendeeName" className="label">
              Attendee name
            </label>
            <input id="attendeeName" name="attendeeName" className="input" maxLength={200} required />
          </div>
          <div>
            <label htmlFor="seat" className="label">
              Seat
            </label>
            <input id="seat" name="seat" className="input" maxLength={50} required />
          </div>
          {error && <p className="alert-error">{error}</p>}
          <button type="submit" className="btn w-full" disabled={loading}>
            {loading ? "Generating…" : "Generate QR"}
          </button>
        </form>

        <div className="card flex flex-col items-center justify-center gap-4 text-center">
          {result ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- data URL from the API */}
              <img src={result.qr} alt="Ticket QR code" className="w-full max-w-64 rounded-lg bg-white p-2" />
              <div className="text-sm">
                <p className="font-medium">{result.ticket.event}</p>
                <p className="text-zinc-500">
                  {result.ticket.attendeeName} · Seat {result.ticket.seat}
                </p>
              </div>
              <a
                href={result.qr}
                download={`ticket-${result.ticket.seat}.png`}
                className="btn-ghost"
              >
                Download PNG
              </a>
            </>
          ) : (
            <p className="text-sm text-zinc-500">The QR code will appear here.</p>
          )}
        </div>
      </div>
    </div>
  );
}
