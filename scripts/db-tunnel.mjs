import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import path from "node:path";

for (const envFile of [".env.tunnel.local", ".env.local", ".env"]) {
  if (!existsSync(envFile)) continue;
  process.loadEnvFile(envFile);
}

const value = (name) => process.env[name]?.trim() ?? "";

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

const parsePort = (name, fallback) => {
  const raw = value(name) || String(fallback);
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    fail(`${name} must be an integer between 1 and 65535.`);
  }
  return port;
};

const validateSshName = (name, raw) => {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(raw)) {
    fail(`${name} contains unsupported characters.`);
  }
  return raw;
};

const sshHost = value("DB_TUNNEL_SSH_HOST");
if (!sshHost) {
  fail(
    "DB_TUNNEL_SSH_HOST is required. Add the production server hostname or an SSH config alias to .env.local.",
  );
}
validateSshName("DB_TUNNEL_SSH_HOST", sshHost);

const sshUser = value("DB_TUNNEL_SSH_USER");
if (sshUser && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(sshUser)) {
  fail("DB_TUNNEL_SSH_USER contains unsupported characters.");
}

const sshPort = parsePort("DB_TUNNEL_SSH_PORT", 22);
const localPort = parsePort("DB_TUNNEL_LOCAL_PORT", 15_432);
const remotePort = parsePort("DB_TUNNEL_REMOTE_PORT", 5_432);
const localHost = value("DB_TUNNEL_LOCAL_HOST") || "127.0.0.1";
if (!["127.0.0.1", "localhost", "::1"].includes(localHost)) {
  fail("DB_TUNNEL_LOCAL_HOST must be a loopback address (127.0.0.1, localhost, or ::1).");
}

const configuredRemoteHost = value("DB_TUNNEL_REMOTE_HOST");
const dockerContainer = value("DB_TUNNEL_DOCKER_CONTAINER");
const dockerService = value("DB_TUNNEL_DOCKER_SERVICE");
const configuredTargets = [configuredRemoteHost, dockerContainer, dockerService].filter(Boolean);
if (configuredTargets.length === 0) {
  fail(
    "Set DB_TUNNEL_REMOTE_HOST, DB_TUNNEL_DOCKER_CONTAINER, or DB_TUNNEL_DOCKER_SERVICE for the database target.",
  );
}
if (configuredTargets.length > 1) {
  fail("Configure only one remote database target for the tunnel.");
}
if (configuredRemoteHost) {
  validateSshName("DB_TUNNEL_REMOTE_HOST", configuredRemoteHost);
}
if (dockerContainer && !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(dockerContainer)) {
  fail("DB_TUNNEL_DOCKER_CONTAINER contains unsupported characters.");
}
if (dockerService && !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(dockerService)) {
  fail("DB_TUNNEL_DOCKER_SERVICE contains unsupported characters.");
}

const identityFile = value("DB_TUNNEL_IDENTITY_FILE");
const jumpHost = value("DB_TUNNEL_SSH_JUMP");
if (jumpHost) validateSshName("DB_TUNNEL_SSH_JUMP", jumpHost);

const sshTarget = sshUser ? `${sshUser}@${sshHost}` : sshHost;
const sshArguments = [];
if (sshPort !== 22) sshArguments.push("-p", String(sshPort));
if (identityFile) {
  const expandedIdentityFile = identityFile.startsWith("~/")
    ? path.join(homedir(), identityFile.slice(2))
    : identityFile;
  sshArguments.push("-i", expandedIdentityFile);
}
if (jumpHost) sshArguments.push("-J", jumpHost);
sshArguments.push(
  "-o",
  "ConnectTimeout=15",
  "-o",
  "ExitOnForwardFailure=yes",
  "-o",
  "ServerAliveInterval=30",
  "-o",
  "ServerAliveCountMax=3",
);
const needsDockerLookup = Boolean(dockerContainer || dockerService);
const controlPath = needsDockerLookup
  ? path.join(homedir(), ".ssh", `inventory-tunnel-${process.pid}-%C`)
  : "";
if (needsDockerLookup) {
  sshArguments.push(
    "-o",
    "ControlMaster=auto",
    "-o",
    "ControlPersist=yes",
    "-o",
    `ControlPath=${controlPath}`,
  );
}

const runAndCapture = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["inherit", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      const detail = stderr.trim() || `terminated by ${signal ?? `exit code ${code}`}`;
      reject(new Error(detail));
    });
  });

const closeControlMaster = () => {
  if (!controlPath) return;
  spawn(
    "ssh",
    ["-S", controlPath, "-O", "exit", sshTarget],
    { stdio: "ignore" },
  ).unref();
};

