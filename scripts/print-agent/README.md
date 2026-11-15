# Agent version 2: office PC and Mac

Deploy the server with migration `0081_printer_status_and_cancellation.sql` before
updating these agents. Keep the existing config, installation name and state
journals. Never run the old and new agent for the same registration simultaneously.

Use separate registrations/configs for the office PC and the Mac. The Labels
setup panel downloads this archive and a separate credential-bearing config.
A config from another Inventory website cannot be used for this website.

For macOS, put the downloaded `config.json` next to these files and run:

```sh
python3 install_macos.py --config config.json --name paperlesspaper
```

Python 3.10+ and Xcode command-line tools are required. Bluetooth configs must
include the paired PT-P710BT's `bluetoothAddress`; the installer sets the absolute
`bluetoothHelper` path. It starts a private per-user LaunchAgent, so waiting jobs
can print immediately. The Mac needs internet and Bluetooth permission. A separate
installation name preserves an existing agent for another website.

For Windows P-touch, use the PowerShell installer below. The updated Python agent
and `Install-SystemPrintAgent.ps1` also support Windows system/PDF printers.
Stop the old agent after outstanding jobs/receipts have finished before updating.
Do not remove `pending.json` or the submitted-job receipts to clear errors.

Version 2 reports computer/device status and supports cancellation requests.
Windows/CUPS queue presence is shown as **readiness unknown**, never as a confirmed
Bluetooth connection. The Mac Bluetooth helper can report loaded tape and errors.

Queued jobs are cancelled before transfer. A running transfer/spool job can only
be stopped on a best-effort basis: already printed/buffered labels cannot be
retracted. Stop receipts are durable; a lost HTTP response retries the receipt,
not the print or cancel operation. Submitted spool jobs can be cancelled for ten
minutes using the local receipt. Browser/QZ jobs must be cancelled in the local
OS queue. Never automatically resubmit an uncertain job.

---

# Shared Office label printing

Users select **Shared Office printer** in the Labels view. Their browser renders
labels and submits a bounded job over HTTPS. A Windows agent pulls that printer's
jobs and writes RAW data to the locally installed PT-P710BT queue. Users need
neither a local printer driver nor QZ Tray, including when outside the office.
The Windows PC must remain awake, online and connected to the powered-on printer.

## Install on the printer PC

1. Install a dedicated local **Generic / Text Only** Windows queue named
   `Brother PT-P710BT Inventory`, using the PT-P710BT USB port and RAW/winprint.
   Load 24 mm tape (the shared-printer setup currently provisions this width).
2. In Inventory, an administrator with `tokens.manage` opens label printing,
   selects the shared destination, expands printer setup, creates a printer,
   and downloads `config.json`. Keep this file secret: it grants access to that
   printer's pending labels, not to inventory records or other printers.
