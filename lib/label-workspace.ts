import "server-only";
import { snapshotPng } from "@/lib/label-document-pdf";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { PrintFailure } from "@/lib/shared-label-printing";
import { validateSharedRasters } from "@/lib/shared-label-print-contract";
import { LABEL_WORKSPACE_LIMIT, type LabelWorkspace, type LabelWorkspaceMutation } from "@/lib/label-workspace-contract";

export async function readLabelWorkspace(organizationId: string, userId: string): Promise<LabelWorkspace> {
  const [row] = await db.execute(sql`SELECT revision,labels,preferences FROM label_workspaces WHERE organization_id=${organizationId} AND user_id=${userId}`);
  return row ? row as LabelWorkspace : { revision: 0, labels: [], preferences: {} };
}
export async function updateLabelWorkspace(organizationId: string, userId: string, mutation: LabelWorkspaceMutation): Promise<LabelWorkspace> {
  if (mutation.action === "queue" && mutation.labels.length) {
    if (Buffer.byteLength(JSON.stringify(mutation.labels)) > LABEL_WORKSPACE_LIMIT) throw new PrintFailure("Die Druckliste ist zu groß.", 413);
    try {
      for (const label of mutation.labels) {
        if (label.data) validateSharedRasters([Buffer.from(label.data, "base64")], label.tape);
        if (label.snapshot) await snapshotPng(label.snapshot);
        else if (!label.data) throw new Error("Missing print data");
      }
    } catch { throw new PrintFailure("Ungültige oder beschädigte Druckdaten.", 422); }
  }
  return db.transaction(async tx => {
    await tx.execute(sql`INSERT INTO label_workspaces (organization_id,user_id) VALUES (${organizationId},${userId}) ON CONFLICT DO NOTHING`);
    const [current] = await tx.execute(sql`SELECT revision,labels,preferences FROM label_workspaces WHERE organization_id=${organizationId} AND user_id=${userId} FOR UPDATE`);
    if (mutation.action === "queue") {
      // A stale browser must never replace a newer saved list.
      if (current.revision !== mutation.revision) throw new PrintFailure("Die Druckliste wurde in einem anderen Fenster geändert. Bitte neu laden.", 409);
      const [saved] = await tx.execute(sql`UPDATE label_workspaces SET labels=${JSON.stringify(mutation.labels)}::jsonb,revision=revision+1,updated_at=now() WHERE organization_id=${organizationId} AND user_id=${userId} RETURNING revision,labels,preferences`);
      return saved as LabelWorkspace;
    }
    const [saved] = await tx.execute(sql`UPDATE label_workspaces SET preferences=preferences || ${JSON.stringify(mutation.preferences)}::jsonb,updated_at=now() WHERE organization_id=${organizationId} AND user_id=${userId} RETURNING revision,labels,preferences`);
    return saved as LabelWorkspace;
  });
}
