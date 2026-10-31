# General printing

Inventory supports local browser printing, PDF downloads and shared printers on
Windows, macOS and Linux. The existing PT-P710BT raster adapter and PowerShell
agent remain compatible. Apply migration `0074_general_printing.sql` before
running this version (`npm run db:migrate`). Existing printers default to P-touch.

## Print from this computer

Choose **Print from this computer** in Labels. Select an individual label/roll or
configure a sheet. A4 and Letter presets are starting points, not guaranteed
matches for a particular manufacturer's product. Enter the actual cell size,
row/column count, gaps and top/left margins from the stock packaging.

**First free position** counts left-to-right, row-by-row from 1. It only skips
cells on the first sheet. X/Y corrections move the grid without scaling it.
Labels must fit within their cells; they are never automatically shrunk.

Print opens a full page preview with pagination, a PDF download and the browser
print dialog. In the dialog choose the desired system printer, 100% / Actual size,
and no headers/footers. Set the matching paper size in the driver. Borderless
printing and custom roll sizes depend on the printer/driver. Use **Test scale**
and measure the 5 mm ticks before printing a batch. The preview shows physical
page coordinates, not the hardware's unprintable margins.

## Shared system printers

1. Install and test the printer using the operating system's normal driver.
2. In Labels choose **Shared printer → Set up printer**. Enter the display name,
   location, **System printer**, exact OS queue name and maximum paper width/height.
   These dimensions limit jobs; they do not configure the physical tray.
3. Download `config.json`. Keep its token private; it can only claim and acknowledge
   jobs for this registered printer. Disabling the printer revokes access and
   cancels queued jobs.
4. Run the agent on the computer with access to the printer. The server may be
   remote. Only outbound HTTPS is required; no inbound LAN port is opened.

The new agent is `scripts/print-agent/inventory_print_agent.py` and requires
Python 3.10 or later, with no additional Python packages. It accepts the old
single-printer configuration, including P-touch, or multiple printers:

```json
{
  "printers": [
    {
      "server": "https://inventory.example",
      "printer": "Office Printer",
      "kind": "system",
      "token": "TOKEN_FROM_FIRST_DOWNLOAD"
    },
    {
      "server": "https://inventory.example",
      "printer": "Brother_PT_P710BT_RAW",
      "kind": "ptouch",
      "token": "TOKEN_FROM_SECOND_DOWNLOAD"
    }
  ]
}
```

Each queue has its own token, lock and durable journal. Multiple downloaded
configurations can also be supplied with repeated `--config` arguments. Keep one
agent instance per queue and use a stable `--state-dir` across restarts. Do not
run the old and new agents for the same printer simultaneously. When migrating,
stop the old agent only after its pending receipt has been acknowledged.

### macOS / Linux

CUPS and its `lp`/`lpstat` commands must be available. List queues and run:

```sh
python3 scripts/print-agent/inventory_print_agent.py --list-printers
chmod 600 config.json
python3 scripts/print-agent/inventory_print_agent.py --config config.json
```

For PDF jobs the agent requests the page's exact dimensions using CUPS custom
media and disables scaling and duplex. If a driver requires a named media size,
add a local `"paper": "A4"` (or the driver's exact media keyword) to that queue's
configuration. Configure separate queues for different stocks when necessary.
Inspect supported options with `lpoptions -p QUEUE -l`.

For automatic startup, run this same command under launchd (macOS) or systemd
(Linux), with absolute paths to Python, the agent, config and a stable state
directory. The service account must have access to the printer and exclusive
access to the configuration/state directory. Restart on failure. The interactive
command is also useful for diagnosing setup problems. `--once` performs one
poll/receipt cycle; it can print a queued job and is not a dry run.

P-touch queues must support raw pass-through; see [P-touch setup](ptouch-printing.md).
Do not send PDFs to the dedicated P-touch RAW queue.

### Windows

Install Python 3.10+ and a current [SumatraPDF](https://www.sumatrapdfreader.org/)
version supporting custom paper sizes and `disable-auto-rotation`. The PDF path
uses SumatraPDF's command-line printing through the installed Windows driver,
with exact scale and explicit page size. Add its absolute executable path to
`config.json` as `pdfPrinter`, or use the installer below. A driver-specific
`paper` name can override automatic custom dimensions. The selected paper must
match the PDF dimensions. P-touch jobs continue to use Winspool RAW directly.

Put `config.json`, `inventory_print_agent.py` and `Install-SystemPrintAgent.ps1`
in the same folder. In PowerShell, run:

```powershell
.\Install-SystemPrintAgent.ps1 -PythonExe 'C:\Path\To\pythonw.exe' -PdfPrinter 'C:\Program Files\SumatraPDF\SumatraPDF.exe'
```

The installer registers a task for the current user's logon and protects its
files in `%LOCALAPPDATA%\InventoryPrintAgent`. The user must remain signed in,
although the screen may be locked. For an unattended service, configure a service
account with the appropriate driver/queue access separately. No execution policy
is changed by the installer. For diagnostics, run the Python script with
`python.exe` in a console using the same config and state directory, after stopping
the scheduled task. The legacy P-touch installer remains available for existing
Local Service deployments.

## Prepared labels and output fidelity

New prepared labels include a frozen 300 dpi PNG with exact physical dimensions,
QR/photo regions and a copy of the editable resource/template. Browser pages and
PDFs use these pixels; text in the PDF is rasterized, not selectable. P-touch
output uses its native resolution and photo processing. Limits are 100 labels,
16 million pixels per label, 64 million pixels per PDF and a 24 MiB request/workspace size; P-touch retains
its 4 MB raw job limit. Legacy saved rasters still print and their frozen previews
can be exported at the original tape dimensions.

The same prepared list can be sent to another compatible destination. Fit is
checked before submission. A remote PDF job must use one page size; put mixed
label sizes on a sheet or submit separate jobs. The browser/PDF preview retains
the prepared list because opening a dialog does not prove that paper was printed.
The existing direct P-touch flow clears its list after accepted submission.

## Status and retry behavior

- **Queued**: waiting for the agent. Can be cancelled; expires after 10 minutes.
- **Claimed**: reserved by one agent. Never redistributed to another claim.
- **Submitted**: the OS spooler/PDF printing process accepted the job; this does
  not confirm physical completion.
- **Uncertain**: submission may have happened, including a crash during printing.
  Check the printer and OS queue before submitting another job.
- **Failed**: validation/setup failed before submission.

Lost claim responses reuse a durable claim ID. Lost receipts retry only the
receipt. No physical submission is automatically repeated. Each new agent queue
uses a private state directory; do not delete pending journals to clear an error.
PDF bytes are generated by Inventory from validated PNGs, not accepted as arbitrary
uploaded PDFs or commands. Queue destinations and executable paths come only from
local configuration. P-touch payloads retain their strict command validation.

## Validation

```sh
npm run test:printing
npm run test:labels
npm run test:shared-printing
npm run typecheck
```

Set `TEST_DATABASE_URL` to a disposable PostgreSQL database to run the queue
integration test (it creates and removes an isolated schema). Agent tests mock
network and spool submission; they do not print. Before production rollout, test
one physical page on each OS/driver combination and measure/scan the output.
