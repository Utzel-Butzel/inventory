import { z } from "zod";

import { requirePermission } from "@/lib/api-auth";
import {
  internalRequestHttpError,
  listReservationCalendar,
} from "@/lib/internal-requests";

const rangeSchema = z
  .object({
    from: z.string().datetime(),
    to: z.string().datetime(),
  })
  .refine((value) => new Date(value.to) > new Date(value.from), {
    message: "The calendar end must be after its start.",
    path: ["to"],
  })
  .refine(
    (value) =>
      new Date(value.to).getTime() - new Date(value.from).getTime() <=
      370 * 86_400_000,
    { message: "A calendar range may cover at most 370 days.", path: ["to"] },
  );

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await requirePermission(request, "requests.read");
  if (authorization.response) return authorization.response;
  const url = new URL(request.url);
  const parsed = rangeSchema.safeParse({
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
  });
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid calendar range.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  const identity = authorization.identity;
  try {
    return Response.json(
      await listReservationCalendar(
        identity.organizationId,
        {
          subject: identity.subject,
          userId: identity.userId,
          canManage: identity.permissions.includes("requests.manage"),
        },
        {
          from: new Date(parsed.data.from),
          to: new Date(parsed.data.to),
          includeAssignments: identity.permissions.includes("assignments.read"),
        },
      ),
    );
  } catch (error) {
    const failure = internalRequestHttpError(error, "Unable to load the reservation calendar.");
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
