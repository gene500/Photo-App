import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/server/session";

export default async function Home() {
  redirect((await getCurrentUserId()) ? "/trips" : "/login");
}
