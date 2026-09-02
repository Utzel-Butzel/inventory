import { getPublicActionFlow } from "@/lib/public-action-flows";

type Context = { params: Promise<{ triggerId: string }> };

export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

export async function GET(_request: Request, context: Context) {
  const { triggerId } = await context.params;
  const action = await getPublicActionFlow(triggerId);
  if (!action) {
    return Response.json(
      { error: "This public action URL is not available." },
      { status: 404, headers },
    );
  }
  return Response.json({ action: action.view }, { headers });
}
