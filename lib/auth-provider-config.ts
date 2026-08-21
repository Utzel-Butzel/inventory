export type AuthEnvironment = Record<string, string | undefined>;

export type ExternalAuthProviderOption = {
  id: string;
  name: string;
};

type ExternalAuthProviderConfig = ExternalAuthProviderOption & {
  clientId: string;
  clientSecret: string;
  issuer: string;
  scopes?: string;
  type: "auth0" | "oidc";
};

export type AuthProviderConfiguration = {
  passwordEnabled: boolean;
  auth0: ExternalAuthProviderConfig | null;
  oidc: ExternalAuthProviderConfig | null;
  externalProviders: ExternalAuthProviderOption[];
};

const providerIdPattern = /^[a-z][a-z0-9-]{0,31}$/;
const reservedProviderIds = new Set([
  "auth0",
  "credentials",
  "demo",
  "local",
]);

function value(environment: AuthEnvironment, name: string) {
  return environment[name]?.trim() ?? "";
}

function normalizeIssuer(issuer: string) {
  return issuer.replace(/\/+$/, "");
}

function auth0Issuer(environment: AuthEnvironment) {
  const explicitIssuer = value(environment, "AUTH0_ISSUER_BASE_URL");
  if (explicitIssuer) return normalizeIssuer(explicitIssuer);

  const domain = value(environment, "AUTH0_DOMAIN").replace(
    /^https?:\/\//,
    "",
  );
  return domain ? `https://${normalizeIssuer(domain)}` : "";
}

function booleanValue(
  environment: AuthEnvironment,
  name: string,
  fallback: boolean,
) {
  const configured = value(environment, name).toLowerCase();
  if (!configured) return fallback;
  if (!["true", "false"].includes(configured)) return fallback;
  return configured === "true";
}

function hasCompleteValues(...values: string[]) {
  return values.every(Boolean);
}

export function getAuthProviderConfiguration(
  environment: AuthEnvironment = process.env,
): AuthProviderConfiguration {
  const passwordEnabled = booleanValue(
    environment,
    "AUTH_PASSWORD_ENABLED",
    true,
  );

  const configuredAuth0Issuer = auth0Issuer(environment);
  const auth0ClientId = value(environment, "AUTH0_CLIENT_ID");
  const auth0ClientSecret = value(environment, "AUTH0_CLIENT_SECRET");
  const auth0 = hasCompleteValues(
    configuredAuth0Issuer,
    auth0ClientId,
    auth0ClientSecret,
  )
    ? {
        id: "auth0",
        name: "Auth0",
        type: "auth0" as const,
        issuer: configuredAuth0Issuer,
        clientId: auth0ClientId,
        clientSecret: auth0ClientSecret,
      }
    : null;

  const oidcIssuer = normalizeIssuer(value(environment, "AUTH_OIDC_ISSUER"));
  const oidcClientId = value(environment, "AUTH_OIDC_CLIENT_ID");
  const oidcClientSecret = value(environment, "AUTH_OIDC_CLIENT_SECRET");
  const oidcId = value(environment, "AUTH_OIDC_PROVIDER_ID") || "oidc";
  const oidcName =
    value(environment, "AUTH_OIDC_PROVIDER_NAME") || "OpenID Connect";
  const oidcScopes =
    value(environment, "AUTH_OIDC_SCOPES") || "openid email profile";
  const oidcConfigurationIsValid =
    providerIdPattern.test(oidcId) &&
    !reservedProviderIds.has(oidcId) &&
    oidcName.length <= 64;
  const oidc =
    oidcConfigurationIsValid &&
    hasCompleteValues(oidcIssuer, oidcClientId, oidcClientSecret)
      ? {
          id: oidcId,
          name: oidcName,
          type: "oidc" as const,
          issuer: oidcIssuer,
          clientId: oidcClientId,
          clientSecret: oidcClientSecret,
          scopes: oidcScopes,
        }
      : null;

  return {
    passwordEnabled,
    auth0,
    oidc,
    externalProviders: [auth0, oidc].flatMap((provider) =>
      provider ? [{ id: provider.id, name: provider.name }] : [],
    ),
  };
}

