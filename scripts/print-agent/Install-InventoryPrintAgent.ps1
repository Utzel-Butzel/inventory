# Run once in an elevated PowerShell after putting config.json beside this file.
param([string]$Source = $PSScriptRoot, [switch]$AllowLocalScripts)
$ErrorActionPreference='Stop'
$target=Join-Path $env:ProgramData 'InventoryPrintAgent'
$null=New-Item -ItemType Directory -Path $target -Force
# The agent credential only permits polling/receipting this single print queue.
# Keep it readable by administrators and the service account only.
$acl=New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true,$false)
foreach($sid in @('S-1-5-18','S-1-5-19','S-1-5-32-544')) {
    $identity=New-Object Security.Principal.SecurityIdentifier($sid)
    $rule=New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
    $acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $target -AclObject $acl
Copy-Item -LiteralPath (Join-Path $Source 'InventoryPrintAgent.ps1') -Destination $target -Force
Copy-Item -LiteralPath (Join-Path $Source 'config.json') -Destination $target -Force
$config=Get-Content -LiteralPath (Join-Path $target 'config.json') -Raw | ConvertFrom-Json
$printer=Get-Printer -Name $config.printer -ErrorAction Stop
if($printer.Name -notmatch 'P[ _-]?710BT'){throw 'Select the dedicated PT-P710BT RAW queue.'}
# Opt-in only: enable local scripts for this task process, never machine-wide.
$policyArgument=if($AllowLocalScripts){' -ExecutionPolicy RemoteSigned'}else{''}
$action=New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument ('-NoProfile -NonInteractive'+$policyArgument+' -File "'+$target+'\InventoryPrintAgent.ps1"')
$trigger=New-ScheduledTaskTrigger -AtStartup
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal=New-ScheduledTaskPrincipal -UserId 'S-1-5-19' -LogonType ServiceAccount -RunLevel Limited
$null=Register-ScheduledTask -TaskName 'Inventory Office Label Printer' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force
Start-ScheduledTask -TaskName 'Inventory Office Label Printer'
Write-Host 'Inventory print agent installed. Verify its online status in Inventory.'