3. Put `config.json`, `InventoryPrintAgent.ps1`, and
   `Install-InventoryPrintAgent.ps1` in a temporary directory on the Windows PC.
   Review the scripts, then run the installer from an elevated PowerShell:

   ```powershell
   .\Install-InventoryPrintAgent.ps1
   ```

   Follow the organization's PowerShell execution/signing policy. On a PC with
   the default Restricted policy, an administrator can explicitly authorize
   local scripts for the installer and task process only:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\Install-InventoryPrintAgent.ps1 -AllowLocalScripts
   ```

   This optional mode leaves machine/user policy unchanged and still enforces
   signatures for scripts marked as downloaded. Group Policy takes precedence. The installer creates **Inventory Office Label Printer**,
   an at-startup task running as **LOCAL SERVICE**, and starts it immediately.
   Files live in `C:\ProgramData\InventoryPrintAgent`, readable only by that
   service, SYSTEM and administrators. No inbound firewall rule is needed.
4. Verify the computer/device status in Inventory and send one test label. Remove the temporary
   copy of `config.json` and any temporary transfer share after installation.

## Another Inventory website on the same Windows PC

Register a printer on the second website and download its own `config.json`.
Put that configuration and the PowerShell scripts in a separate source folder,
then install with a stable, unique name (lowercase letters, digits and hyphens):

```powershell
.\Install-InventoryPrintAgent.ps1 -InstanceName konglomerat -AllowLocalScripts
```

Use `-AllowLocalScripts` only with the same explicit policy authorization as for
the first installation. This creates `Inventory Office Label Printer (konglomerat)`
and `C:\ProgramData\InventoryPrintAgent-konglomerat`, with a separate credential,
process lock and journal. The default installation remains unchanged. Both may
target the same local RAW queue; Windows schedules each complete print job.
Do not register the same server credential in two instances. Keep the instance
name and its `pending.json` when updating. For manual diagnostics pass the same
`-InstanceName konglomerat` to `InventoryPrintAgent.ps1` so its process lock
matches the scheduled task.

The RAW queue may use the printer's outgoing Bluetooth SPP COM port instead of
USB. Pair it in Windows first, select that port on the dedicated queue and ensure
**Use Printer Offline** is disabled. Confirm one physical test label before
using it for batches; pairing alone does not verify printing.

## Saved lists and API authentication

Prepared label lists and destination preferences are saved per user and
organization. Reloading the page restores them. Each prepared label retains its
layout, text, preview and raster snapshot; later template edits do not alter it.

`/api/v1/label-workspace`, `/api/v1/label-printers`, and
`/api/v1/label-print-jobs` require a browser session. The `iprt_` credential from
`config.json` only authenticates the `claim`, `ack`, `status`, and `control` endpoints under
`/api/v1/label-print-agent/`; it is not an inventory API token. The OpenAPI
specification documents these separate authentication methods and job statuses.

## Access and job behavior

- Only authenticated users with `labels.read` in the printer's organization can
  submit; read-only organizations are blocked. Administrators can disable a
  printer from the setup panel, immediately revoking its credential and cancelling
  waiting jobs. Create a replacement printer/configuration to rotate a credential.
- Jobs contain only validated PT-P710BT raster data; printer names, URLs, file paths
  and commands cannot be chosen by submitting clients.
- Limits: 100 labels and 4 MB per job; 10 submissions/minute per user/printer;
  20 pending jobs per printer. Waiting jobs expire after 10 minutes. Job history
  is retained for seven days and cleaned when the agent polls.
- **Submitted to Windows** confirms spooler acceptance, not physical printing.
  Check power, tape and Windows queue if no label emerges. Waiting jobs can be
  cancelled by their submitting user; version 2 agents also accept best-effort
  stop requests after dispatch.
- Requests use idempotency IDs. The agent writes a durable local journal before
  calling Windows. After a crash or ambiguous submission, a job becomes
  **Outcome uncertain** and is never printed again automatically. Check the
  physical output/Windows queue before explicitly submitting it again.

## Maintenance

```powershell
Get-ScheduledTask -TaskName 'Inventory Office Label Printer'
Get-ScheduledTaskInfo -TaskName 'Inventory Office Label Printer'
Stop-ScheduledTask -TaskName 'Inventory Office Label Printer'
Start-ScheduledTask -TaskName 'Inventory Office Label Printer'
```

For diagnostics, stop the task and run the installed agent in an elevated shell
with `-Once`. It does not log tokens or label contents. Preserve `pending.json`
when updating scripts; removing it can lose the crash-recovery receipt. Disable
printing in the web UI before uninstalling the scheduled task and private files.
Migration `0070_shared_label_printing.sql` runs through the existing production
startup migration runner. No additional server secrets are required.

## Verification

`npm run test:shared-printing` checks raster validation and body limits. Set
`TEST_DATABASE_URL` to a disposable/development PostgreSQL database to also run
queue isolation/concurrency tests; these use and remove their own random schema.

For journal diagnostics, stop the task temporarily and run the installed agent
with `-ValidateJournal` using the same approved PowerShell policy. This checks
atomic state replacement without contacting the server or sending a print job.
Start the task again afterward. Transport errors are stored in `last-error.txt`
inside the protected service directory; tokens and label payloads are not logged.


### Operating system queue administration

The label page separates Inventory job history from the computer's OS queue. Queue administration requires `tokens.manage`, since document titles and owners from other applications may be visible.

- Local QZ: explicitly connect the selected PT-P710BT queue to receive job events. QZ events are not a complete queue enumeration. Individual reported jobs or the entire named queue can be cancelled after confirmation. Queue clearing requires QZ Tray 2.2.4 or later. Completed events remain history; a successful API call does not prove physical cancellation.
- Remote: updated Python and PowerShell agents report the configured Windows/CUPS queue. Cancel one job or remove the displayed snapshot after confirmation. No blanket purge is used remotely: later arrivals are preserved. References include the job ID, title, owner and submission time; agents recheck them before deletion. Durable command receipts prevent replay after a lost response or restart.
- Snapshots expire after 45 seconds, commands after 60 seconds. Unknown/unavailable queues disable administration. OS permissions may prevent enumerating or deleting other users' jobs. Direct native Bluetooth has no OS spool queue; use Inventory job cancellation for that transport.

Apply migrations `0081` and `0082` before deploying these routes. Reinstall/update the agent bundle; Python installations require `spool_queue.py` alongside the agent, and the Windows PowerShell agent requires `spool-queue.ps1`. Existing agents continue printing but cannot provide this queue view. No incoming ports on the office PC are needed; the agent polls the server over HTTPS.
