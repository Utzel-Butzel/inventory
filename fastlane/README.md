fastlane documentation
----

# Installation

Make sure you have the latest version of the Xcode command line tools installed:

```sh
xcode-select --install
```

For _fastlane_ installation instructions, see [Installing _fastlane_](https://docs.fastlane.tools/#installing-fastlane)

# Available Actions

## iOS

### ios setup

```sh
[bundle exec] fastlane ios setup
```

Register the bundle ID and verify its App Store Connect record

### ios metadata

```sh
[bundle exec] fastlane ios metadata
```

Upload store text as a draft without submitting for review

### ios screenshots

```sh
[bundle exec] fastlane ios screenshots
```

Upload captured iOS screenshots without submitting for review

### ios check

```sh
[bundle exec] fastlane ios check
```

Validate the local Xcode project and shared deployment scheme

### ios build

```sh
[bundle exec] fastlane ios build
```

Build a signed App Store IPA without uploading it

### ios deploy

```sh
[bundle exec] fastlane ios deploy
```

Build and upload the next iOS build to TestFlight

----


## Android

### android build

```sh
[bundle exec] fastlane android build
```

Build the signed Android App Bundle locally

### android deploy

```sh
[bundle exec] fastlane android deploy
```

Upload a signed bundle to the internal Play track as a draft

----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