function validateIssuer(name: string, issuer: string, errors: string[]) {
  if (!issuer) return;
  try {
    const parsed = new URL(issuer);
    const localHost = ["localhost", "127.0.0.1", "::1"].includes(
      parsed.hostname,
    );
    if (parsed.protocol !== "https:" && !localHost) {
      errors.push(`${name} must use HTTPS unless it points to localhost.`);
    }
    if (parsed.search || parsed.hash) {
      errors.push(`${name} must not include a query string or fragment.`);
    }
  } catch {
    errors.push(`${name} must be a valid absolute URL.`);
  }
}

export function validateAuthProviderEnvironment(
  environment: AuthEnvironment = process.env,
) {
  const errors: string[] = [];
  const passwordSetting = value(
    environment,
    "AUTH_PASSWORD_ENABLED",
  ).toLowerCase();
  if (passwordSetting && !["true", "false"].includes(passwordSetting)) {
    errors.push("AUTH_PASSWORD_ENABLED must be either true or false when set.");
  }

  const configuredAuth0Issuer = auth0Issuer(environment);
  const auth0Values = [
    value(environment, "AUTH0_CLIENT_ID"),
    value(environment, "AUTH0_CLIENT_SECRET"),
    value(environment, "AUTH0_ISSUER_BASE_URL") ||
      value(environment, "AUTH0_DOMAIN"),
  ];
  if (auth0Values.some(Boolean) && !auth0Values.every(Boolean)) {
    errors.push(
      "Auth0 configuration is incomplete; set client ID, client secret, and domain or issuer.",
    );
  }
  validateIssuer("AUTH0 issuer", configuredAuth0Issuer, errors);

  const oidcValues = [
    value(environment, "AUTH_OIDC_ISSUER"),
    value(environment, "AUTH_OIDC_CLIENT_ID"),
    value(environment, "AUTH_OIDC_CLIENT_SECRET"),
  ];
  const hasAnyOidcSetting = oidcValues.some(Boolean);
  if (hasAnyOidcSetting && !oidcValues.every(Boolean)) {
    errors.push(
      "OIDC configuration is incomplete; set AUTH_OIDC_ISSUER, AUTH_OIDC_CLIENT_ID, and AUTH_OIDC_CLIENT_SECRET.",
    );
  }

  const oidcId = value(environment, "AUTH_OIDC_PROVIDER_ID") || "oidc";
  if (hasAnyOidcSetting && !providerIdPattern.test(oidcId)) {
    errors.push(
      "AUTH_OIDC_PROVIDER_ID must start with a lowercase letter and contain at most 32 lowercase letters, numbers, or hyphens.",
    );
  }
  if (hasAnyOidcSetting && reservedProviderIds.has(oidcId)) {
    errors.push(
      "AUTH_OIDC_PROVIDER_ID is reserved; choose an ID other than auth0, credentials, demo, or local.",
    );
  }

  const oidcName = value(environment, "AUTH_OIDC_PROVIDER_NAME");
  if (oidcName.length > 64) {
    errors.push("AUTH_OIDC_PROVIDER_NAME must contain at most 64 characters.");
  }

  const scopes = (
    value(environment, "AUTH_OIDC_SCOPES") || "openid email profile"
  )
    .split(/\s+/)
    .filter(Boolean);
  if (
    hasAnyOidcSetting &&
    (!scopes.includes("openid") || !scopes.includes("email"))
  ) {
    errors.push("AUTH_OIDC_SCOPES must include both openid and email.");
  }
  validateIssuer("AUTH_OIDC_ISSUER", oidcValues[0], errors);

  const configuration = getAuthProviderConfiguration(environment);
  const demoEnabled =
    value(environment, "DEMO_ACCESS_ENABLED").toLowerCase() === "true";
  if (
    !configuration.passwordEnabled &&
    !configuration.auth0 &&
    !configuration.oidc &&
    !demoEnabled
  ) {
    errors.push(
      "At least one authentication provider must be enabled. Enable password login, Auth0, OIDC, or demo access.",
    );
  }

  return { errors, configuration };
}