let resolvedDockerContainer = "";
if (dockerService) {
  process.stdout.write(
    `Resolving database service ${dockerService} through ${sshTarget}...\n`,
  );
  const remoteCommand = [
    `container_id=$(docker ps --filter label=com.docker.swarm.service.name=${dockerService} --format '{{.ID}}' | head -n 1)`,
    `if [ -z "$container_id" ]; then container_id=$(docker ps --filter name=^${dockerService} --format '{{.ID}}' | head -n 1); fi`,
    'test -n "$container_id"',
    `printf '%s\\n' "$container_id"`,
  ].join("; ");

  let output;
  try {
    output = await runAndCapture("ssh", [
      ...sshArguments,
      "-T",
      sshTarget,
      remoteCommand,
    ]);
  } catch (error) {
    closeControlMaster();
    fail(`Could not inspect the remote database service: ${error.message}`);
  }

  resolvedDockerContainer = output.trim().split(/\s+/)[0] ?? "";
  if (!/^[a-f0-9]{12,64}$/.test(resolvedDockerContainer)) {
    closeControlMaster();
    fail(`Docker returned no running container ID for ${dockerService}.`);
  }
} else if (dockerContainer) {
  process.stdout.write(
    `Resolving database container ${dockerContainer} through ${sshTarget}...\n`,
  );
  let output;
  try {
    output = await runAndCapture("ssh", [
      ...sshArguments,
      "-T",
      sshTarget,
      "docker",
      "inspect",
      "--format",
      "'{{.Id}}'",
      dockerContainer,
    ]);
  } catch (error) {
    closeControlMaster();
    fail(`Could not inspect the remote database container: ${error.message}`);
  }

  resolvedDockerContainer = output.trim().split(/\s+/)[0] ?? "";
  if (!/^[a-f0-9]{12,64}$/.test(resolvedDockerContainer)) {
    closeControlMaster();
    fail(`Docker returned no container ID for ${dockerContainer}.`);
  }
}

const formatHost = (host) => (host.includes(":") ? `[${host}]` : host);
const databaseUser = value("DB_TUNNEL_DATABASE_USER") || "inventory";
const databaseName = value("DB_TUNNEL_DATABASE_NAME") || "inventory";
const localDatabaseHost = localHost === "::1" ? "[::1]" : localHost;
const targetDescription = resolvedDockerContainer
  ? `Docker container ${resolvedDockerContainer.slice(0, 12)}:${remotePort}`
  : `${configuredRemoteHost}:${remotePort}`;

process.stdout.write(
  [
    `Opening ${localHost}:${localPort} -> ${targetDescription} through ${sshTarget}`,
    "Keep this terminal open; press Ctrl-C to stop the tunnel.",
    "Use this in another terminal (replace <password>):",
    `DATABASE_URL='postgresql://${databaseUser}:<password>@${localDatabaseHost}:${localPort}/${databaseName}' npm run dev`,
    "",
  ].join("\n"),
);

if (!resolvedDockerContainer) {
  const forwarding = `${formatHost(localHost)}:${localPort}:${formatHost(configuredRemoteHost)}:${remotePort}`;
  const tunnel = spawn(
    "ssh",
    [
      ...sshArguments,
      "-N",
      "-T",
      "-L",
      forwarding,
      sshTarget,
    ],
    { stdio: "inherit" },
  );

  tunnel.once("error", (error) => {
    fail(`Could not start ssh: ${error.message}`);
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => tunnel.kill(signal));
  }

  const exitCode = await new Promise((resolve) => {
    tunnel.once("exit", (code, signal) => {
      if (code !== null) resolve(code);
      else resolve(signal === "SIGINT" ? 130 : 1);
    });
  });
  process.exitCode = exitCode;
} else {
  // The SSH host may not have a route to a Swarm overlay address. Relay each
  // local connection through the container's own network namespace instead.
  const relayCommand = [
    `docker exec -i ${resolvedDockerContainer} bash -c`,
    `'exec 3<>/dev/tcp/127.0.0.1/${remotePort}; cat <&3 & reader=$!; cat >&3; kill "$reader" 2>/dev/null; wait "$reader" 2>/dev/null'`,
  ].join(" ");
  const relays = new Set();

  const server = createServer((socket) => {
    const relay = spawn(
      "ssh",
      [...sshArguments, "-T", sshTarget, relayCommand],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    relays.add(relay);

    let stderr = "";
    relay.stderr.setEncoding("utf8");
    relay.stderr.on("data", (chunk) => {
      if (stderr.length < 8_192) stderr += chunk;
    });
    relay.stdin.on("error", () => socket.destroy());
    relay.once("error", (error) => {
      process.stderr.write(`Database relay failed: ${error.message}\n`);
      socket.destroy();
    });
    relay.once("exit", (code) => {
      relays.delete(relay);
      if (code && !socket.destroyed) {
        const detail = stderr.trim();
        process.stderr.write(
          `Database relay exited with code ${code}${detail ? `: ${detail}` : "."}\n`,
        );
      }
      socket.end();
    });
    socket.once("error", () => relay.kill("SIGTERM"));
    socket.once("close", () => relay.kill("SIGTERM"));
    socket.pipe(relay.stdin);
    relay.stdout.pipe(socket);
  });

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(localPort, localHost, resolve);
    });
  } catch (error) {
    closeControlMaster();
    fail(`Could not listen on ${localHost}:${localPort}: ${error.message}`);
  }

  const exitCode = await new Promise((resolve) => {
    process.once("SIGINT", () => resolve(130));
    process.once("SIGTERM", () => resolve(143));
  });
  server.close();
  for (const relay of relays) relay.kill("SIGTERM");
  closeControlMaster();
  process.exitCode = exitCode;
}
