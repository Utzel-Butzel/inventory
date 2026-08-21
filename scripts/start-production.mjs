import { access, constants, mkdir } from "node:fs/promises";
import path from "node:path";

import {
  prepareBootstrapCredential,
  validateBootstrapCredential,
} from "./bootstrap-credential.mjs";

const value = (name) => process.env[name]?.trim() ?? "";
const errors = [];

const databaseUrl = value("DATABASE_URL");
if (!databaseUrl) {
  errors.push("DATABASE_URL is required.");
} else {
  try {
    const parsed = new URL(databaseUrl);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
      errors.push("DATABASE_URL must use the postgres or postgresql protocol.");
    }
  } catch {
    errors.push("DATABASE_URL must be a valid PostgreSQL URL.");
  }
}

const authSecret = value("AUTH_SECRET");
const knownUnsafeSecrets = [
  "local-development-secret-change-before-deploying",
  "replace-with-at-least-32-random-characters",
];
if (authSecret.length < 32 || knownUnsafeSecrets.includes(authSecret)) {
  errors.push("AUTH_SECRET must be a non-placeholder secret of at least 32 characters.");
}

const countJobSecret = value("REPLICATE_COUNT_JOB_SECRET");
if (countJobSecret && countJobSecret.length < 32) {
  errors.push("REPLICATE_COUNT_JOB_SECRET must contain at least 32 characters when set.");
}

const authUrl = value("AUTH_URL");
if (!authUrl) {
  errors.push("AUTH_URL is required.");
} else {
  try {
    const parsed = new URL(authUrl);
    const localHost = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !localHost) {
      errors.push("AUTH_URL must use HTTPS unless it points to localhost.");
    }
  } catch {
    errors.push("AUTH_URL must be a valid absolute URL.");
  }
}

const bootstrapCredential = validateBootstrapCredential();
errors.push(...bootstrapCredential.errors);

const demoAccessEnabled = value("DEMO_ACCESS_ENABLED").toLowerCase();
if (demoAccessEnabled && !["true", "false"].includes(demoAccessEnabled)) {
  errors.push("DEMO_ACCESS_ENABLED must be either true or false when set.");
}

const passwordAuthEnabled = value("AUTH_PASSWORD_ENABLED").toLowerCase();
if (passwordAuthEnabled && !["true", "false"].includes(passwordAuthEnabled)) {
  errors.push("AUTH_PASSWORD_ENABLED must be either true or false when set.");
}

for (const variableName of [
  "SIMPLE_AUTH_PASSWORD_HASH",
  "BOOTSTRAP_ADMIN_PASSWORD_HASH",
]) {
  const passwordHash = value(variableName);
  if (passwordHash && !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(passwordHash)) {
    errors.push(`${variableName} must contain a valid bcrypt password hash.`);
  }
}

const auth0ClientId = value("AUTH0_CLIENT_ID");
const auth0ClientSecret = value("AUTH0_CLIENT_SECRET");
const auth0Issuer = value("AUTH0_ISSUER_BASE_URL") || value("AUTH0_DOMAIN");
const hasAnyAuth0Setting = Boolean(
  auth0ClientId || auth0ClientSecret || value("AUTH0_ISSUER_BASE_URL") || value("AUTH0_DOMAIN"),
);
if (hasAnyAuth0Setting && !(auth0ClientId && auth0ClientSecret && auth0Issuer)) {
  errors.push("Auth0 configuration is incomplete; set client ID, client secret, and domain or issuer.");
}

