import { handle, requireUserId } from "@/server/http";
import { enforceLimit } from "@/server/rate-limit";
import { revokeAllSessions } from "@/server/users";

/** "Sign out everywhere": invalidates every sign-in token for this user, including the one making the request. */
export const DELETE = handle(async () => {
  const userId = await requireUserId();
  enforceLimit("trip-write", userId);
  await revokeAllSessions(userId);
  return new Response(null, { status: 204 });
});
