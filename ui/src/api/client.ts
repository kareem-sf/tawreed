import createClient from "openapi-fetch";
import type { Key, Translate } from "../i18n";
import type { components, paths } from "./schema";

export type Project = components["schemas"]["ProjectOut"];
export type ProjectSummary = components["schemas"]["ProjectSummary"];
export type Source = components["schemas"]["SourceOut"];
export type Settings = components["schemas"]["SettingsOut"];
export type About = components["schemas"]["AboutOut"];
export type Connection = components["schemas"]["ConnectionOut"];
export type Provider = Connection["provider"];
export type ModelCheck = components["schemas"]["ModelCheck"];
export type SourceDetail = components["schemas"]["SourceDetail"];
export type SourcePage = components["schemas"]["PageOut"];
export type SheetView = components["schemas"]["SheetView"];

const base = `${window.location.origin}/api`;

/** A failure the interface can explain: the service's stable code and details, or "offline". */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly params: Record<string, string> = {},
    readonly status = 0,
  ) {
    super(code);
  }
}

function offline(): never {
  // The browser only says "Failed to fetch" when the local service isn't there at all.
  throw new ApiError("offline");
}

// The development server forwards /api to the local service and adds the access token.
export const api = createClient<paths>({
  baseUrl: base,
  fetch: (request) => globalThis.fetch(request).catch(offline),
});

async function failure(response: Response, body?: unknown): Promise<ApiError> {
  const detail = ((body ?? (await response.json().catch(() => ({})))) as { detail?: unknown }).detail;
  if (detail && typeof detail === "object" && "code" in detail) {
    const { code, ...params } = detail as { code: string } & Record<string, string>;
    return new ApiError(code, params, response.status);
  }
  return new ApiError("unknown", {}, response.status);
}

/** The response data, or an ApiError carrying the service's own code. */
export async function must<T>(pending: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const result = await pending;
  if (result.data !== undefined) return result.data;
  throw await failure(result.response, result.error);
}

/** Send dropped files as a multipart form (openapi-fetch types can't describe File lists). */
export async function upload(path: string, files: File[]): Promise<Project> {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  const response = await globalThis.fetch(`${base}${path}`, { method: "POST", body: form }).catch(offline);
  if (!response.ok) throw await failure(response);
  return (await response.json()) as Project;
}

/** A page image as a blob: fetched like every other request, so it carries the same access as they do. */
export async function pageImage(projectId: string, sourceId: string, page: number): Promise<Blob> {
  const path = `${base}/projects/${projectId}/sources/${sourceId}/pages/${page}/image`;
  const response = await globalThis.fetch(path).catch(offline);
  if (!response.ok) throw await failure(response);
  return response.blob();
}

/** A plain sentence for the engineer, in their language. */
export function explain(error: unknown, t: Translate): string {
  if (error instanceof ApiError) {
    const key = `error.${error.code}` as Key;
    if (t(key) !== key) return t(key, error.params);
    return t("error.unknown", { status: error.status || "?" });
  }
  return t("error.unknown", { status: "?" });
}