const oidcIssuer = value("AUTH_OIDC_ISSUER");
const oidcClientId = value("AUTH_OIDC_CLIENT_ID");
const oidcClientSecret = value("AUTH_OIDC_CLIENT_SECRET");
const oidcProviderId = value("AUTH_OIDC_PROVIDER_ID") || "oidc";
const oidcProviderName = value("AUTH_OIDC_PROVIDER_NAME");
const oidcScopes = value("AUTH_OIDC_SCOPES") || "openid email profile";
const hasAnyOidcSetting = Boolean(
  oidcIssuer || oidcClientId || oidcClientSecret,
);
const oidcConfigured = Boolean(
  oidcIssuer && oidcClientId && oidcClientSecret,
);
if (hasAnyOidcSetting && !oidcConfigured) {
  errors.push(
    "OIDC configuration is incomplete; set AUTH_OIDC_ISSUER, AUTH_OIDC_CLIENT_ID, and AUTH_OIDC_CLIENT_SECRET.",
  );
}
if (hasAnyOidcSetting && !/^[a-z][a-z0-9-]{0,31}$/.test(oidcProviderId)) {
  errors.push(
    "AUTH_OIDC_PROVIDER_ID must start with a lowercase letter and contain at most 32 lowercase letters, numbers, or hyphens.",
  );
}
if (
  hasAnyOidcSetting &&
  ["auth0", "credentials", "demo", "local"].includes(oidcProviderId)
) {
  errors.push(
    "AUTH_OIDC_PROVIDER_ID is reserved; choose an ID other than auth0, credentials, demo, or local.",
  );
}
if (oidcProviderName.length > 64) {
  errors.push("AUTH_OIDC_PROVIDER_NAME must contain at most 64 characters.");
}
const oidcScopeList = oidcScopes.split(/\s+/).filter(Boolean);
if (
  hasAnyOidcSetting &&
  (!oidcScopeList.includes("openid") || !oidcScopeList.includes("email"))
) {
  errors.push("AUTH_OIDC_SCOPES must include both openid and email.");
}
if (oidcIssuer) {
  try {
    const parsed = new URL(oidcIssuer);
    const localHost = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !localHost) {
      errors.push("AUTH_OIDC_ISSUER must use HTTPS unless it points to localhost.");
    }
    if (parsed.search || parsed.hash) {
      errors.push("AUTH_OIDC_ISSUER must not include a query string or fragment.");
    }
  } catch {
    errors.push("AUTH_OIDC_ISSUER must be a valid absolute URL.");
  }
}
if (
  passwordAuthEnabled === "false" &&
  demoAccessEnabled !== "true" &&
  !hasAnyAuth0Setting &&
  !oidcConfigured
) {
  errors.push(
    "At least one authentication provider must be enabled. Enable password login, Auth0, OIDC, or demo access.",
  );
}

const storageProvider = value("STORAGE_PROVIDER").toLowerCase() || "local";
if (storageProvider === "local") {
  const uploadDirectory = path.resolve(
    value("STORAGE_LOCAL_PATH") || path.join(process.cwd(), "data/uploads"),
  );
  try {
    await mkdir(uploadDirectory, { recursive: true });
    await access(uploadDirectory, constants.R_OK | constants.W_OK);
  } catch {
    errors.push(`Local upload storage is not readable and writable: ${uploadDirectory}`);
  }
} else if (storageProvider === "openinary") {
  if (!value("OPENINARY_BASE_URL") || !value("OPENINARY_API_KEY")) {
    errors.push("Openinary storage requires OPENINARY_BASE_URL and OPENINARY_API_KEY.");
  }
} else {
  errors.push("STORAGE_PROVIDER must be either local or openinary.");
}

if (errors.length > 0) {
  console.error("Inventory production configuration is invalid:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

if (await prepareBootstrapCredential(process.env, bootstrapCredential.password)) {
  // The cleartext value is accepted only for one-click bootstrap. Convert it
  // before application modules load, then remove it from the process environment.
  console.log("Prepared the one-time administrator credential as a bcrypt hash.");
}

console.log("Applying database migrations...");
await import("./migrate.mjs");
if (demoAccessEnabled === "true") {
  console.log("Reconciling the read-only product demo...");
  await import("./seed-demo.mjs");
}
console.log("Database migrations are current. Starting Inventory...");
await import("../server.js");
