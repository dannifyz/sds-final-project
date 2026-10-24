// All backend calls go through nginx on the same origin, so the session
// cookie is sent automatically.

export type Ticket = {
  event: string;
  attendeeName: string;
  seat: string;
  iss?: string;
  sub?: string;
  iat?: number;
  jti?: string;
};

export type SignResult = { token: string; qr: string; ticket: Ticket };
export type VerifyResult =
  | { valid: true; ticket: Ticket }
  | { valid: false; error: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`);
  }
  return body as T;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const api = {
  login: (username: string, password: string) =>
    request<{ username: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<null>("/api/auth/logout", { method: "POST" }),
  me: () => request<{ username: string }>("/api/auth/me"),
  sign: (data: Pick<Ticket, "event" | "attendeeName" | "seat">) =>
    request<SignResult>("/api/sign", { method: "POST", body: JSON.stringify(data) }),
  // /verify answers 401 with a JSON body for bad tickets; surface that as a result, not an exception.
  verify: async (token: string): Promise<VerifyResult> => {
    const res = await fetch(`/api/verify?token=${encodeURIComponent(token)}`);
    const body = await res.json().catch(() => null);
    if (body && typeof body.valid === "boolean") return body;
    return { valid: false, error: `Request failed (${res.status})` };
  },
};
