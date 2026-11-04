import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// A new upload key is only appropriate before the first Play upload. Never
// replace an existing key; keep an encrypted backup outside this computer.
const directory = join(homedir(), ".config", "openinventory", "release");
const keystore = join(directory, "upload.p12");
const properties = fileURLToPath(new URL("../android/keystore.properties", import.meta.url));
if (existsSync(keystore) || existsSync(properties)) {
  throw new Error("Signing material already exists. Reuse/back up the existing key; no files were replaced.");
}
const javaHome = process.env.JAVA_HOME || (process.platform === "darwin" ? "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home" : "");
const keytool = javaHome ? join(javaHome, "bin", process.platform === "win32" ? "keytool.exe" : "keytool") : "keytool";
const password = randomBytes(32).toString("hex");
mkdirSync(directory, { recursive: true, mode: 0o700 });
chmodSync(directory, 0o700);
// Save the recovery password before key generation, without printing it.
writeFileSync(join(directory, "upload-password.txt"), password + "\n", { flag: "wx", mode: 0o600 });
const result = spawnSync(keytool, ["-genkeypair", "-keystore", keystore, "-storetype", "PKCS12", "-alias", "upload", "-keyalg", "RSA", "-keysize", "4096", "-validity", "10000", "-dname", "CN=Open Inventory Upload, OU=Mobile, O=Polyxo, C=DE", "-storepass:env", "OPENINVENTORY_UPLOAD_PASSWORD", "-keypass:env", "OPENINVENTORY_UPLOAD_PASSWORD"], { env: { ...process.env, OPENINVENTORY_UPLOAD_PASSWORD: password }, stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
chmodSync(keystore, 0o600);
const escapedPath = keystore.replaceAll("\\", "\\\\").replaceAll(":", "\\:");
writeFileSync(properties, `storeFile=${escapedPath}\nstorePassword=${password}\nkeyAlias=upload\nkeyPassword=${password}\n`, { flag: "wx", mode: 0o600 });
console.log(`Upload key created: ${keystore}\nLocal Gradle configuration: ${properties}\nBack up ${directory} in your encrypted password/secret store before publishing.`);
