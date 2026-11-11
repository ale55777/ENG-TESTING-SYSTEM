export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "") + "/api/v1";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Options = Omit<RequestInit, "body"> & { body?: unknown; timeoutMs?: number };

/** Fetch wrapper: cookie auth, CSRF header, JSON/FormData bodies, readable errors, timeouts. */
export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const res = await apiRaw(path, opts);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function apiRaw(path: string, opts: Options = {}): Promise<Response> {
  const { body, timeoutMs = 120_000, headers, ...rest } = opts;
  const h = new Headers(headers);
  h.set("X-Requested-With", "fetch");
  let payload: BodyInit | undefined;
  if (body instanceof FormData || body instanceof Blob) payload = body;
  else if (body !== undefined) {
    h.set("Content-Type", "application/json");
    payload = JSON.stringify(body);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  if (rest.signal) rest.signal.addEventListener("abort", () => ctrl.abort());
  let res: Response;
  try {
    res = await fetch(API_BASE + path, { credentials: "include", ...rest, headers: h, body: payload, signal: ctrl.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      throw new ApiError(0, rest.signal?.aborted ? "Request cancelled" : "The request timed out. Check your connection and try again.");
    }
    throw new ApiError(0, "Cannot reach the server. Check that the backend is running and your network connection.");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let msg = res.statusText || "Request failed";
    try {
      const j = await res.json();
      if (typeof j.detail === "string") msg = j.detail;
      else if (Array.isArray(j.detail)) msg = j.detail.map((d: { msg?: string }) => d.msg).join("; ");
    } catch {
      /* non-JSON error */
    }
    if (res.status === 429) msg = msg || "Too many requests. Please wait a moment.";
    throw new ApiError(res.status, msg);
  }
  return res;
}

export async function downloadFile(path: string, fallbackName: string) {
  const res = await apiRaw(path);
  const cd = res.headers.get("Content-Disposition") || "";
  const name = /filename="([^"]+)"/.exec(cd)?.[1] || fallbackName;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "Something went wrong";
}
