import { readFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { requireSessionPermission } from "@/lib/api-auth";
export const runtime = "nodejs";

// Fixed, credential-free source files only. No request-supplied filesystem paths.
const files = ["Enable-PrinterRecovery.ps1", "spool_queue.py", "spool-queue.ps1", "inventory_print_agent.py", "macos_ptouch_bluetooth.m", "install_macos.py", "InventoryPrintAgent.ps1", "Install-InventoryPrintAgent.ps1", "Install-SystemPrintAgent.ps1", "README.md"];
export async function GET(request: Request) {
  const auth = await requireSessionPermission(request, "tokens.manage");
  if (auth.response) return auth.response;
  const chunks: Buffer[] = [];
  for (const name of files) {
    const content = await readFile(path.join(process.cwd(), "scripts/print-agent", name));
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, "utf8");
    const octal = (value: number, offset: number, length: number) => header.write(value.toString(8).padStart(length - 1, "0") + "\0", offset, length, "ascii");
    octal(0o600, 100, 8); octal(0, 108, 8); octal(0, 116, 8);
    octal(content.length, 124, 12); octal(0, 136, 12);
    header.fill(32, 148, 156); header.write("0", 156); header.write("ustar\0", 257); header.write("00", 263);
    octal(header.reduce((sum, byte) => sum + byte, 0), 148, 7); header[155] = 32;
    chunks.push(header, content, Buffer.alloc((512 - content.length % 512) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  return new Response(new Uint8Array(gzipSync(Buffer.concat(chunks))), { headers: {
    "Content-Type": "application/gzip", "Content-Disposition": 'attachment; filename="inventory-print-agent.tar.gz"',
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
  } });
}
