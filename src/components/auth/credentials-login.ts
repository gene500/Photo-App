import { getProviders, signIn } from "next-auth/react";

export type CredentialsOutcome = { ok: true } | { ok: false; kind: "invalid" | "rate" | "server" | "network" | "csrf"; message: string };

const RATE = "Too many login attempts. Try again in a few minutes.";
const SERVER = "The server had a problem. Try again in a moment.";
const NETWORK = "Couldn't reach the server. Check your connection and try again.";
const CSRF = "Your login page expired. Reload the page and try again.";

/**
 * Signs in with email and password without ever letting next-auth navigate away. next-auth redirects the whole page
 * (losing the typed email) when its providers endpoint fails, so that is checked first; it also hides a failed CSRF
 * request (no error, but `csrf=true` in the returned url) and the HTTP status of 429/500 answers, which are told apart here.
 */
export async function signInWithCredentials(email: string, password: string): Promise<CredentialsOutcome> {
  try {
    const providers = await getProviders();
    if (!providers) return { ok: false, kind: "network", message: NETWORK };
  } catch {
    return { ok: false, kind: "network", message: NETWORK };
  }
  let res: Awaited<ReturnType<typeof signIn>>;
  try {
    res = await signIn("credentials", { email, password, redirect: false });
  } catch (e) {
    // The server answered, but with a body next-auth could not parse (a text page): that is a server problem, not a network one.
    if (e instanceof SyntaxError) return { ok: false, kind: "server", message: SERVER };
    return { ok: false, kind: "network", message: NETWORK };
  }
  if (!res) return { ok: false, kind: "server", message: SERVER };
  if (res.status === 429 || res.error === "RateLimited") return { ok: false, kind: "rate", message: RATE };
  if (typeof res.url === "string" && /[?&]csrf=true/.test(res.url)) return { ok: false, kind: "csrf", message: CSRF };
  if (res.status >= 500) return { ok: false, kind: "server", message: SERVER };
  if (res.error) return { ok: false, kind: "invalid", message: "Invalid email or password" };
  return { ok: true };
}
