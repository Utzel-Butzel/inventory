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
        return @{snapshot=@{supported=$true;jobs=@($jobs)};mapping=$mapping}
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
            foreach($ref in $command.refs){
                $current=Read-SpoolSnapshot
                if(!$initial.ContainsKey($ref) -or !$current.mapping.ContainsKey($ref)){$good=$false;continue}
                try {Remove-PrintJob -PrinterName $config.printer -ID $current.mapping[$ref].ID -ErrorAction Stop} catch {$good=$false}
            }
            if($good){$record.result='done'}
            Save-Json $path $record
        }
        $receipts+=@{id=$record.id;result=$record.result}
    }
    Get-ChildItem -LiteralPath $directory -Filter '*.json' | Where-Object {$_.LastWriteTimeUtc -lt [DateTime]::UtcNow.AddDays(-1)} | Remove-Item
    return ,$receipts
}
