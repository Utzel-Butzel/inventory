# Open labels in the iOS app

Labels retain their ordinary HTTPS URLs (`/r/<short-code>`, optionally with
`?unit=<short-code>`). Scanning a label opens the self-hosted web app. On
iPhone/iPad, resource and stock pages offer **Open in app**. The login page also
offers it when its callback points to a resource, so web login is not required
before opening the native app.

The button uses `inventory://open?url=<encoded instance destination>`. The same
installed iOS app handles any self-hosted instance domain; no central link
service, domain registration, association file or Associated Domains entitlement
is required. Existing labels do not need to be reprinted. The button is only
shown for supported inventory destinations on iPhone/iPad and requires the
updated native app to be installed. iOS may ask the user to confirm opening it.
There is no automatic app launch or App Store redirect.

## Destination and login

The button retains the instance URL, organization/resource path and selected unit.
It does not forward unrelated query parameters, fragments or credentials.

The app validates the destination and compares its scheme, hostname and effective
port with the active server. It opens the resource directly without starting the
camera. Unit links display the selected exemplar at the top of the stock view.

If login is required, the target stays available while the user signs in. For a
different server, the login form is prefilled with the target server. Existing
credentials are not sent to that server. Organization-scoped web links request
the matching organization when necessary; older unscoped links use the active
organization.

The phone must be able to reach the instance. HTTP depends on the app's existing
transport configuration. Deployment beneath a URL subpath is not supported by
this link contract.

## Deployment and verification

Deploy the web app and distribute the updated iOS app through the existing
TestFlight/App Store workflow. No additional domain or signing capability setup
is needed.

```sh
node --experimental-strip-types --experimental-loader ./tests/support/typescript-paths-loader.mjs --test tests/native-app-link.test.mjs tests/resource-short-link.test.mjs tests/label-target.test.mjs
npm run typecheck
xcodebuild test -project ios/Inventory/Inventory.xcodeproj -scheme Inventory -destination 'platform=iOS Simulator,name=iPhone 18 Pro' -only-testing:InventoryTests/InventoryLinkTests -only-testing:InventoryTests/ResourceCodeParserTests CODE_SIGNING_ALLOWED=NO
```

On a physical iPhone, scan a resource label and an individual-unit label, then tap
**Open in app**. Verify cold launch, an already running app, signed-out state,
another active server and organization, and opening from the web login page.
Without the native app, the user can continue using the web page.
