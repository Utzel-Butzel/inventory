# Native iOS and Android browser sign-in

In the iOS or Android connection screen, enter the deployment URL and choose the configured provider.
`GET /api/v1/auth/options` returns only this deployment’s public provider IDs and
names plus password availability, with `Cache-Control: no-store`. Apps clear old
options immediately when the server changes; unconfigured servers have no SSO
button, and the server rejects browser/start if no external provider is configured. The system authentication browser uses the deployment's existing
web sign-in page, including Supabase/Konglomerat, Auth0 and generic OIDC. It can
reuse the browser's existing login. Enable **Use another SSO account** to request
an ephemeral browser session for a different account on the same server.

After web sign-in, a confirmation shows the account, organization and server.
**Connect to app** returns to the app and saves a revocable device credential in
the same account collection used by password login and the account switcher:
iOS Keychain or an atomic AES-GCM document protected by Android Keystore.
Android uses Custom Tabs; requesting another SSO account requires a browser that
supports ephemeral Custom Tabs. Pending Android handoffs are also encrypted and
survive process death. Credentials and preferred organizations stay separate per
server and account; signing out removes only the active account.
Canceling preserves the previous active account. Provider access tokens, browser
cookies, provider client secrets and passwords are never copied into the app.

## Deployment

Deploy the server code and apply `0080_native_browser_auth.sql` using the normal
migration runner (`npm run db:migrate`), then distribute the updated iOS and Android apps.
The new server is backward compatible with existing password/API-token clients.
Older servers do not provide browser handoff; the apps cannot load SSO options and keep the existing password/API-token
options available.

Use the canonical HTTPS deployment URL, matching `AUTH_URL`. Only loopback HTTP
is allowed for browser-login development. Konglomerat's canonical URL is
`https://inventar.konglomerat.org`. **No new OAuth client or provider redirect URI
is needed:** provider callbacks remain the existing `/api/auth/callback/...`
endpoints configured for the PWA. This change has not itself deployed anything
or verified a real Konglomerat member's interactive login.

## Protocol and authorization

1. The app creates independent 32-byte random state and PKCE verifier values.
   `POST /api/v1/auth/browser/start` accepts the S256 challenge, state and device
   name, stores a hashed request identifier for ten minutes, and returns the raw
   request identifier. It accepts no caller-chosen callback URI.
2. `GET /api/v1/auth/browser/authorize?request=...` binds the request to an
   HttpOnly, host-only SameSite=Lax browser cookie. It redirects through the normal
   web login when necessary, then renders an explicit account confirmation.
3. A same-origin, CSRF-checked `POST /api/v1/auth/browser/complete` rechecks the
   session, account and selected organization. It returns only a random code and
   the original state to `de.polyxo.openinventory://auth/callback`. The database
   stores the code's hash; the code expires after sixty seconds. Cancel returns
   `error=access_denied` and deletes the request.
4. The app verifies the exact callback scheme/host/path and state, then exchanges
   the code, request identifier and original verifier at the selected server.
   `POST /api/v1/auth/browser/exchange` atomically consumes the matching grant and
   creates the device token in one database transaction. Concurrent exchanges
   can issue only one credential. A wrong verifier cannot consume a valid grant.
5. Both password and browser login use `issueNativeSession`. It rechecks active
   user status, session version, organization membership and role policy. Tokens
   are user-bound, hashed at rest on the server and expire according to
   `NATIVE_TOKEN_TTL_DAYS` (30 by default). API requests continue to enforce live
   permissions, disabled users and revocation. SSO grants no additional access
   and never creates a local account or organization membership. Public demo and
   read-only organizations cannot mint these private device credentials.

The consent page is unframeable, has a restrictive CSP and uses no external
resources or scripts. Handoff responses are `no-store` and `no-referrer`.
Requests are size-limited and rate-limited. Expired grants are cleaned up when
new handoffs are started, so no single-process state or sticky sessions are
required.

The design follows [OAuth for Native Apps (RFC 8252)](https://www.rfc-editor.org/rfc/rfc8252)
and uses Android [Custom Tabs](https://developer.chrome.com/docs/android/custom-tabs/)
and iOS [ASWebAuthenticationSession](https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession).

## Verification

Run the contract tests and real PostgreSQL handoff tests against a **disposable**
database (never the application database):

```sh
NATIVE_AUTH_TEST_DATABASE_URL=postgresql://localhost/native_auth_test \
node --experimental-strip-types --experimental-test-module-mocks \
  --experimental-loader ./tests/support/auth-loader.mjs --test \
  tests/native-auth-contract.test.mjs tests/native-browser-auth.test.mjs
```

The integration harness creates and drops its own schema. It tests the actual
routes, SQL transactions and token issuance, with controlled browser identities
and memberships. The existing Supabase tests exercise the Auth.js provider flow
with a simulated identity provider. iOS and Android tests cover PKCE, callback validation, cancellation, credential
isolation and account persistence. Android device tests additionally verify
Keystore encryption and recovery; provider-discovery tests cover different server
configurations without forwarding credentials. An interactive login
with a real provisioned Konglomerat account remains a release acceptance check.
