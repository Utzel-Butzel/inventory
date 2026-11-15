import test from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import sharp from "sharp";
import { DEFAULT_PRINT_MEDIA } from "../lib/label-document.ts";
import { readFile } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import { encodePtouchRaster } from "../lib/ptouch-raster.ts";
const url = process.env.TEST_DATABASE_URL;
test(
  "shared print queue is tenant-scoped, idempotent, bounded and never reclaims uncertain jobs",
  { skip: !url },
  async () => {
    const schema = "print_test_" + randomUUID().replaceAll("-", "");
    const admin = postgres(url, { max: 1 });
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    const connection = postgres(url, {
      max: 8,
      connection: { search_path: schema },
    });
    globalThis.inventorySql = connection;
    try {
      await connection`CREATE TABLE organizations(id uuid PRIMARY KEY,is_read_only boolean NOT NULL DEFAULT false)`;
      await connection.unsafe(
        await readFile(
          new URL(
            "../db/migrations/0070_shared_label_printing.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      await connection.unsafe(await readFile(new URL("../db/migrations/0074_general_printing.sql", import.meta.url), "utf8"));
      await connection.unsafe(await readFile(new URL("../db/migrations/0081_printer_status_and_cancellation.sql", import.meta.url), "utf8"));
      await connection.unsafe(await readFile(new URL("../db/migrations/0082_spool_queue.sql", import.meta.url), "utf8"));
      const {
        cancelSharedPrint, controlSharedPrint,
        enqueueSharedPrint,
        claimSharedPrint,
        agentPrinter,
        printHash,
        checkPrintMutation,
      } = await import("../lib/shared-label-printing.ts");
      const org = randomUUID(),
        otherOrg = randomUUID(),
        printer = randomUUID();
      const token = "iprt_" + randomBytes(32).toString("base64url");
      await connection`INSERT INTO organizations(id) VALUES(${org}),(${otherOrg})`;
      await connection`INSERT INTO label_printers(id,organization_id,name,token_hash) VALUES(${printer},${org},'Test printer',${printHash(token)})`;
      await connection`UPDATE label_printers SET last_seen_at=now()`;
      const identity = {
        organizationId: org,
        subject: "test-user",
        organization: { isReadOnly: false },
      };
      const data = Buffer.from(
        encodePtouchRaster(
          { width: 8, height: 1, data: new Uint8ClampedArray(32) },
          24,
        ),
      ).toString("base64");
      const input = {
        id: randomUUID(),
        printerId: printer,
        tape: 24,
        labels: [data],
      };
      await assert.rejects(
        () =>
          enqueueSharedPrint({ ...identity, organizationId: otherOrg }, input),
        (e) => e.status === 404,
      );
      const repeated = await Promise.all(
        Array.from({ length: 6 }, () => enqueueSharedPrint(identity, input)),
      );
      assert.ok(repeated.every((j) => j.id === input.id));
      assert.equal(
        (await connection`SELECT * FROM label_print_jobs`).length,
        1,
      );
      await assert.rejects(
        () =>
          enqueueSharedPrint({ ...identity, subject: "another-user" }, input),
        (e) => e.status === 409,
      );
      const claims = await Promise.all(
        Array.from({ length: 6 }, () =>
          claimSharedPrint(printer, randomUUID()),
        ),
      );
      assert.equal(claims.filter(Boolean).length, 1);
      const [claimed] = await connection`SELECT * FROM label_print_jobs`;
      assert.equal(
        (await claimSharedPrint(printer, claimed.claim_id)).id,
        input.id,
      );
      await connection`UPDATE label_print_jobs SET claimed_at=now()-interval '6 minutes'`;
      assert.equal(await claimSharedPrint(printer, randomUUID()), null);
      assert.equal(
        (await connection`SELECT status,payload FROM label_print_jobs`)[0]
          .status,
        "uncertain",
      );
      assert.equal(
        (await connection`SELECT payload FROM label_print_jobs`)[0].payload,
        null,
      );
      const next = { ...input, id: randomUUID() };
      await enqueueSharedPrint(identity, next);
      await connection`UPDATE label_print_jobs SET expires_at=now()-interval '1 minute' WHERE id=${next.id}`;
      assert.equal(await claimSharedPrint(printer, randomUUID()), null);
      assert.equal(
        (
          await connection`SELECT status FROM label_print_jobs WHERE id=${next.id}`
        )[0].status,
        "expired",
      );
      const systemPrinter = randomUUID();
      await connection`INSERT INTO label_printers(id,organization_id,name,token_hash,kind,max_width_mm,max_height_mm) VALUES(${systemPrinter},${org},'Office',${printHash('system-token')},'system',210,297)`;
      await connection`UPDATE label_printers SET last_seen_at=now() WHERE id=${systemPrinter}`;
      const png = await sharp({create:{width:600,height:300,channels:3,background:'white'}}).png().toBuffer();
      const snapshot = {png:'data:image/png;base64,'+png.toString('base64'),widthMm:60,heightMm:30};
      const pdfInput = {id:randomUUID(),printerId:systemPrinter,format:'pdf',document:{labels:[snapshot],media:DEFAULT_PRINT_MEDIA}};
      const firstPdf = await enqueueSharedPrint(identity,pdfInput);
      assert.equal((await enqueueSharedPrint(identity,pdfInput)).id,firstPdf.id);
      await assert.rejects(()=>enqueueSharedPrint({...identity,organizationId:otherOrg},{...pdfInput,id:randomUUID()}),e=>e.status===404);
      await assert.rejects(()=>enqueueSharedPrint(identity,{...pdfInput,printerId:printer,id:randomUUID()}),e=>e.status===409);
      await assert.rejects(()=>enqueueSharedPrint(identity,{...input,printerId:systemPrinter,id:randomUUID()}),e=>e.status===409);
      const pdfClaim = await claimSharedPrint(systemPrinter,randomUUID());
      assert.equal(pdfClaim.format,'pdf');
      assert.equal(pdfClaim.pageWidthMm,60);
      assert.equal(pdfClaim.pageHeightMm,30);
      const pdfBytes=Buffer.from(pdfClaim.data,'base64');
      assert.ok(pdfBytes.toString('ascii',0,5)==='%PDF-');
      assert.equal(printHash(pdfBytes),pdfClaim.sha256);
      await assert.rejects(()=>enqueueSharedPrint(identity,{...pdfInput,id:randomUUID(),document:{labels:[snapshot],media:{...DEFAULT_PRINT_MEDIA,mode:'sheet',pageWidthMm:220}}}),e=>e.status===409);
      await assert.rejects(()=>enqueueSharedPrint(identity,{...pdfInput,id:randomUUID(),document:{labels:[snapshot,{...snapshot,widthMm:50,heightMm:25}],media:DEFAULT_PRINT_MEDIA}}),e=>e.status===422);
      await connection`CREATE TABLE users(id uuid PRIMARY KEY)`;
      await connection.unsafe(await readFile(new URL("../db/migrations/0071_label_workspaces.sql",import.meta.url),"utf8"));
      const { updateLabelWorkspace, readLabelWorkspace } = await import("../lib/label-workspace.ts");
      const userId=randomUUID();
      await connection`INSERT INTO users(id) VALUES(${userId})`;
      const resource={id:randomUUID(),name:'Frozen',sku:null,barcode:null,location:null,type:'product',quantity:1,cover:null};
      const prepared={id:randomUUID(),name:'Frozen',template:'Generic',tape:24,widthMm:60,data:'',preview:snapshot.png,snapshot,resource,original:resource,
        setup:{id:'generic',name:'Generic',widthMm:60,heightMm:30,elements:[],revision:1,createdAt:'',updatedAt:''}};
      await updateLabelWorkspace(org,userId,{action:'queue',revision:0,labels:[prepared]});
      assert.deepEqual((await readLabelWorkspace(org,userId)).labels[0].snapshot,snapshot);
      assert.deepEqual((await readLabelWorkspace(otherOrg,userId)).labels,[]);
      await assert.rejects(()=>updateLabelWorkspace(org,userId,{action:'queue',revision:1,labels:[{...prepared,snapshot:{...snapshot,png:'data:image/png;base64,aGVsbG8='}}]}),e=>e.status===422);
      assert.equal((await readLabelWorkspace(org,userId)).revision,1);
      // Cancellation is tenant/user scoped and serialized against the last start check.
      const stopInput = { ...input, id: randomUUID() };
      await enqueueSharedPrint(identity, stopInput);
      await assert.rejects(() => cancelSharedPrint({ ...identity, subject: 'someone-else' }, stopInput.id), e => e.status === 409);
      await assert.rejects(() => cancelSharedPrint({ ...identity, organizationId: otherOrg }, stopInput.id), e => e.status === 409);
      const stopClaim = randomUUID();
      await claimSharedPrint(printer, stopClaim, 2);
      assert.equal((await cancelSharedPrint(identity, stopInput.id)).cancelResult, null);
      const stopped = await controlSharedPrint(printer, stopInput.id, stopClaim, 'start');
      assert.deepEqual(stopped, {cancel:true, mayPrint:false, status:'cancelled'});
      assert.equal((await controlSharedPrint(printer, stopInput.id, stopClaim, 'start')).mayPrint, false);
      await assert.rejects(() => controlSharedPrint(systemPrinter, stopInput.id, stopClaim, 'start'), e => e.status === 404);
      const runningInput = { ...input, id: randomUUID() };
      await enqueueSharedPrint(identity, runningInput);
      const runningClaim = randomUUID();
      await claimSharedPrint(printer, runningClaim, 2);
      assert.equal((await controlSharedPrint(printer, runningInput.id, runningClaim, 'start')).mayPrint, true);
      assert.equal((await controlSharedPrint(printer, runningInput.id, runningClaim, 'start')).mayPrint, false);
      const cancellation = await cancelSharedPrint(identity, runningInput.id);
      assert.equal(cancellation.status, 'claimed');
      assert.ok(cancellation.cancelRequestedAt);
      assert.equal((await controlSharedPrint(printer, runningInput.id, runningClaim, 'check')).cancel, true);
      await connection`UPDATE label_print_jobs SET status='submitted',spool_job_id=42 WHERE id=${runningInput.id}`;
      assert.ok((await cancelSharedPrint(identity, runningInput.id)).cancelRequestedAt);
      const waitingInput = { ...input, id: randomUUID() };
      await enqueueSharedPrint(identity, waitingInput);
      assert.equal((await cancelSharedPrint(identity, waitingInput.id)).status, 'cancelled');
      assert.equal((await connection`SELECT payload FROM label_print_jobs WHERE id=${waitingInput.id}`)[0].payload,null);
      const raceInput={...input,id:randomUUID()};
      await enqueueSharedPrint(identity,raceInput);
      const raceClaim=randomUUID();await claimSharedPrint(printer,raceClaim,2);
      const [startRace]=await Promise.all([controlSharedPrint(printer,raceInput.id,raceClaim,'start'),cancelSharedPrint(identity,raceInput.id)]);
      const [raced]=await connection`SELECT * FROM label_print_jobs WHERE id=${raceInput.id}`;
      assert.ok(raced.cancel_requested_at);
      assert.equal(raced.status,startRace.mayPrint?'claimed':'cancelled');
      assert.equal((await controlSharedPrint(printer,raceInput.id,raceClaim,'start')).mayPrint,false);
      if(startRace.mayPrint) await connection`UPDATE label_print_jobs SET status='uncertain',payload=NULL WHERE id=${raceInput.id}`;
      const legacyInput={...input,id:randomUUID()};await enqueueSharedPrint(identity,legacyInput);
      await claimSharedPrint(printer,randomUUID(),1);
      await assert.rejects(()=>cancelSharedPrint(identity,legacyInput.id),e=>e.status===409);
      const authRequest = new Request("https://example.test", {
        headers: { Authorization: "Bearer " + token },
      });
      assert.equal((await agentPrinter(authRequest)).id, printer);
      const agentRequest = body => new Request('https://example.test', {method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
      const {POST: statusRoute} = await import('../app/api/v1/label-print-agent/status/route.ts');
      const telemetry={host:'Test Mac',transport:'bluetooth',device:'PT-P710BT',state:'ready',tape:24,detail:'none',cancellation:'transfer'};
      assert.equal((await statusRoute(agentRequest({telemetry}))).status,200);
      assert.equal((await statusRoute(agentRequest({telemetry:{...telemetry,command:'bad'}}))).status,400);
      const spoolRef = 'a'.repeat(64), spoolCommand = randomUUID();
      const spool = {supported:true,jobs:[{ref:spoolRef,id:42,title:'Other app',owner:'User',state:'pending'}]};
      assert.equal((await statusRoute(agentRequest({spool}))).status,200);
      assert.deepEqual((await connection`SELECT spool_snapshot FROM label_printers WHERE id=${printer}`)[0].spool_snapshot,spool);
      await connection`INSERT INTO label_spool_commands(id,printer_id,refs,created_by) VALUES(${spoolCommand},${printer},${JSON.stringify([spoolRef])}::jsonb,'test-user')`;
      const commands = await (await statusRoute(agentRequest({}))).json();
      assert.deepEqual(commands.spoolCommands,[{id:spoolCommand,refs:[spoolRef]}]);
      assert.equal((await statusRoute(agentRequest({spoolReceipts:[{id:spoolCommand,result:'done'}]}))).status,200);
      assert.equal((await connection`SELECT status FROM label_spool_commands WHERE id=${spoolCommand}`)[0].status,'done');
      assert.deepEqual((await (await statusRoute(agentRequest({}))).json()).spoolCommands,[]);
      assert.equal((await statusRoute(agentRequest({spool:{...spool,jobs:[{...spool.jobs[0],command:'purge'}]}}))).status,400);
      const [observed]=await connection`SELECT agent_status,status_checked_at FROM label_printers WHERE id=${printer}`;
      assert.equal(observed.agent_status.state,'ready');assert.ok(observed.status_checked_at);
      await connection`UPDATE label_printers SET last_seen_at=now()-interval '1 minute' WHERE id=${printer}`;
      await assert.rejects(()=>enqueueSharedPrint(identity,{...input,id:randomUUID()}),e=>e.status===409);
      // An idempotent retry of an accepted job still returns its receipt offline.
      assert.equal((await enqueueSharedPrint(identity,input)).id,input.id);
      const {POST: ackRoute} = await import('../app/api/v1/label-print-agent/ack/route.ts');
      const ackBody={id:runningInput.id,claimId:runningClaim,status:'uncertain',spoolJobId:42,cancelResult:'stopped'};
      assert.equal((await ackRoute(agentRequest(ackBody))).status,200);
      assert.equal((await ackRoute(agentRequest(ackBody))).status,200);
      assert.equal((await connection`SELECT cancel_result FROM label_print_jobs WHERE id=${runningInput.id}`)[0].cancel_result,'stopped');
      // A receipt must never claim a clean cancellation after dispatch began.
      assert.equal((await ackRoute(agentRequest({...ackBody,status:'cancelled',cancelResult:'cancelled'}))).status,409);

      await connection`UPDATE label_printers SET enabled=false WHERE id=${printer}`;
      await assert.rejects(
        () => agentPrinter(authRequest),
        (e) => e.status === 401,
      );
      assert.throws(
        () =>
          checkPrintMutation(
            new Request("https://example.test", {
              headers: { "sec-fetch-site": "cross-site" },
            }),
            identity,
          ),
        (e) => e.status === 403,
      );
      assert.throws(
        () =>
          checkPrintMutation(new Request("https://example.test"), {
            ...identity,
            organization: { isReadOnly: true },
          }),
        (e) => e.status === 403,
      );
    } finally {
      await connection.end();
      delete globalThis.inventorySql;
      await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  },
);
