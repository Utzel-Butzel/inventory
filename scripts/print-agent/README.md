# Shared Office label printing

Users select **Shared Office printer** on `/inventory/labels`. Their browser renders
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
4. Verify **Online** in Inventory and send one test label. Remove the temporary
   copy of `config.json` and any temporary transfer share after installation.

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
  cancelled by their submitting user.
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
