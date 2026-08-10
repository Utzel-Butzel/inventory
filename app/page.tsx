import { redirect } from "next/navigation";

import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await auth();
  redirect(session?.user ? "/dashboard" : "/login");
}
