export function jsonRequest(method: string, path: string, body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Second argument for dynamic route handlers: Next 16 passes params as a Promise. */
export function idParams<K extends string = "id">(value: string, key: K = "id" as K) {
  return { params: Promise.resolve({ [key]: value } as Record<K, string>) };
}
