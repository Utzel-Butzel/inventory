import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { bulk3dDeadlineMs } from "../lib/inventory-bulk-3d.ts";
import { readBulk3dJob, readBulk3dState, startBulk3dJob, cleanupBulk3dJobs } from "../lib/inventory-bulk-3d-jobs.ts";

test("durable jobs reject traversal, time out stale work, reuse IDs and clean up only expired job directories", async () => {
  const root=await mkdtemp(path.join(tmpdir(),"inventory-3d-test-")); const previous=process.env.BULK_3D_DATA_PATH; process.env.BULK_3D_DATA_PATH=root;
  try {
    assert.equal(await readBulk3dJob("../../sensitive"),null);
    const id=randomUUID(),resourceId=randomUUID(),createdAt=Date.now()-bulk3dDeadlineMs-40000;
    const dir=path.join(root,"jobs",id); await mkdir(dir,{recursive:true});
    const owner={organizationId:"org",actorHash:"actor",resourceId,createdAt,expiresAt:Date.now()+100000};
    await writeFile(path.join(dir,"owner.json"),JSON.stringify(owner)); await writeFile(path.join(dir,"state.json"),JSON.stringify({status:"reconstructing"}));
    assert.deepEqual(await readBulk3dState(id,createdAt),{status:"failed",code:"timeout"});
    assert.equal((await startBulk3dJob(id,owner,{},[])).jobId,id);
    await assert.rejects(startBulk3dJob(id,{...owner,actorHash:"other"},{},[]),/owner mismatch/);
    const unrelated=path.join(root,"jobs","keep-me"); await mkdir(unrelated);
    await writeFile(path.join(dir,"owner.json"),JSON.stringify({...owner,expiresAt:Date.now()-1}));
    await cleanupBulk3dJobs(); await assert.rejects(access(dir)); await access(unrelated);
  } finally { if(previous===undefined) delete process.env.BULK_3D_DATA_PATH; else process.env.BULK_3D_DATA_PATH=previous; await rm(root,{recursive:true,force:true}); }
});
