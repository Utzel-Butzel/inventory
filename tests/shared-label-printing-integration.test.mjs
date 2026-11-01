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
      const {
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
      const authRequest = new Request("https://example.test", {
        headers: { Authorization: "Bearer " + token },
      });
      assert.equal((await agentPrinter(authRequest)).id, printer);
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
