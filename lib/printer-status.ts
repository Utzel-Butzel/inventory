import { z } from "zod";

// Device observations expire independently of the agent's heartbeat.
export const PRINTER_STATUS_TTL_MS = 45_000;
export const printerTelemetrySchema = z.object({
  host: z.string().trim().min(1).max(120),
  transport: z.enum(["bluetooth", "system"]),
  device: z.string().trim().max(200),
  state: z.enum(["ready", "busy", "unreachable", "error", "unknown"]),
  tape: z.number().min(0).max(1000).nullable(),
  detail: z.enum(["none", "connection", "device_error", "queue_only", "probe_failed"]),
  cancellation: z.enum(["transfer", "spooler", "process"]),
}).strict();
export type PrinterTelemetry = z.infer<typeof printerTelemetrySchema>;
export function effectivePrinterState(online: boolean, telemetry: PrinterTelemetry | null | undefined, checkedAt: string | null | undefined, now = Date.now()) {
  if (!online) return "offline";
  if (!telemetry || !checkedAt || !Number.isFinite(Date.parse(checkedAt)) || now - Date.parse(checkedAt) > PRINTER_STATUS_TTL_MS) return "unknown";
  return telemetry.state;
}
