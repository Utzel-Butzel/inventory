import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const actions = {
  build: [":app:assembleDebug"],
  check: [":app:testDebugUnitTest", ":app:lintDebug", ":app:assembleDebug"],
  test: [":app:connectedDebugAndroidTest"],
  install: [":app:installDebug"],
  bundle: [":app:bundleRelease"],
};
const action = process.argv[2] ?? "check";
if (!actions[action]) throw new Error(`Unknown Android action: ${action}`);
const env = { ...process.env };
if (!env.ANDROID_HOME && !env.ANDROID_SDK_ROOT && process.platform === "darwin") {
  const sdk = `${homedir()}/Library/Android/sdk`;
  if (existsSync(sdk)) env.ANDROID_HOME = sdk;
}
if (!env.JAVA_HOME && process.platform === "darwin") {
  const candidates = [
    "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home",
    "/Applications/Android Studio.app/Contents/jbr/Contents/Home",
  ];
  env.JAVA_HOME = candidates.find((path) => existsSync(path));
  if (!env.JAVA_HOME) delete env.JAVA_HOME;
}
const cwd = fileURLToPath(new URL("../android/", import.meta.url));
const child = spawn(process.platform === "win32" ? "gradlew.bat" : "./gradlew", [...actions[action], "--console=plain"], { cwd, env, stdio: "inherit", shell: process.platform === "win32" });
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
