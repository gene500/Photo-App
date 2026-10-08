import { randomBytes } from "node:crypto";
import type { PublicTrip } from "@/lib/types";
import { prisma } from "./db";
import { toPublicTripDto } from "./mappers";

/** 32 random bytes as base64url is exactly 43 characters. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export const newShareToken = () => randomBytes(32).toString("base64url");

/** The owner's share token, creating it on first use. Null when the trip is not theirs. */
export async function createShareToken(userId: string, tripId: string): Promise<string | null> {
  const trip = await prisma.trip.findFirst({ where: { id: tripId, userId }, select: { shareToken: true } });
  if (!trip) return null;
  if (trip.shareToken) return trip.shareToken;
  // Only fills an empty slot, so two concurrent requests settle on one token.
  await prisma.trip.updateMany({ where: { id: tripId, userId, shareToken: null }, data: { shareToken: newShareToken() } });
  const row = await prisma.trip.findFirst({ where: { id: tripId, userId }, select: { shareToken: true } });
  return row?.shareToken ?? null;
}

/** Revokes the link. False when the trip is not the user's. */
export async function revokeShareToken(userId: string, tripId: string): Promise<boolean> {
  const { count } = await prisma.trip.updateMany({ where: { id: tripId, userId }, data: { shareToken: null } });
  return count > 0;
}

/** The sanitized read-only trip for a share token, or null for an unknown, malformed or revoked one. */
export async function getSharedTrip(token: string): Promise<PublicTrip | null> {
  if (!TOKEN_RE.test(token)) return null;
  const row = await prisma.trip.findUnique({ where: { shareToken: token }, include: { stops: true } });
  return row ? toPublicTripDto(row) : null;
}
