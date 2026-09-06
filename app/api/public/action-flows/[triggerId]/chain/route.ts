import { z } from "zod";
import { chainConfiguration } from "@/lib/action-chain-http";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ triggerId: string }> }) {
  const { triggerId } = await context.params;
  if (!z.string().uuid().safeParse(triggerId).success) return Response.json({ error: "Not found." }, { status: 404 });
  return chainConfiguration(request, undefined, triggerId);
}
