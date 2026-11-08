/** Small per-device markers that belong to one account and are removed when it is deleted (best effort, never throws). */
export function clearAccountLeftovers(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith("autoFirstStop:") || k === "nextauth.message")) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    /* storage unavailable */
  }
}

/** Only next-auth's own cross-tab message; safe on every sign-out. */
export function clearAuthMessage(): void {
  try {
    localStorage.removeItem("nextauth.message");
  } catch {
    /* storage unavailable */
  }
}
