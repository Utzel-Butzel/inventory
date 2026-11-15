# Optional, explicit administrator setup. No general-purpose elevated command channel.
param([string]$ConfigPath = 'C:\ProgramData\InventoryPrintAgent\config.json')
$ErrorActionPreference='Stop'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=New-Object Security.Principal.WindowsPrincipal $identity
if(!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Run as administrator after approving printer recovery.'}
$config=Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
if($config.printer -notmatch 'P[ _-]?710BT'){throw 'Unsupported printer'}
$taskName='Inventory Printer Recovery'
$executable=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$action=New-ScheduledTaskAction -Execute $executable -Argument '-NoProfile -NonInteractive -Command "Restart-Service -Name Spooler -ErrorAction Stop; if((Get-Service Spooler).Status -ne ''Running''){exit 1}"'
$settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$taskPrincipal=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $taskName -Action $action -Settings $settings -Principal $taskPrincipal -Description 'Only restarts the Windows print service. Requested from Inventory printer recovery.' -Force | Out-Null
$service=New-Object -ComObject 'Schedule.Service'
$service.Connect()
$task=$service.GetFolder('\').GetTask($taskName)
# LOCAL SERVICE may read/run this fixed task, not edit its privileged action.
$descriptor=$task.GetSecurityDescriptor(4)
$acl=New-Object Security.AccessControl.RawSecurityDescriptor $descriptor
$sid=New-Object Security.Principal.SecurityIdentifier 'S-1-5-19'
$ace=New-Object Security.AccessControl.CommonAce ([Security.AccessControl.AceFlags]::None),([Security.AccessControl.AceQualifier]::AccessAllowed),0xA0000000,$sid,$false,$null
$acl.DiscretionaryAcl.InsertAce($acl.DiscretionaryAcl.Count,$ace)
$task.SetSecurityDescriptor($acl.GetSddlForm([Security.AccessControl.AccessControlSections]::Access),0)
$config | Add-Member -NotePropertyName recoveryTask -NotePropertyValue $taskName -Force
$config | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $ConfigPath -Encoding UTF8
Write-Host 'Printer recovery enabled. Other printers on this PC are briefly interrupted during recovery.'
