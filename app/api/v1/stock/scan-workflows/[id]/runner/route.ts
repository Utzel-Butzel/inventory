import { z } from "zod";
import { chainConfiguration } from "@/lib/action-chain-http";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "Invalid workflow id." }, { status: 422 });
  return chainConfiguration(request, id);
}
export const POST = GET;
