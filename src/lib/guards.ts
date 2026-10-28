// Small type guards for checking untrusted JSON (storage, API bodies, upstream answers); safe for client and server.

export const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
