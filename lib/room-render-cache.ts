import type { RoomAiAnalysis } from "@/lib/room-ai-analysis-contract";

/** Device-local completed render cache. Failures never prevent room viewing. */
const databaseName = "inventory-room-renders-v1";
const maximumBytes = 192 * 1024 * 1024;
const maximumEntries = 12;
type StoredRender = {
  key: string;
  value: unknown;
  bytes: number;
  touched: number;
};

export function stableRoomRenderInput(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(stableRoomRenderInput).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableRoomRenderInput(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export async function roomRenderCacheKey(value: unknown) {
  const bytes = new TextEncoder().encode(stableRoomRenderInput(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `room-render-v1-${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("renders", { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("cache-blocked"));
  });
}
export async function readRoomRenderCache<T>(key: string): Promise<T | null> {
  let db: IDBDatabase | undefined;
  try {
    db = await openDatabase();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db!.transaction("renders", "readwrite");
      const store = tx.objectStore("renders");
      const request = store.get(key);
      let value: T | null = null;
      request.onsuccess = () => {
        const entry = request.result as StoredRender | undefined;
        if (entry) {
          value = entry.value as T;
          store.put({ ...entry, touched: Date.now() });
        }
      };
      tx.oncomplete = () => resolve(value);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } catch {
    return null;
  } finally {
    db?.close();
  }
}
export async function writeRoomRenderCache(
  key: string,
  value: unknown,
  bytes: number,
): Promise<boolean> {
  if (bytes > maximumBytes || bytes <= 0) return false;
  let db: IDBDatabase | undefined;
  try {
    db = await openDatabase();
    return await new Promise<boolean>((resolve, reject) => {
      const tx = db!.transaction("renders", "readwrite");
      const store = tx.objectStore("renders");
      const request = store.openCursor();
      const entries: Array<Pick<StoredRender, "key" | "bytes" | "touched">> =
        [];
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const entry = cursor.value as StoredRender;
          if (entry.key !== key)
            entries.push({
              key: entry.key,
              bytes: entry.bytes,
              touched: entry.touched,
            });
          cursor.continue();
        } else {
          entries.sort((a, b) => a.touched - b.touched);
          let total = entries.reduce((sum, e) => sum + e.bytes, bytes);
          while (entries.length >= maximumEntries || total > maximumBytes) {
            const entry = entries.shift();
            if (!entry) break;
            store.delete(entry.key);
            total -= entry.bytes;
          }
          store.put({
            key,
            value,
            bytes,
            touched: Date.now(),
          } satisfies StoredRender);
        }
      };
      tx.oncomplete = () => resolve(true);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

/** Only accepted appearance affects lighting; reanalysis metadata does not. */
export function roomLightingAnalysisState(
  analysis: RoomAiAnalysis | null | undefined,
) {
  if (
    !analysis ||
    (!analysis.surfaceAppearances.some((item) => item.status === "accepted") &&
      !analysis.objectSuggestions.some((item) => item.status === "accepted"))
  )
    return null;
  return {
    surfaces: analysis.surfaceAppearances
      .filter((item) => item.status === "accepted")
      .map((item) => ({
        category: item.surfaceCategory,
        color: item.colorHex,
        material: item.material,
        roughness: item.roughness,
        windowDetails: item.windowDetails,
      })),
    objects: analysis.objectSuggestions
      .filter((item) => item.status === "accepted")
      .map((item) => ({
        roomObjectId: item.roomObjectId,
        name: item.name,
        category: item.category,
        color: item.colorHex,
        material: item.material,
        model: item.primitiveModel,
        modelVariant: item.modelVariant,
        placement: item.estimatedPlacement,
      })),
  };
}
