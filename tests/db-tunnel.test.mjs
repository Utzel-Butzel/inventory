import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const availablePort = async () => {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
};

test("Docker tunnel relays bytes through docker exec instead of an overlay IP", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "inventory-db-tunnel-"));
  const fakeSsh = path.join(directory, "ssh");
  await writeFile(
    fakeSsh,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("-O")) process.exit(0);
const command = args.at(-1) ?? "";
if (command.includes("container_id=$(docker ps")) {
  process.stdout.write("abcdef123456\\n");
  process.exit(0);
}
if (command.includes("docker exec -i abcdef123456")) {
  process.stdin.pipe(process.stdout);
  return;
}
process.stderr.write("Unexpected ssh invocation: " + args.join(" ") + "\\n");
process.exit(2);
`,
  );
  await chmod(fakeSsh, 0o755);

  const port = await availablePort();
  const tunnel = spawn(
    process.execPath,
    [path.join(repositoryRoot, "scripts", "db-tunnel.mjs")],
    {
      cwd: directory,
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        DB_TUNNEL_SSH_HOST: "database.example.test",
        DB_TUNNEL_SSH_USER: "deploy",
        DB_TUNNEL_LOCAL_HOST: "127.0.0.1",
        DB_TUNNEL_LOCAL_PORT: String(port),
        DB_TUNNEL_DOCKER_SERVICE: "inventory-postgres",
        DB_TUNNEL_REMOTE_PORT: "5432",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stdout = "";
  let stderr = "";
  tunnel.stdout.setEncoding("utf8");
  tunnel.stderr.setEncoding("utf8");
  tunnel.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  tunnel.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`Tunnel did not start. stderr: ${stderr}`)),
        5_000,
      );
      const check = () => {
        if (stdout.includes("Keep this terminal open")) {
          clearTimeout(timeout);
          resolve();
          return;
        }
        setTimeout(check, 10);
      };
      check();
    });

    const echoed = await new Promise((resolve, reject) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.setEncoding("utf8");
      socket.once("error", reject);
      socket.once("connect", () => socket.write("postgres-protocol-bytes"));
      socket.once("data", (chunk) => {
        socket.destroy();
        resolve(chunk);
      });
    });
    assert.equal(echoed, "postgres-protocol-bytes");
    assert.match(stdout, /Docker container abcdef123456:5432/);
    assert.match(stdout, /npm run dev/);
    assert.doesNotMatch(stdout, /10\.0\./);
  } finally {
    tunnel.kill("SIGINT");
    await new Promise((resolve) => tunnel.once("exit", resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
