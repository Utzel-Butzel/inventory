import { createHash, sign } from "node:crypto";

/** QZ verifies an RSA signature over the lowercase SHA-256 hex of the JSON. */
export function signQzRequest(request: string, privateKey: string): string {
  const digest = createHash("sha256").update(request).digest("hex");
  return sign("RSA-SHA512", Buffer.from(digest), privateKey).toString("base64");
}
