function Read-SpoolSnapshot {
    try {
        $rows=@(Get-PrintJob -PrinterName $config.printer -ErrorAction Stop)
        if($rows.Count -gt 200){ throw 'Queue too large' }
        $jobs=@();$mapping=@{}
        foreach($row in $rows){
            $stamp=$row.SubmittedTime.ToUniversalTime().ToString('o')
            $identity=@($config.printer,$row.ID,$row.DocumentName,$row.UserName,$stamp) | ConvertTo-Json -Compress
            $sha=[Security.Cryptography.SHA256]::Create()
            try {$ref=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($identity)))).Replace('-','').ToLowerInvariant()} finally {$sha.Dispose()}
            $mapping[$ref]=$row
            $title=[string]$row.DocumentName;$owner=[string]$row.UserName
            $jobs+=@{ref=$ref;id=[int]$row.ID;title=$title.Substring(0,[Math]::Min(240,$title.Length));owner=$owner.Substring(0,[Math]::Min(120,$owner.Length));state=[string]$row.JobStatus}
        }
        $actions=@('cancel','pause','resume','restart')
        if($config.recoveryTask -eq 'Inventory Printer Recovery'){$actions+=@('repair')}
        return @{snapshot=@{supported=$true;actions=$actions;jobs=@($jobs)};mapping=$mapping}
    } catch { return @{snapshot=@{supported=$false;jobs=@()};mapping=@{}} }
}
function Invoke-SpoolCommands($commands,$initial) {
    $directory=Join-Path (Split-Path -Parent $ConfigPath) 'spool-commands'
    $null=New-Item -ItemType Directory -Force -Path $directory
    $receipts=@()
    foreach($command in $commands){
        if($command.id -notmatch '^[0-9a-f-]{36}$'){continue}
        $path=Join-Path $directory ($command.id+'.json')
        if(Test-Path -LiteralPath $path){$record=Get-Content -LiteralPath $path -Raw | ConvertFrom-Json}
        else {
            $record=@{id=$command.id;result='uncertain'}
            Save-Json $path $record
            $good=$true
            $action='cancel';if($command.action){$action=[string]$command.action}
            if($action -notin @('cancel','pause','resume','restart','repair')){$receipts+=@{id=$command.id;result='uncertain'};continue}
            if($action -eq 'repair'){
                try {
                    if($config.recoveryTask -ne 'Inventory Printer Recovery' -or $command.refs.Count){throw 'Recovery unavailable'}
                    $requestedAt=Get-Date
                    & schtasks.exe /Run /TN 'Inventory Printer Recovery' | Out-Null
                    if($LASTEXITCODE -ne 0){throw 'Recovery denied'}
                    $verified=$false
                    for($i=0;$i -lt 10;$i++){
                        Start-Sleep -Seconds 1
                        $info=Get-ScheduledTaskInfo -TaskName 'Inventory Printer Recovery' -ErrorAction Stop
                        if($info.LastRunTime -ge $requestedAt.AddSeconds(-1) -and $info.LastTaskResult -eq 0){$verified=$true;break}
                    }
                    if(!$verified){throw 'Recovery not confirmed'}
                    $script:nextDeviceProbe=[DateTime]::MinValue
                } catch {$record.reason='recovery_not_confirmed';$good=$false}
            }
            foreach($ref in $command.refs){
                $current=Read-SpoolSnapshot
                if(!$initial.ContainsKey($ref) -or !$current.mapping.ContainsKey($ref)){$record.reason='identity_missing';$good=$false;continue}
                try {
                    switch($action){
                        'cancel' {Remove-PrintJob -PrinterName $config.printer -ID $current.mapping[$ref].ID -ErrorAction Stop}
                        'pause' {Suspend-PrintJob -PrinterName $config.printer -ID $current.mapping[$ref].ID -ErrorAction Stop}
                        'resume' {Resume-PrintJob -PrinterName $config.printer -ID $current.mapping[$ref].ID -ErrorAction Stop}
                        'restart' {Restart-PrintJob -PrinterName $config.printer -ID $current.mapping[$ref].ID -ErrorAction Stop}
                    }
                } catch {
                    # The CIM print provider can deny LOCAL SERVICE even for its own jobs.
                    # Use the same spooler API as printing, with unchanged process rights
                    # and a second document identity check before requesting deletion.
                    if(![InventoryRawPrinter]::Control($config.printer,[int]$current.mapping[$ref].ID,[string]$current.mapping[$ref].DocumentName,@{cancel=5;pause=1;resume=2;restart=3}[$action])){
                        $record.reason='native_cancel_failed';$good=$false
                    }
                }
            }
            if($good){$record.result='done'}
            Save-Json $path $record
        }
        $receipts+=@{id=$record.id;result=$record.result}
    }
    Get-ChildItem -LiteralPath $directory -Filter '*.json' | Where-Object {$_.LastWriteTimeUtc -lt [DateTime]::UtcNow.AddDays(-1)} | Remove-Item
    return ,$receipts
}
