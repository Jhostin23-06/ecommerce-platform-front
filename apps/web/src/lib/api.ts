import type { Tenant } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  token?: string | null;
  body?: unknown;
  formData?: FormData;
  headers?: Record<string, string>;
};

export class ApiError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  let body: BodyInit | undefined;
  if (options.formData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  const response = await fetch(`${API_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body,
    credentials: "include",
    cache: "no-store",
  });

  const responseText = await response.text();
  const payload = responseText ? safeJson(responseText) : null;

  if (!response.ok) {
    const message = extractErrorMessage(payload) ?? `Request failed (${response.status})`;
    throw new ApiError(message, response.status, payload);
  }

  return payload as T;
}

export async function resolveTenantBySlug(tenantSlug: string): Promise<Tenant> {
  const tenants = await apiRequest<Tenant[]>("/tenants");
  const tenant = tenants.find((entry) => entry.slug === tenantSlug);

  if (!tenant) {
    throw new ApiError(`No existe el tenant "${tenantSlug}"`, 404, null);
  }

  return tenant;
}

export async function resolveTenantById(tenantId: string): Promise<Tenant> {
  return apiRequest<Tenant>(`/tenants/${tenantId}`);
}

export async function resolveTenantByKey(tenantKey: string): Promise<Tenant> {
  try {
    return await resolveTenantBySlug(tenantKey);
  } catch {
    return resolveTenantById(tenantKey);
  }
}

function safeJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function extractErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const maybeMessage = (payload as { message?: unknown }).message;

  if (typeof maybeMessage === "string") {
    return maybeMessage;
  }

  if (Array.isArray(maybeMessage)) {
    const stringMessage = maybeMessage.find((entry) => typeof entry === "string");
    return typeof stringMessage === "string" ? stringMessage : null;
  }

  return null;
}
