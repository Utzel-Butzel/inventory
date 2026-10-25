import { readFile } from "node:fs/promises";

type SigningEnvironment = Record<string, string | undefined>;

export function hasQzSigningConfig(env: SigningEnvironment = process.env) {
  return Boolean(
    (env.QZ_CERTIFICATE_PATH || env.QZ_CERTIFICATE_BASE64) &&
    (env.QZ_PRIVATE_KEY_PATH || env.QZ_PRIVATE_KEY_BASE64),
  );
}

/** Server-only secrets; file mounts take precedence over deployment secrets. */
export async function readQzSigningMaterial(
  kind: "CERTIFICATE" | "PRIVATE_KEY",
  env: SigningEnvironment = process.env,
) {
  const path = env[`QZ_${kind}_PATH`];
  if (path) return readFile(path, "utf8");
  const encoded = env[`QZ_${kind}_BASE64`]?.trim();
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error("QZ signing material is not configured correctly.");
  }
  const pem = Buffer.from(encoded, "base64").toString("utf8");
  const marker = kind === "CERTIFICATE" ? "CERTIFICATE" : "PRIVATE KEY";
  if (!pem.includes(`-----BEGIN ${marker}-----`) || !pem.includes(`-----END ${marker}-----`)) {
    throw new Error("QZ signing material is not PEM encoded.");
  }
  return pem;
}
