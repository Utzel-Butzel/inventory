import type { RoomWindowDetails } from "@/lib/room-ai-analysis-contract";

const boundedPaneCount = (value: number | null) =>
  Math.min(8, Math.max(1, value ?? 1));

export function resolveRoomWindowPaneGrid(
  details: RoomWindowDetails | null,
  dimensions: readonly [number, number],
) {
  if (details?.hasMuntins === false) {
    return { columns: 1, rows: 1 };
  }
  if (details?.hasMuntins === true) {
    let columns = boundedPaneCount(details.paneColumns);
    let rows = boundedPaneCount(details.paneRows);
    if (columns === 1 && rows === 1) {
      if (dimensions[0] >= dimensions[1]) columns = 2;
      else rows = 2;
    }
    return { columns, rows };
  }
  return {
    columns: dimensions[0] > 0.68 ? 2 : 1,
    rows: dimensions[1] > 1.05 ? 2 : 1,
  };
}
