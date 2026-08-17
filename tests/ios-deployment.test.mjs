import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const readRepositoryFile = (filename) =>
  readFile(path.join(repositoryRoot, filename), "utf8");

test("npm exposes one-command iOS build and TestFlight deployment", async () => {
  const packageJson = JSON.parse(await readRepositoryFile("package.json"));

  assert.equal(packageJson.scripts["fastlane:install"], "bundle install");
  assert.equal(
    packageJson.scripts["predeploy:ios"],
    "bundle check || bundle install",
  );
  assert.equal(
    packageJson.scripts["deploy:ios"],
    "bundle exec fastlane ios deploy",
  );
  assert.equal(packageJson.scripts.deploy, "npm run deploy:ios");
  assert.equal(packageJson.scripts["ios:build"], "bundle exec fastlane ios build");
});

test("Fastlane builds a local App Store IPA before uploading only to TestFlight", async () => {
  const fastfile = await readRepositoryFile("fastlane/Fastfile");

  assert.match(fastfile, /platform :ios do/);
  assert.match(fastfile, /lane :deploy do/);
  assert.match(fastfile, /app_store_connect_api_key\(/);
  assert.match(fastfile, /latest_testflight_build_number\(/);
  assert.match(fastfile, /CURRENT_PROJECT_VERSION=#\{build_number\}/);
  assert.match(fastfile, /"-allowProvisioningUpdates"/);
  assert.match(fastfile, /"-authenticationKeyPath"/);
  assert.match(fastfile, /method: "app-store"/);
  assert.match(fastfile, /destination: "export"/);
  assert.match(fastfile, /upload_to_testflight\(/);
  assert.match(fastfile, /changelog = nil if changelog\.empty\?/);
  assert.doesNotMatch(fastfile, /upload_to_app_store/);
  assert.doesNotMatch(fastfile, /increment_build_number/);
});

test("the shared Inventory scheme is archiveable and includes unit tests", async () => {
  const scheme = await readRepositoryFile(
    "ios/Inventory/Inventory.xcodeproj/xcshareddata/xcschemes/Inventory.xcscheme",
  );

  assert.match(scheme, /LastUpgradeVersion = "2660"/);
  assert.match(scheme, /BlueprintIdentifier = "A10000000000000000000002"/);
  assert.match(scheme, /BlueprintIdentifier = "A10000000000000000000003"/);
  assert.match(scheme, /<ArchiveAction\s+buildConfiguration = "Release"/);
});

test("mobile credentials and generated Fastlane state stay out of Git", async () => {
  const [gitignore, environmentExample] = await Promise.all([
    readRepositoryFile(".gitignore"),
    readRepositoryFile("fastlane/.env.example"),
  ]);

  for (const pattern of ["*.p8", "*.p12", "*.mobileprovision"]) {
    assert.ok(gitignore.split("\n").includes(pattern), `${pattern} is not ignored`);
  }
  assert.match(gitignore, /\/build\/ios\//);
  assert.match(gitignore, /\/fastlane\/report\.xml/);
  assert.match(environmentExample, /APP_STORE_CONNECT_API_KEY_KEY_ID=/);
  assert.match(environmentExample, /APP_STORE_CONNECT_API_KEY_ISSUER_ID=/);
  assert.doesNotMatch(environmentExample, /BEGIN (?:EC )?PRIVATE KEY/);
});
