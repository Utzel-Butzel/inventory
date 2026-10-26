import test from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
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
