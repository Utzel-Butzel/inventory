import assert from "node:assert/strict";
import test from "node:test";

import { compare } from "bcryptjs";

import {
  prepareBootstrapCredential,
  validateBootstrapCredential,
} from "../scripts/bootstrap-credential.mjs";

test("production bootstrap accepts only explicit one-time credentials", () => {
  assert.deepEqual(validateBootstrapCredential({}), { errors: [], password: "" });

  assert.match(
    validateBootstrapCredential({ SIMPLE_AUTH_PASSWORD: "cleartext-password" })
      .errors.join(" "),
    /SIMPLE_AUTH_PASSWORD is disabled/,
  );
  assert.match(
    validateBootstrapCredential({
      BOOTSTRAP_ADMIN_PASSWORD: "long-enough-password",
    }).errors.join(" "),
    /PASSWORD_ONCE=true/,
  );
  assert.match(
    validateBootstrapCredential({
      BOOTSTRAP_ADMIN_PASSWORD: "short",
      BOOTSTRAP_ADMIN_PASSWORD_ONCE: "true",
    }).errors.join(" "),
    /at least 12 characters/,
  );
  assert.match(
    validateBootstrapCredential({
      BOOTSTRAP_ADMIN_PASSWORD: "long-enough-password",
      BOOTSTRAP_ADMIN_PASSWORD_ONCE: "true",
      BOOTSTRAP_ADMIN_PASSWORD_HASH:
        "$2b$12$b72wh6gSHWSo86C55dE9ru8PkOxR5dELMTwsOEQ8XApwiuWCejrna",
    }).errors.join(" "),
    /either BOOTSTRAP_ADMIN_PASSWORD or BOOTSTRAP_ADMIN_PASSWORD_HASH/,
  );
});

test("one-time bootstrap is hashed before application code receives it", async () => {
  const password = "unique-initial-password";
  const environment = {
    BOOTSTRAP_ADMIN_PASSWORD: password,
    BOOTSTRAP_ADMIN_PASSWORD_ONCE: "true",
  };
  const validation = validateBootstrapCredential(environment);
  assert.deepEqual(validation.errors, []);

  assert.equal(
    await prepareBootstrapCredential(environment, validation.password),
    true,
  );
  assert.equal(environment.BOOTSTRAP_ADMIN_PASSWORD, undefined);
  assert.equal(environment.BOOTSTRAP_ADMIN_PASSWORD_ONCE, undefined);
  assert.equal(await compare(password, environment.BOOTSTRAP_ADMIN_PASSWORD_HASH), true);
  assert.notEqual(environment.BOOTSTRAP_ADMIN_PASSWORD_HASH, password);
});
