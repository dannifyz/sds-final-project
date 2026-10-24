"use client";

import jsQR from "jsqr";
import { useState, type ChangeEvent } from "react";
import { api, type VerifyResult } from "@/lib/api";

type State =
  | { kind: "idle" }
  | { kind: "busy"; message: string }
  | { kind: "error"; message: string }
  | { kind: "done"; result: VerifyResult };

// Large phone photos are slow to scan at full size, but downscaling too far
// loses the fine modules of a long JWT, so try a few sizes.
const SCAN_WIDTHS = [1600, 1000, Infinity];

async function readQR(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  for (const maxWidth of SCAN_WIDTHS) {
    const scale = Math.min(1, maxWidth / bitmap.width);
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(data, width, height, { inversionAttempts: "attemptBoth" });
    if (code?.data) return code.data;
  }
  return null;
}

export default function ScanPage() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [preview, setPreview] = useState<string | null>(null);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(file);
    });

    try {
      setState({ kind: "busy", message: "Reading QR code…" });
      const token = await readQR(file);
      if (!token) {
        setState({ kind: "error", message: "No QR code found in this image." });
        return;
      }
      setState({ kind: "busy", message: "Verifying ticket…" });
      setState({ kind: "done", result: await api.verify(token) });
    } catch {
      setState({ kind: "error", message: "Could not read this image." });
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Scan ticket</h1>
        <p className="text-sm text-zinc-500">Upload a photo or screenshot of a ticket QR code to verify it.</p>
      </div>

      <label className="card flex cursor-pointer flex-col items-center gap-3 border-dashed text-center hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
        {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
        {preview && <img src={preview} alt="Uploaded ticket" className="max-h-64 rounded-lg" />}
        <span className="btn">{preview ? "Choose another image" : "Upload image"}</span>
        <span className="text-xs text-zinc-500">PNG, JPG or any image your browser can open</span>
        <input type="file" accept="image/*" onChange={onFile} className="sr-only" />
      </label>

      {state.kind === "busy" && <p className="text-sm text-zinc-500">{state.message}</p>}
      {state.kind === "error" && <p className="alert-error">{state.message}</p>}
      {state.kind === "done" && <VerifyCard result={state.result} />}
    </div>
  );
}

function VerifyCard({ result }: { result: VerifyResult }) {
  if (!result.valid) {
    return (
      <div className="card border-red-300 dark:border-red-900">
        <p className="text-lg font-semibold text-red-600 dark:text-red-400">✕ Invalid ticket</p>
        <p className="mt-1 text-sm text-zinc-500">{result.error}</p>
      </div>
    );
  }

  const { ticket } = result;
  const rows: [string, string | undefined][] = [
    ["Event", ticket.event],
    ["Attendee", ticket.attendeeName],
    ["Seat", ticket.seat],
    ["Issued", ticket.iat ? new Date(ticket.iat * 1000).toLocaleString() : undefined],
    ["Ticket ID", ticket.jti],
  ];

  return (
    <div className="card border-emerald-300 dark:border-emerald-900">
      <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">✓ Valid ticket</p>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        {rows.map(([k, v]) =>
          v ? (
            <div key={k} className="contents">
              <dt className="text-zinc-500">{k}</dt>
              <dd className="break-all font-medium">{v}</dd>
            </div>
          ) : null,
        )}
      </dl>
    </div>
  );
}
