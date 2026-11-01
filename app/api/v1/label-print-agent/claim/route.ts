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
      .object({ claimId: z.uuid(), formats: z.array(z.enum(["ptouch", "pdf"])).min(1).max(2).default(["ptouch"]) })
      .strict()
      .safeParse(await boundedPrintJson(request, 1024));
    if (!parsed.success)
      return Response.json({ error: "Invalid claim." }, { status: 400 });
    const requiredFormat = printer.kind === "system" ? "pdf" : "ptouch";
    if (!parsed.data.formats.includes(requiredFormat))
      return Response.json({ error: "This printer requires an agent with PDF support." }, { status: 409 });
    return Response.json(
      { job: await claimSharedPrint(String(printer.id), parsed.data.claimId) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return printFailure(e);
  }
}
