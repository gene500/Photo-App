import { clearAllCopies, getOwner } from "./offline-store";

const SESSION_URL = "/api/auth/session";
const CHECK_TIMEOUT_MS = 4000;

/**
 * Whether the saved trip copies may be shown on /offline, which is a public shell with no server-side login check.
 * - Online: only when the signed-in user is the one who saved the copies. Signed out, or a different user: the copies
 *   are wiped and the visitor is sent to /login.
 * - Offline (no network, or the session check cannot be reached): the copies are shown only if this device has an owner
 *   mark, i.e. a user signed in here and has not signed out; no owner mark means copies of unknown origin, which are wiped.
 */
export async function checkOfflineAccess(
  online: boolean = typeof navigator === "undefined" ? false : navigator.onLine,
  fetchFn: typeof fetch = (...a) => fetch(...a),
): Promise<"show" | "login"> {
  const offlineAnswer = (): "show" => {
    if (getOwner() === null) clearAllCopies();
    return "show";
  };
  if (!online) return offlineAnswer();
  let userId: string | null;
  try {
    const res = await fetchFn(SESSION_URL, { cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
    if (!res.ok) return offlineAnswer();
    const body = (await res.json()) as { user?: { id?: unknown } } | null;
    userId = typeof body?.user?.id === "string" ? body.user.id : null;
  } catch {
    return offlineAnswer();
  }
  const owner = getOwner();
  if (userId !== null && owner === userId) return "show";
  clearAllCopies();
  return userId === null ? "login" : "show"; // a signed-in user who is not the owner sees an empty list, never the old copies
}
