import { z } from "zod";
import { chainRequest } from "@/lib/action-chain-http";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ triggerId: string; mode: string }> }) {
  const { triggerId, mode } = await context.params;
  if (!z.string().uuid().safeParse(triggerId).success || !["preview", "execute"].includes(mode)) return Response.json({ error: "Not found." }, { status: 404 });
  return chainRequest(request, mode === "preview", triggerId);
}
