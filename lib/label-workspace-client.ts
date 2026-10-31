import type { LabelSetupDto } from "@/lib/label-setup-contract";
import type { LabelResource } from "@/lib/label-target";
import type { PtouchTape } from "@/lib/ptouch-raster";
import type { SavedLabel } from "@/lib/label-workspace-contract";

import type { LabelSnapshot } from "@/lib/label-document";

export type PreparedLabel = {
  snapshot?: LabelSnapshot;
  id: string; name: string; template: string; tape: PtouchTape; widthMm: number;
  data: Uint8Array; preview: string; resource: LabelResource; original: LabelResource; setup: LabelSetupDto;
};
export function serializePreparedLabel(label: PreparedLabel): SavedLabel {
  let binary = "";
  for (let i = 0; i < label.data.length; i += 8192) binary += String.fromCharCode(...label.data.subarray(i, i + 8192));
  return { ...label, data: btoa(binary) };
}
export function deserializePreparedLabel(label: SavedLabel): PreparedLabel {
  return { ...label, tape: label.tape as PtouchTape, data: Uint8Array.from(atob(label.data), c => c.charCodeAt(0)) };
}
