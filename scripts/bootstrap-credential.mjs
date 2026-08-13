import { hash } from "bcryptjs";

const value = (environment, name) => environment[name]?.trim() ?? "";

export function validateBootstrapCredential(environment = process.env) {
  const errors = [];
  const password = value(environment, "BOOTSTRAP_ADMIN_PASSWORD");
  const oneTimeMode =
    value(environment, "BOOTSTRAP_ADMIN_PASSWORD_ONCE").toLowerCase() === "true";

  if (value(environment, "SIMPLE_AUTH_PASSWORD")) {
    errors.push(
      "SIMPLE_AUTH_PASSWORD is disabled in the production image; use a bcrypt hash.",
    );
  }
  if (password && !oneTimeMode) {
    errors.push(
      "BOOTSTRAP_ADMIN_PASSWORD requires BOOTSTRAP_ADMIN_PASSWORD_ONCE=true, or use a bcrypt hash.",
    );
  }
  if (password && password.length < 12) {
    errors.push("BOOTSTRAP_ADMIN_PASSWORD must contain at least 12 characters.");
  }
  if (password && value(environment, "BOOTSTRAP_ADMIN_PASSWORD_HASH")) {
    errors.push(
      "Set either BOOTSTRAP_ADMIN_PASSWORD or BOOTSTRAP_ADMIN_PASSWORD_HASH, not both.",
    );
  }

  return { errors, password };
}

export async function prepareBootstrapCredential(
  environment = process.env,
  password,
) {
  if (!password) return false;
  environment.BOOTSTRAP_ADMIN_PASSWORD_HASH = await hash(password, 12);
  delete environment.BOOTSTRAP_ADMIN_PASSWORD;
  delete environment.BOOTSTRAP_ADMIN_PASSWORD_ONCE;
  return true;
}
