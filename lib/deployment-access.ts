const enabledValues = new Set(["1", "true", "yes", "on"]);

function normalizedEmailList(value: string | undefined) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isSuperAdminEmail(email: string | null | undefined) {
  const normalizedEmail = email?.trim().toLowerCase();
  return Boolean(
    normalizedEmail &&
      normalizedEmailList(process.env.SUPERADMIN_EMAILS).has(normalizedEmail),
  );
}

export function usersCanCreateOrganizations() {
  return enabledValues.has(
    (process.env.USERS_CAN_CREATE_ORGANIZATIONS ?? "").trim().toLowerCase(),
  );
}
