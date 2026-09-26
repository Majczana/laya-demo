import type { Messages } from "./i18n";

export type Health = {
  status: string;
  model: string;
  device: string;
  engines?: Record<"laya" | "jev", { model: string; available: boolean }>;
};

const HEALTH_RETRY_MS = 1500;

type ApiErrorKind = "input" | "model" | "backend" | "unreachable" | "status";

/** Backend error classified so the UI can explain it in the current language. */
export class ApiError extends Error {
  constructor(readonly kind: ApiErrorKind, readonly status = 0, readonly detail = "") {
    super(`${kind} ${status} ${detail}`.trim());
  }
}

export function isAbort(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === "AbortError";
}

async function responseError(response: Response): Promise<ApiError> {
  let detail: unknown = null;
  try {
    detail = ((await response.json()) as { detail?: unknown }).detail;
  } catch {
    // Non-JSON bodies (e.g. a proxy error page) fall through to the defaults.
  }
  if (response.status === 422) {
    const first = Array.isArray(detail) ? (detail[0] as { msg?: string } | undefined)?.msg : null;
    return new ApiError("input", 422, (first ?? "invalid request").replace(/^Value error, /, ""));
  }
  // Jev failures (no API key, credits, rate limits) carry a readable detail.
  const message = typeof detail === "string" ? detail : "";
  if (response.status === 502) return new ApiError("model", 502, message);
  if (response.status >= 500) return new ApiError("backend", response.status, message);
  return new ApiError("status", response.status);
}

/** POSTs JSON and returns the parsed body; throws ApiError with a readable message. */
export async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (reason) {
    if (isAbort(reason)) throw reason;
    throw new ApiError("unreachable");
  }
  if (!response.ok) throw await responseError(response);
  return (await response.json()) as T;
}

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, { signal });
  if (!response.ok) throw await responseError(response);
  return (await response.json()) as T;
}

/**
 * Polls /health until the API is available. LAYA itself loads lazily when the
 * first prediction is requested, so the catalog can appear immediately.
 */
export async function waitForBackend(signal: AbortSignal, onWaiting?: () => void): Promise<Health> {
  for (;;) {
    try {
      return await getJson<Health>("/health", signal);
    } catch (reason) {
      if (isAbort(reason)) throw reason;
      onWaiting?.();
    }
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(resolve, HEALTH_RETRY_MS);
      signal.addEventListener("abort", () => {
        window.clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      }, { once: true });
    });
  }
}

export function errorText(reason: unknown, t: Messages, fallback: string): string {
  if (!(reason instanceof ApiError)) return fallback;
  if (reason.kind === "input") return t.errors.input(reason.detail);
  if (reason.kind === "status") return t.errors.status(reason.status);
  if (reason.kind === "unreachable") return t.errors.unreachable;
  return reason.detail ? `${t.errors[reason.kind]} (${reason.detail})` : t.errors[reason.kind];
}
