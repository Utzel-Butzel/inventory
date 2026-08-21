# Authentication providers

Open Inventory uses [Auth.js](https://authjs.dev/) (`next-auth` v5) for browser
authentication. The application keeps authorization separate: organization
memberships, roles, permissions, and account activation remain in the Open
Inventory database.

Authentication providers are configured for the entire deployment through
environment variables. Every organization served by the same container sees
the same configured sign-in methods.

## Supported methods

| Method | Auth.js integration | Default | Notes |
| --- | --- | --- | --- |
| Local password | Credentials provider | Enabled | Also powers native password-to-token login |
| Auth0 | Built-in Auth0 provider | Disabled | Enabled when all required `AUTH0_*` values are present |
| Generic OpenID Connect | Custom OIDC provider | Disabled | One configurable slot for Supabase, Keycloak, Zitadel, and similar services |
| Read-only demo | Credentials provider | Disabled | Dedicated product-demo principal, not a general user login method |

Local password, Auth0, and the generic OIDC provider can be shown together on
the login page. The generic OIDC slot supports one provider per deployment;
Auth0 can be enabled alongside it.

## Authentication and authorization

An external provider proves a user's identity. It does not create an Open
Inventory account, organization, membership, or role.

For an external login to be accepted:

1. An Open Inventory administrator must create a user with the same lowercase
   email address.
2. The provider must return the standard `email_verified` claim as `true`.
3. The local user must be active and have an active organization membership.

The user-management form currently requires a temporary local password when an
account is created. It does not need to be shared with an external-only user.
Open Inventory resolves the user's current membership, role, permissions, and
active state from its own database on each request.

Provider roles or groups are not imported automatically. Configure access under
**Settings → Users** and **Settings → Access**.

## Common application settings

Every deployment requires a public application URL and an Auth.js secret:

```dotenv
AUTH_URL=https://inventory.example.com
AUTH_SECRET=replace-with-a-long-random-secret
AUTH_TRUST_HOST=true
```

`AUTH_URL` must be the externally reachable HTTPS origin. Callback URLs
registered with providers must use this same origin, including the correct
scheme, host, and any reverse-proxy configuration.

Generate `AUTH_SECRET` with a cryptographically secure generator, for example:

```bash
openssl rand -base64 48
```

Changing `AUTH_SECRET` invalidates all current browser sessions.

## Local password login

Password login is enabled by default:

```dotenv
AUTH_PASSWORD_ENABLED=true
```

The initial administrator can be provisioned with the existing bootstrap
settings described in [`.env.example`](.env.example). Additional accounts are
managed under **Settings → Users**.

To disable password login after an external provider has been tested:

```dotenv
AUTH_PASSWORD_ENABLED=false
```

This removes the password form and disables `POST /api/v1/auth/login`, which is
used by the native iOS app to exchange a password for an API token. The current
iOS client does not implement the browser OAuth/OIDC flow, so an external-only
deployment cannot use that native login path.

## Auth0

Create an Auth0 application for Open Inventory and register this callback URL:

```text
https://inventory.example.com/api/auth/callback/auth0
```

Configure the container with:

```dotenv
AUTH0_CLIENT_ID=your-client-id
AUTH0_CLIENT_SECRET=your-client-secret
AUTH0_DOMAIN=your-tenant.eu.auth0.com
```

Instead of `AUTH0_DOMAIN`, an explicit issuer can be provided:

```dotenv
AUTH0_ISSUER_BASE_URL=https://your-tenant.eu.auth0.com
```

The Auth0 button is enabled only when the client ID, client secret, and either
the domain or issuer are present. If both domain and issuer are set, the
explicit issuer takes precedence.

## Generic OpenID Connect provider

The generic provider works with an OIDC issuer that supports discovery and the
authorization-code flow. Open Inventory requests PKCE, state, and nonce checks.
The provider must expose identity claims for `sub`, `email`, and
`email_verified`.

Configure it with:

```dotenv
AUTH_OIDC_PROVIDER_ID=company-sso
AUTH_OIDC_PROVIDER_NAME=Company SSO
AUTH_OIDC_ISSUER=https://identity.example.com
AUTH_OIDC_CLIENT_ID=your-client-id
AUTH_OIDC_CLIENT_SECRET=your-client-secret
AUTH_OIDC_SCOPES=openid email profile
```

Register this callback URL, using the configured provider ID as the final path
segment:

```text
https://inventory.example.com/api/auth/callback/company-sso
```

The issuer is the OIDC issuer URL, not the full discovery-document URL. Auth.js
uses it to discover the authorization, token, UserInfo, and key endpoints.

### Provider ID rules

`AUTH_OIDC_PROVIDER_ID`:

- must start with a lowercase letter;
- may contain lowercase letters, numbers, and hyphens;
- may contain at most 32 characters;
- cannot be `auth0`, `credentials`, `demo`, or `local`.

Changing the provider ID also changes the callback URL. Update the provider's
registered redirect URI before redeploying.

### Scopes

`AUTH_OIDC_SCOPES` defaults to:

```text
openid email profile
```

The configured scopes must include both `openid` and `email`. The `profile`
scope is optional but recommended for the user's display name and image.

## Supabase Auth example

Supabase Auth can expose an OAuth 2.1/OpenID Connect server. Enable it in the
Supabase project, configure the required authorization UI, and register Open
Inventory as an OAuth client. See the official
[Supabase OAuth server guide](https://supabase.com/docs/guides/auth/oauth-server).

Use this configuration:

```dotenv
AUTH_OIDC_PROVIDER_ID=supabase
AUTH_OIDC_PROVIDER_NAME=Supabase
AUTH_OIDC_ISSUER=https://your-project.supabase.co/auth/v1
AUTH_OIDC_CLIENT_ID=your-supabase-oauth-client-id
AUTH_OIDC_CLIENT_SECRET=your-supabase-oauth-client-secret
AUTH_OIDC_SCOPES=openid email profile
```

Register this redirect URI in Supabase:

```text
https://inventory.example.com/api/auth/callback/supabase
```

The project must use an OIDC-compatible signing configuration and return a
verified email claim for the user.

## Keycloak example

For a Keycloak realm, the issuer normally includes the realm path:

```dotenv
AUTH_OIDC_PROVIDER_ID=keycloak
AUTH_OIDC_PROVIDER_NAME=Company Login
AUTH_OIDC_ISSUER=https://sso.example.com/realms/inventory
AUTH_OIDC_CLIENT_ID=open-inventory
AUTH_OIDC_CLIENT_SECRET=your-client-secret
AUTH_OIDC_SCOPES=openid email profile
```

Register:

```text
https://inventory.example.com/api/auth/callback/keycloak
```

Ensure the Keycloak client includes the user's email and verified-email claims
in the ID token or UserInfo response.

## Running multiple methods

To offer password, Auth0, and Supabase on the same login page, keep password
enabled and provide both external configurations:

```dotenv
AUTH_PASSWORD_ENABLED=true

AUTH0_CLIENT_ID=your-auth0-client-id
AUTH0_CLIENT_SECRET=your-auth0-client-secret
AUTH0_DOMAIN=your-tenant.eu.auth0.com

AUTH_OIDC_PROVIDER_ID=supabase
AUTH_OIDC_PROVIDER_NAME=Supabase
AUTH_OIDC_ISSUER=https://your-project.supabase.co/auth/v1
AUTH_OIDC_CLIENT_ID=your-supabase-oauth-client-id
AUTH_OIDC_CLIENT_SECRET=your-supabase-oauth-client-secret
AUTH_OIDC_SCOPES=openid email profile
```

After changing provider variables, restart or redeploy the application
container. Provider configuration is read when the server starts.

## Docker and one-click deployments

The root [`docker-compose.yml`](docker-compose.yml), Coolify definition, and
Dokploy definition forward all supported provider variables into the
application container.

For Docker Compose, add the variables to the Compose `.env` file and recreate
the application container:

```bash
docker compose up -d --build app
```

For Coolify or Dokploy, add the variables to the `inventory` service's
environment and redeploy it. The Dokploy Base64 import bundle contains the same
environment mappings.

## Safe rollout

Use this sequence to avoid locking administrators out:

1. Leave `AUTH_PASSWORD_ENABLED=true`.
2. Configure the external provider and its exact callback URL.
3. Create or verify an Open Inventory user whose email matches the provider.
4. Redeploy the container.
5. Test external login in a private browser window.
6. Confirm the expected organization and role.
7. Only then set `AUTH_PASSWORD_ENABLED=false`, if external-only login is
   required.

Production startup rejects incomplete provider credentials and refuses to
start if password, Auth0, OIDC, and demo access are all disabled. It cannot
detect a complete but unreachable or incorrectly configured external provider,
which is why password login should remain available during testing.

## Session behavior

Auth.js issues an encrypted Open Inventory browser session lasting up to 12
hours. Open Inventory does not store or use external-provider access tokens for
application authorization.

Disabling a provider prevents new logins after the container is restarted, but
does not remotely revoke already-issued Open Inventory sessions. To terminate
access immediately, deactivate the local Open Inventory user. Rotating
`AUTH_SECRET` invalidates every browser session and should be reserved for a
deployment-wide logout.

Signing out of Open Inventory clears the Open Inventory session. The identity
provider may retain its own SSO session, so selecting the same provider again
can sign the user back in without another password prompt.

## Environment variable reference

| Variable | Default | Purpose |
| --- | --- | --- |
| `AUTH_URL` | None | Public Open Inventory origin used for callbacks |
| `AUTH_SECRET` | None | Auth.js session encryption/signing secret |
| `AUTH_TRUST_HOST` | `true` in container definitions | Trust reverse-proxy host headers |
| `AUTH_PASSWORD_ENABLED` | `true` | Enable browser and native password login |
| `AUTH0_CLIENT_ID` | Empty | Auth0 application client ID |
| `AUTH0_CLIENT_SECRET` | Empty | Auth0 application client secret |
| `AUTH0_DOMAIN` | Empty | Auth0 tenant domain |
| `AUTH0_ISSUER_BASE_URL` | Empty | Explicit Auth0 issuer; overrides the domain |
| `AUTH_OIDC_PROVIDER_ID` | `oidc` | Provider ID and callback-path segment |
| `AUTH_OIDC_PROVIDER_NAME` | `OpenID Connect` | Label displayed on the login button |
| `AUTH_OIDC_ISSUER` | Empty | OIDC issuer URL |
| `AUTH_OIDC_CLIENT_ID` | Empty | OIDC client ID |
| `AUTH_OIDC_CLIENT_SECRET` | Empty | OIDC client secret |
| `AUTH_OIDC_SCOPES` | `openid email profile` | Space-separated OIDC scopes |

## Troubleshooting

### The provider button is missing

- Confirm all three issuer/client variables are present in the running
  container, not only in the host shell.
- For Auth0, confirm client ID, client secret, and domain or issuer are set.
- Restart or redeploy after changing environment variables.
- Check the production startup logs for incomplete-configuration errors.

### The provider reports a callback mismatch

- Use the public HTTPS origin from `AUTH_URL`.
- Verify the callback path uses the exact provider ID.
- Do not add or omit a reverse-proxy path prefix.
- Update the registered callback after changing
  `AUTH_OIDC_PROVIDER_ID`.

### Login succeeds at the provider but Open Inventory remains unauthorized

- Create the user under **Settings → Users** first.
- Match the email address exactly; Open Inventory stores it in lowercase.
- Confirm the provider returns `email_verified: true`.
- Confirm the local user and organization membership are active.
- Confirm the user's assigned role still exists.

### OIDC discovery or token validation fails

- Set `AUTH_OIDC_ISSUER` to the issuer, not directly to
  `.well-known/openid-configuration`.
- Use HTTPS except for a provider running on localhost during development.
- Confirm the provider exposes discovery metadata and signing keys.
- Confirm the client supports the authorization-code flow and PKCE.
- Confirm `AUTH_OIDC_SCOPES` includes `openid email`.

### The production container refuses to start

Open Inventory deliberately fails closed when provider credentials are partial,
the provider ID is invalid, required scopes are missing, or every login method
is disabled. Correct the reported environment variable and redeploy.

## Security notes

- Never expose client secrets through `NEXT_PUBLIC_*` variables.
- Keep provider secrets in the deployment platform's secret store.
- Use HTTPS for Open Inventory and the identity provider.
- Restrict provider callback URLs to the exact Open Inventory route.
- Keep a tested recovery administrator while rolling out external-only login.
- Deactivate departed users in Open Inventory even if they are also disabled at
  the identity provider.
- Treat `AUTH_SECRET` rotation as a logout of all browser sessions.

