import { z } from "zod";
import { boundedPrintJson } from "@/lib/shared-label-print-contract";
import {
  agentPrinter,
  claimSharedPrint,
  printFailure,
} from "@/lib/shared-label-printing";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const printer = await agentPrinter(request);
    const parsed = z
      .object({ claimId: z.uuid() })
      .strict()
      .safeParse(await boundedPrintJson(request, 1024));
    if (!parsed.success)
      return Response.json({ error: "Invalid claim." }, { status: 400 });
    return Response.json(
      { job: await claimSharedPrint(String(printer.id), parsed.data.claimId) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return printFailure(e);
  }
}
