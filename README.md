<div align="center">
  <img src="./deploy/coolify/open-inventory.svg" width="96" alt="Open Inventory logo">

  <h1>Open Inventory</h1>

  <p><strong>Self-hosted inventory and stock management for teams, spaces, and physical things.</strong></p>

  <p>Made by <a href="https://paperlesspaper.de">paperlesspaper</a> · Sponsored by <strong>WireWire GmbH</strong></p>

  <p>
    <a href="https://github.com/Utzel-Butzel/inventory/actions/workflows/deployment-check.yml"><img src="https://github.com/Utzel-Butzel/inventory/actions/workflows/deployment-check.yml/badge.svg" alt="Deployment check"></a>
    <a href="./LICENSE"><img src="https://img.shields.io/github/license/Utzel-Butzel/inventory?color=665cff" alt="MIT License"></a>
    <a href="https://github.com/Utzel-Butzel/inventory/pkgs/container/inventory"><img src="https://img.shields.io/badge/container-GHCR-2496ED?logo=docker&logoColor=white" alt="GHCR container image"></a>
  </p>

  <p>
    <a href="https://openinventory.polyxo.de">Website</a> ·
    <a href="https://demo.openinventory.polyxo.de/login?demo=1">Live demo</a> ·
    <a href="https://docs.openinventory.polyxo.de">Documentation</a> ·
    <a href="#quick-start">Quick start</a>
  </p>
</div>

Open Inventory helps teams, makerspaces, and businesses keep track of equipment,
supplies, and other physical assets. Catalog what you own, find where it is,
and manage stock, reservations, and shared equipment on your own infrastructure.

Explore the [live demo](https://demo.openinventory.polyxo.de/login?demo=1) or visit
[the website](https://openinventory.polyxo.de) for screenshots, use cases, and
app downloads.

<p align="center">
  <a href="https://demo.openinventory.polyxo.de/login?demo=1">
    <img src="https://openinventory.polyxo.de/marketing/screenshots/web-inventory-cards-demo.png" width="960" alt="Open Inventory demo showing tools, consumables, photos, locations, and stock quantities in a card view">
  </a>
</p>

## Features

| | |
| --- | --- |
| **Flexible inventory** | Custom types and fields, relationships, tags, photos, attachments, and variants |
| **Stock management** | Quantities and serial numbers, location balances, inventory counts, reservations, bills of materials, and purchase orders |
| **Mobile capture** | QR and barcode scanning, printable labels, photo batches, and native iOS and Android apps |
| **Maps and rooms** | Geographic locations, indoor 3D placement, and LiDAR room scans through the iOS app |
| **Team access** | Multiple organizations, configurable roles and permissions, and notifications |
| **Integrations** | CSV/Excel/PDF exchange, a REST API, webhooks, and an opt-in MCP endpoint |
| **Optional AI** | Item recognition, photo counting, image generation, and translations |

See the [feature overview](https://openinventory.polyxo.de/features) for more.

## A look inside

Track stock levels and design scannable labels for your equipment and supplies.

<table>
  <tr>
    <th width="50%">Stock at a glance</th>
    <th width="50%">Printable QR labels</th>
  </tr>
  <tr>
    <td><a href="https://openinventory.polyxo.de/marketing/screenshots/web-stock.png"><img src="https://openinventory.polyxo.de/marketing/screenshots/web-stock.png" width="480" alt="Stock overview with quantities, low-stock alerts, incoming orders, and estimated coverage"></a></td>
    <td><a href="https://openinventory.polyxo.de/marketing/screenshots/web-label-designer.png"><img src="https://openinventory.polyxo.de/marketing/screenshots/web-label-designer.png" width="480" alt="Label designer with item selection and a printable QR-code label preview"></a></td>
  </tr>
</table>

From the screen to the shelf: QR labels connect physical storage to your inventory.

<table>
  <tr>
    <th width="60%">Find the right shelf</th>
    <th width="40%">Identify individual parts bins</th>
  </tr>
  <tr>
    <td align="center"><a href="https://openinventory.polyxo.de/marketing/real-world/shelf-labels.webp"><img src="https://openinventory.polyxo.de/marketing/real-world/shelf-labels.webp" width="560" alt="Storage shelf with printed labels for AA and AAA batteries, including QR codes and item illustrations"></a></td>
    <td align="center"><a href="https://openinventory.polyxo.de/marketing/real-world/parts-bin-label.webp"><img src="https://openinventory.polyxo.de/marketing/real-world/parts-bin-label.webp" width="280" alt="Blue storage bin filled with spacers and marked with a QR-code label and item image"></a></td>
  </tr>
</table>

Photos and screenshots from the [Open Inventory website](https://openinventory.polyxo.de).
Click the gallery images to view them at full size.

## Quick start

You need Git, Docker with Compose v2, OpenSSL, and `curl`.

```bash
git clone https://github.com/Utzel-Butzel/inventory.git
cd inventory
./scripts/install.sh
```

The installer generates secrets, starts the app and PostgreSQL, applies database
migrations, and prints the sign-in details. By default, the app runs at
[http://localhost:3000](http://localhost:3000).

> [!IMPORTANT]
> After the first sign-in, change the generated password under **Settings →
> Users**. Then remove `BOOTSTRAP_ADMIN_PASSWORD` and
> `BOOTSTRAP_ADMIN_PASSWORD_ONCE` from `.env` and restart the stack.

For production setup and deployment options, follow the
[installation guide](https://docs.openinventory.polyxo.de/installation) or the
[website's deployment guide](https://openinventory.polyxo.de/docs), including
Docker Compose, Dokploy, and Coolify.

## Documentation

The full documentation lives at
**[docs.openinventory.polyxo.de](https://docs.openinventory.polyxo.de)**.

- [Configuration and branding](https://docs.openinventory.polyxo.de/configuration)
  · [Environment variables](https://docs.openinventory.polyxo.de/environment-variables)
- [Authentication providers](https://docs.openinventory.polyxo.de/authentication)
- [Operations and backups](https://docs.openinventory.polyxo.de/operations)
- [Labels and printing](https://docs.openinventory.polyxo.de/printing)
- [REST API](https://docs.openinventory.polyxo.de/api)
  · [API reference](https://docs.openinventory.polyxo.de/api-reference)
  · [MCP integration](https://docs.openinventory.polyxo.de/mcp)
- [Paperlesspaper E-Paper integration](integrations/paperlesspaper/README.md)
  · Configure the instance URL, API key and stock view directly in Paperlesspaper.

## Development and contributing

The web app uses Next.js, React, TypeScript, PostgreSQL, and Drizzle ORM. This
repository also contains the native iOS and Android apps and deployment templates.

- [Local development, commands, and project structure](docs/development.md)
- [iOS setup and TestFlight deployment](ios/Inventory/README.md)
- [Android setup and feature parity](android/README.md)
- [Website and documentation source](https://github.com/Utzel-Butzel/open-inventory-website)

Contributions and bug reports are welcome. For larger changes, open an
[issue](https://github.com/Utzel-Butzel/inventory/issues) first to discuss the scope.
Before opening a pull request, run `npm run lint`, `npm run typecheck`, and the
relevant test suites, and include a short description of how you verified the change.

## License

[MIT](LICENSE).
