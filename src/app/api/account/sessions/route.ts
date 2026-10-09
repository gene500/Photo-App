import { handle, requireUserId } from "@/server/http";
import { revokeAllSessions } from "@/server/users";

/** "Sign out everywhere": invalidates every sign-in token for this user, including the one making the request. */
export const DELETE = handle(async () => {
  const userId = await requireUserId();
  await revokeAllSessions(userId);
  return new Response(null, { status: 204 });
});
