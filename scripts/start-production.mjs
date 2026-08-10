import { access, constants, mkdir } from "node:fs/promises";
import path from "node:path";

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

if (value("SIMPLE_AUTH_PASSWORD") || value("BOOTSTRAP_ADMIN_PASSWORD")) {
  errors.push("Plaintext login passwords are disabled in the production image; use a bcrypt hash.");
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

console.log("Applying database migrations...");
await import("./migrate.mjs");
console.log("Database migrations are current. Starting Inventory...");
await import("../server.js");
