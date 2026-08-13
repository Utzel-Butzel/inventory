import { asc, eq, sql } from "drizzle-orm";

import {
  media,
  mediaUploadBatchItems,
  mediaUploadBatches,
  resources,
  type MediaRecord,
} from "@/db/schema";
import { requireResourcePermission } from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  idempotencyResponseHeaders,
  readIdempotencyKey,
} from "@/lib/idempotency";
import { getResource } from "@/lib/resources";
import {
  isUsdzMediaType,
  validateResourceMediaUpload,
} from "@/lib/resource-media-contract";
import {
  assertStorageSupportsMediaType,
  deleteStoredMedia,
  maxUploadBytes,
  maxUsdzUploadBytes,
  storeMedia,
  type StoredMedia,
  UnsupportedStorageMediaTypeError,
} from "@/lib/storage";
import { validateUsdzPackage } from "@/lib/usdz-package";

type Context = { params: Promise<{ id: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadUploadBatch(idempotencyKey: string) {
  const [batch] = await db
    .select()
    .from(mediaUploadBatches)
    .where(eq(mediaUploadBatches.idempotencyKey, idempotencyKey))
    .limit(1);
  if (!batch) return null;
  const uploaded = await db
    .select({ item: media })
    .from(mediaUploadBatchItems)
    .innerJoin(media, eq(media.id, mediaUploadBatchItems.mediaId))
    .where(eq(mediaUploadBatchItems.batchId, batch.id))
    .orderBy(asc(media.position));
  return { batch, uploaded: uploaded.map((row) => row.item) };
}

async function listResourceMedia(resourceId: string) {
  return db
    .select()
    .from(media)
    .where(eq(media.resourceId, resourceId))
    .orderBy(asc(media.position));
}

async function cleanupStoredBatch(items: StoredMedia[]) {
  const results = await Promise.allSettled(items.map(deleteStoredMedia));
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason);
  if (failures.length) {
    throw new AggregateError(failures, "Unable to clean up uploaded media.");
  }
}

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const authorization = await requireResourcePermission(
    request,
    "inventory.update",
    id,
  );
  if (authorization.response) return authorization.response;
  const idempotency = readIdempotencyKey(request);
  if (idempotency.error) return idempotency.error;
  const resource = await getResource(id);
  if (!resource) return Response.json({ error: "Not found" }, { status: 404 });

  if (idempotency.key) {
    const replay = await loadUploadBatch(idempotency.key);
    if (replay) {
      if (replay.batch.resourceId !== id) {
        return Response.json(
          { error: "That Idempotency-Key belongs to another resource." },
          { status: 409 },
        );
      }
      return Response.json(
        {
          media: await listResourceMedia(id),
          uploaded: replay.uploaded,
          batch: {
            id: replay.batch.id,
            idempotencyKey: replay.batch.idempotencyKey,
          },
        },
        {
          status: 200,
          headers: idempotencyResponseHeaders(idempotency.key, true),
        },
      );
    }
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Invalid multipart upload." }, { status: 400 });
  }
  const files = form
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);
  if (!files.length || files.length > 12) {
    return Response.json(
      { error: "Upload between 1 and 12 files at a time." },
      { status: 400 },
    );
  }
  const regularSizeLimit = maxUploadBytes();
  const usdzSizeLimit = maxUsdzUploadBytes();
  for (const file of files) {
    const validation = validateResourceMediaUpload(
      file,
      isUsdzMediaType(file.type) ? usdzSizeLimit : regularSizeLimit,
    );
    if (!validation.valid) {
      return Response.json(
        { error: validation.error },
        { status: validation.status },
      );
    }
    if (isUsdzMediaType(file.type)) {
      const packageValidation = validateUsdzPackage(
        new Uint8Array(await file.arrayBuffer()),
      );
      if (!packageValidation.valid) {
        return Response.json(
          { error: `${file.name} is not a valid USDZ package: ${packageValidation.error}` },
          { status: 415 },
        );
      }
    }
  }

  try {
    for (const file of files) assertStorageSupportsMediaType(file.type);
  } catch (error) {
    if (error instanceof UnsupportedStorageMediaTypeError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }

  const storedFiles: StoredMedia[] = [];
  try {
    for (const file of files) {
      storedFiles.push(
        await storeMedia({
          bytes: Buffer.from(await file.arrayBuffer()),
          mimeType: file.type,
          originalName: file.name || "upload",
          resourceId: id,
        }),
      );
    }
  } catch (error) {
    try {
      await cleanupStoredBatch(storedFiles);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Upload failed and its stored files could not be fully cleaned up.",
      );
    }
    throw error;
  }

  type CommitResult =
    | { kind: "created"; uploaded: MediaRecord[]; batchId: string | null }
    | { kind: "replay"; batchId: string }
    | { kind: "conflict" };

  let committed: CommitResult;
  try {
    committed = await db.transaction(async (transaction): Promise<CommitResult> => {
      let batchId: string | null = null;
      if (idempotency.key) {
        const [batch] = await transaction
          .insert(mediaUploadBatches)
          .values({ idempotencyKey: idempotency.key, resourceId: id })
          .onConflictDoNothing({ target: mediaUploadBatches.idempotencyKey })
          .returning();
        if (!batch) {
          const [winner] = await transaction
            .select()
            .from(mediaUploadBatches)
            .where(eq(mediaUploadBatches.idempotencyKey, idempotency.key))
            .limit(1);
          if (!winner || winner.resourceId !== id) return { kind: "conflict" };
          return { kind: "replay", batchId: winner.id };
        }
        batchId = batch.id;
      }

      // Serialize position allocation per resource while keeping file I/O outside
      // the transaction, so concurrent batches cannot receive overlapping slots.
      await transaction.execute(
        sql`select ${resources.id} from ${resources} where ${resources.id} = ${id} for update`,
      );
      const [{ highest }] = await transaction
        .select({ highest: sql<number>`coalesce(max(${media.position}), -1)::int` })
        .from(media)
        .where(eq(media.resourceId, id));
      const uploaded = await transaction
        .insert(media)
        .values(
          storedFiles.map((stored, index) => ({
            resourceId: id,
            ...stored,
            position: Number(highest ?? -1) + index + 1,
            source: "upload",
          })),
        )
        .returning();
      if (batchId) {
        await transaction.insert(mediaUploadBatchItems).values(
          uploaded.map((item) => ({ batchId, mediaId: item.id })),
        );
      }
      return { kind: "created", uploaded, batchId };
    });
  } catch (error) {
    try {
      await cleanupStoredBatch(storedFiles);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Database commit failed and stored files could not be fully cleaned up.",
      );
    }
    throw error;
  }

  if (committed.kind !== "created") {
    await cleanupStoredBatch(storedFiles);
    if (committed.kind === "conflict") {
      return Response.json(
        { error: "That Idempotency-Key belongs to another resource." },
        { status: 409 },
      );
    }
    const replay = await loadUploadBatch(idempotency.key!);
    if (!replay) {
      return Response.json({ error: "Unable to replay upload batch." }, { status: 500 });
    }
    return Response.json(
      {
        media: await listResourceMedia(id),
        uploaded: replay.uploaded,
        batch: {
          id: replay.batch.id,
          idempotencyKey: replay.batch.idempotencyKey,
        },
      },
      {
        status: 200,
        headers: idempotencyResponseHeaders(idempotency.key!, true),
      },
    );
  }

  const response = {
    media: await listResourceMedia(id),
    uploaded: committed.uploaded,
    batch: idempotency.key
      ? { id: committed.batchId, idempotencyKey: idempotency.key }
      : null,
  };
  return Response.json(response, {
    status: 201,
    headers: idempotency.key
      ? idempotencyResponseHeaders(idempotency.key, false)
      : undefined,
  });
}

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const authorization = await requireResourcePermission(
    request,
    "inventory.update",
    id,
  );
  if (authorization.response) return authorization.response;
  const resource = await getResource(id);
  if (!resource) return Response.json({ error: "Not found" }, { status: 404 });

  let body: { order?: unknown };
  try {
    body = (await request.json()) as { order?: unknown };
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }
  if (
    !Array.isArray(body.order) ||
    body.order.length !== resource.media.length ||
    body.order.some((entry) => typeof entry !== "string") ||
    new Set(body.order).size !== resource.media.length ||
    body.order.some((entry) => !resource.media.some((item) => item.id === entry))
  ) {
    return Response.json({ error: "Order must contain every media id once." }, { status: 422 });
  }
  const order = body.order as string[];

  await db.transaction(async (transaction) => {
    for (const [position, mediaId] of order.entries()) {
      await transaction
        .update(media)
        .set({ position })
        .where(eq(media.id, mediaId as string));
    }
  });
  return Response.json({ resource: await getResource(id) });
}
