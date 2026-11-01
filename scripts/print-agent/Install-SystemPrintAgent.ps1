# Install the general agent for the signed-in user (no elevation required).
param(
    [string]$Source = $PSScriptRoot,
    [string]$PythonExe = '',
    [string]$PdfPrinter = ''
)
$ErrorActionPreference = 'Stop'
if (!$PythonExe) { $PythonExe = (Get-Command pythonw.exe -ErrorAction Stop).Source }
if (!(Test-Path -LiteralPath $PythonExe -PathType Leaf)) { throw 'Supply an absolute Python 3.10+ pythonw.exe path.' }
$target = Join-Path $env:LOCALAPPDATA 'InventoryPrintAgent'
$null = New-Item -ItemType Directory -Path $target -Force
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true, $false)
foreach ($sid in @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value, 'S-1-5-18', 'S-1-5-32-544')) {
    $identity = New-Object Security.Principal.SecurityIdentifier($sid)
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $target -AclObject $acl
$config = Get-Content -LiteralPath (Join-Path $Source 'config.json') -Raw | ConvertFrom-Json
$queues = if ($config.printers) { @($config.printers) } else { @($config) }
foreach ($queue in $queues) {
    $null = Get-Printer -Name $queue.printer -ErrorAction Stop
    if ($queue.kind -eq 'system') {
        $executable = if ($PdfPrinter) { $PdfPrinter } else { $queue.pdfPrinter }
        if (!$executable -or !(Test-Path -LiteralPath $executable -PathType Leaf)) { throw 'Supply -PdfPrinter with the absolute SumatraPDF.exe path.' }
        $queue | Add-Member -NotePropertyName pdfPrinter -NotePropertyValue $executable -Force
    }
}
Copy-Item -LiteralPath (Join-Path $Source 'inventory_print_agent.py') -Destination $target -Force
$config | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $target 'config.json') -Encoding UTF8
$arguments = '"' + $target + '\inventory_print_agent.py" --config "' + $target + '\config.json" --state-dir "' + $target + '\state"'
$action = New-ScheduledTaskAction -Execute $PythonExe -Argument $arguments
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$null = Register-ScheduledTask -TaskName 'Inventory Print Agent' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force
Start-ScheduledTask -TaskName 'Inventory Print Agent'
Write-Host 'Installed for the current user. This user must remain signed in. Verify printer status in Inventory.'
