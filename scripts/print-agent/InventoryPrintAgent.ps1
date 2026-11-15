param(
    [string]$ConfigPath = "$PSScriptRoot\config.json",
    [switch]$Once,
    [switch]$ValidateJournal,
    [ValidatePattern('^[a-z0-9][a-z0-9-]{0,31}$')][string]$InstanceName = 'default'
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$base = [Uri]$config.server
if ($base.Scheme -ne 'https' -or $base.UserInfo -or $base.Query -or $base.Fragment) { throw 'An HTTPS server URL is required.' }
if ($config.printer -notmatch 'P[ _-]?710BT' -or $config.token -notmatch '^iprt_[A-Za-z0-9_-]{43}$') { throw 'Invalid printer configuration.' }
# Retain the original lock for existing installations. Named instances poll
# separate server queues; Windows serializes their complete RAW print jobs.
$mutexName = 'Global\InventoryPTP710BTPrintAgent'
if ($InstanceName -ne 'default') { $mutexName += '-' + $InstanceName }
$mutex = New-Object Threading.Mutex($false, $mutexName)
if (-not $mutex.WaitOne(0)) { exit 0 }
$statePath = Join-Path (Split-Path -Parent $ConfigPath) 'pending.json'
function Save-Json($path, $state) {
    $temp = "$path.new"
    $bytes = [Text.Encoding]::UTF8.GetBytes(($state | ConvertTo-Json -Depth 5 -Compress))
    $file = [IO.File]::Open($temp, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $file.Write($bytes,0,$bytes.Length); $file.Flush($true) } finally { $file.Dispose() }
    if ([IO.File]::Exists($path)) { [IO.File]::Replace($temp,$path,[NullString]::Value) } else { [IO.File]::Move($temp,$path) }
}
function Save-State($state) { Save-Json $statePath $state }
# Exercise the durable journal without contacting the server or spooler.
if ($ValidateJournal) {
    $statePath = Join-Path (Split-Path -Parent $ConfigPath) ('journal-check-'+[Guid]::NewGuid().ToString()+'.json')
    try {
        Save-State ([pscustomobject]@{phase='claim'})
        Save-State ([pscustomobject]@{phase='submitting'})
        $saved=Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
        if ($saved.phase -ne 'submitting') { throw 'Journal replacement failed.' }
        Write-Host 'Durable journal validation passed. No print job sent.'
    } finally {
        Remove-Item -LiteralPath $statePath -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath ($statePath+'.new') -ErrorAction SilentlyContinue
        $mutex.ReleaseMutex();$mutex.Dispose()
    }
    exit 0
}
function Request-Agent($path, $body) {
    Invoke-RestMethod -Uri ($config.server.TrimEnd('/') + '/api/v1/label-print-agent/' + $path) -Method Post -Headers @{Authorization=('Bearer ' + $config.token)} -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 10 -Compress) -TimeoutSec 25
}
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class InventoryRawPrinter {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public class DocInfo {
        [MarshalAs(UnmanagedType.LPWStr)] public string name;
        [MarshalAs(UnmanagedType.LPWStr)] public string output = null;
        [MarshalAs(UnmanagedType.LPWStr)] public string type = "RAW";
    }
    [DllImport("winspool.drv", EntryPoint="OpenPrinterW", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool OpenPrinter(string name,out IntPtr printer,IntPtr defaults);
    [DllImport("winspool.drv", SetLastError=true)] static extern bool ClosePrinter(IntPtr printer);
    [DllImport("winspool.drv", EntryPoint="StartDocPrinterW", CharSet=CharSet.Unicode, SetLastError=true)] static extern int StartDocPrinter(IntPtr printer,int level,[In] DocInfo info);
    [DllImport("winspool.drv", SetLastError=true)] static extern bool EndDocPrinter(IntPtr printer);
    [DllImport("winspool.drv", SetLastError=true)] static extern bool AbortPrinter(IntPtr printer);
    [DllImport("winspool.drv", SetLastError=true)] static extern bool WritePrinter(IntPtr printer,IntPtr data,int count,out int written);
    [DllImport("winspool.drv", EntryPoint="SetJobW", SetLastError=true)] static extern bool SetJob(IntPtr printer,int id,int level,IntPtr info,int command);
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct JobInfo {
        public int id;
        [MarshalAs(UnmanagedType.LPWStr)] public string printer;
        [MarshalAs(UnmanagedType.LPWStr)] public string machine;
        [MarshalAs(UnmanagedType.LPWStr)] public string user;
        [MarshalAs(UnmanagedType.LPWStr)] public string document;
    }
    [DllImport("winspool.drv", EntryPoint="GetJobW", SetLastError=true)] static extern bool GetJob(IntPtr printer,int id,int level,IntPtr info,int size,out int needed);
    public static bool Cancel(string name,int id,string expectedTitle) { return Control(name,id,expectedTitle,5); }
    public static bool Control(string name,int id,string expectedTitle,int command) {
        if(command!=1 && command!=2 && command!=3 && command!=5) return false;
        IntPtr printer, buffer=IntPtr.Zero;
        if(id<=0 || !OpenPrinter(name,out printer,IntPtr.Zero)) return false;
        try {
            int needed; GetJob(printer,id,1,IntPtr.Zero,0,out needed);
            if(needed<Marshal.SizeOf(typeof(JobInfo)) || needed>1048576) return false;
            buffer=Marshal.AllocHGlobal(needed);
            if(!GetJob(printer,id,1,buffer,needed,out needed)) return false;
            JobInfo job=(JobInfo)Marshal.PtrToStructure(buffer,typeof(JobInfo));
            if(job.document!=expectedTitle) return false;
            return SetJob(printer,id,0,IntPtr.Zero,command);
        } finally { if(buffer!=IntPtr.Zero) Marshal.FreeHGlobal(buffer); ClosePrinter(printer); }
    }
    public static int Print(string printerName,string jobName,byte[] bytes,Func<bool> shouldStop) {
        IntPtr printer;
        if(!OpenPrinter(printerName,out printer,IntPtr.Zero)) throw new Win32Exception();
        bool started=false, ended=false;
        GCHandle pinned=default(GCHandle);
        try {
            int id=StartDocPrinter(printer,1,new DocInfo {name=jobName});
            if(id==0) throw new Win32Exception();
            started=true; pinned=GCHandle.Alloc(bytes,GCHandleType.Pinned);
            int offset=0; DateTime nextCheck=DateTime.MinValue;
            while(offset<bytes.Length) {
                if(DateTime.UtcNow>=nextCheck) {
                    if(shouldStop()) throw new OperationCanceledException();
                    nextCheck=DateTime.UtcNow.AddSeconds(1);
                }
                int written;
                if(!WritePrinter(printer,IntPtr.Add(pinned.AddrOfPinnedObject(),offset),Math.Min(16384,bytes.Length-offset),out written) || written<=0) throw new Win32Exception();
                offset+=written;
            }
            if(!EndDocPrinter(printer)) throw new Win32Exception();
            ended=true;return id;
        } finally {
            if(started&&!ended) AbortPrinter(printer);
            if(pinned.IsAllocated)pinned.Free();
            ClosePrinter(printer);
        }
    }
}
'@
$receiptDirectory = Join-Path (Split-Path -Parent $ConfigPath) 'submitted'
$null=New-Item -ItemType Directory -Force -Path $receiptDirectory
function Send-Receipt($record) {
    $body=@{id=$record.id;claimId=$record.claimId;status=$record.status;spoolJobId=$record.spoolJobId}
    if ($record.cancelResult) { $body.cancelResult=$record.cancelResult }
    $null=Request-Agent 'ack' $body
}
function Control-Job($record, $action) {
    Request-Agent 'control' @{id=$record.id;claimId=$record.claimId;action=$action}
}
. (Join-Path $PSScriptRoot 'spool-queue.ps1')
# Probe only an idle serial queue. Use a separate process so a Bluetooth Open()
# timeout cannot block the heartbeat or retain the port in the agent process.
$script:nextDeviceProbe=[DateTime]::MinValue
$script:deviceObservation=$null
function Read-SerialDeviceStatus($port) {
    $worker=$null
    try {
        $worker=Start-Job -ArgumentList $port -ScriptBlock {
            param($port)
            $serial=[System.IO.Ports.SerialPort]::new([string]$port,115200,[System.IO.Ports.Parity]::None,8,[System.IO.Ports.StopBits]::One)
            $serial.ReadTimeout=2000;$serial.WriteTimeout=2000
            try {
                $serial.Open();$serial.DiscardInBuffer()
                $serial.Write([byte[]](27,105,83),0,3)
                $bytes=New-Object byte[] 32;$offset=0
                while($offset -lt 32){$offset+=$serial.Read($bytes,$offset,32-$offset)}
                if($bytes[0] -ne 128 -or $bytes[1] -ne 32 -or $bytes[2] -ne 66){throw 'Invalid status'}
                $state='ready';$detail='none'
                if($bytes[8] -ne 0 -or $bytes[9] -ne 0){$state='error';$detail='device_error'}
                @{state=$state;detail=$detail;tape=[int]$bytes[10]}
            } catch {
                # A driver/port-open error is not evidence that the device is off.
                # In particular Windows Bluetooth ports can be listed by PnP but
                # rejected by SerialPort.Open() as an invalid serial handle.
                $cause=$_.Exception
                while($cause.InnerException){$cause=$cause.InnerException}
                if($cause -is [ArgumentException] -or $cause -is [UnauthorizedAccessException]) {
                    @{state='unknown';detail='probe_failed';tape=$null}
                } else { throw }
            } finally {$serial.Dispose()}
        }
        $done=Wait-Job $worker -Timeout 7
        if(!$done){return @{state='unreachable';detail='connection';tape=$null}}
        $result=Receive-Job $worker -ErrorAction Stop
        if(!$result){throw 'No status'}
        return $result
    } catch {return @{state='unreachable';detail='connection';tape=$null}}
    finally {if($worker){Stop-Job $worker -ErrorAction SilentlyContinue;Remove-Job $worker -Force -ErrorAction SilentlyContinue}}
}
function Update-Status {
    $deviceState='unknown';$detail='queue_only';$tape=$null
    $spool=Read-SpoolSnapshot
    try {
        $printer=Get-Printer -Name $config.printer -ErrorAction Stop
        $activeJobs=@($spool.snapshot.jobs | Where-Object {$_.state -notmatch 'Complete|Printed' -or $_.state -match 'Printing|Error|Offline|Blocked|Paused|Deleting'})
        if($activeJobs.Count){
            $script:deviceObservation=$null;$script:nextDeviceProbe=[DateTime]::MinValue
            $deviceState='busy';$detail='none'
            if([string]$printer.PrinterStatus -match 'Offline|Error|PaperOut|Paused' -or @($spool.snapshot.jobs | Where-Object {$_.state -match 'Error|Offline|Blocked|Paused'}).Count){$deviceState='error';$detail='device_error'}
        } elseif($spool.snapshot.supported -and $printer.PortName -match '^COM[0-9]+:$') {
            if([DateTime]::UtcNow -ge $script:nextDeviceProbe){
                $script:deviceObservation=Read-SerialDeviceStatus $printer.PortName.TrimEnd(':')
                $script:nextDeviceProbe=[DateTime]::UtcNow.AddSeconds(15)
            }
            if($script:deviceObservation){$deviceState=$script:deviceObservation.state;$detail=$script:deviceObservation.detail;$tape=$script:deviceObservation.tape}
        }
    } catch {$deviceState='unknown';$detail='probe_failed'}
    $response=Request-Agent 'status' @{spool=$spool.snapshot;telemetry=@{host=$env:COMPUTERNAME;transport='system';device=$config.printer;state=$deviceState;tape=$tape;detail=$detail;cancellation='spooler'}}
    if($response.recheck){$script:nextDeviceProbe=[DateTime]::MinValue}
    $spoolReceipts=Invoke-SpoolCommands $response.spoolCommands $spool.mapping
    if($spoolReceipts.Count){$null=Request-Agent 'status' @{spoolReceipts=@($spoolReceipts)}}
    $commands=@{}
    foreach ($command in $response.cancellations) { $commands[$command.id]=$command }
    foreach ($file in (Get-ChildItem -LiteralPath $receiptDirectory -Filter '*.json')) {
        $saved=Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json
        if ($saved.cancelPhase) { $commands[$saved.id]=[pscustomobject]@{id=$saved.id;claimId=$saved.claimId} }
    }
    foreach ($command in $commands.Values) {
        if ($command.id -notmatch '^[0-9a-f-]{36}$') { continue }
        $path=Join-Path $receiptDirectory ($command.id+'.json')
        $record=$null
        if (Test-Path -LiteralPath $path) { $record=Get-Content -LiteralPath $path -Raw | ConvertFrom-Json }
        if (!$record -or $record.claimId -ne $command.claimId -or (!$record.cancelPhase -and ([DateTime]::UtcNow-[DateTime]::Parse($record.savedAt).ToUniversalTime()).TotalMinutes -gt 10)) {
            Send-Receipt ([pscustomobject]@{id=$command.id;claimId=$command.claimId;status='uncertain';spoolJobId=$null;cancelResult='uncertain'})
            continue
        }
        if ($record.cancelPhase -eq 'stopping') { $record.cancelPhase='receipt';$record.status='uncertain';$record.cancelResult='uncertain' }
        if (!$record.cancelPhase) {
            $record.cancelPhase='stopping';Save-Json $path $record
            $record.cancelResult='uncertain'
            if ([InventoryRawPrinter]::Cancel($config.printer,$record.spoolJobId,('Inventory '+$record.id))) { $record.cancelResult='stopped' }
            $record.status='uncertain';$record.cancelPhase='receipt'
        }
        Save-Json $path $record
        Send-Receipt $record
        if ($script:state -and $script:state.id -eq $record.id -and $script:state.phase -eq 'receipt') {
            Remove-Item -LiteralPath $statePath -ErrorAction SilentlyContinue
            $script:state=$null
        }
        Remove-Item -LiteralPath $path
    }
    Get-ChildItem -LiteralPath $receiptDirectory -Filter '*.json' | Where-Object { $_.LastWriteTimeUtc -lt [DateTime]::UtcNow.AddMinutes(-15) -and !(Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json).cancelPhase } | Remove-Item
}
try {
    $state = $null
    if (Test-Path -LiteralPath $statePath) {
        $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
        if (!$state.PSObject.Properties['cancelResult']) { $state | Add-Member -NotePropertyName cancelResult -NotePropertyValue $null }
        # A crash after the write started must never result in automatic replay.
        if ($state.phase -eq 'submitting') { $state.phase='receipt';$state.status='uncertain';Save-State $state }
    }
    do {
        try {
            Update-Status
            if ($null -eq $state) {
                $state = [pscustomobject]@{phase='claim';claimId=[Guid]::NewGuid().ToString();id=$null;status=$null;spoolJobId=$null;cancelResult=$null}
                Save-State $state
            }
            if ($state.phase -eq 'claim') {
                $response = Request-Agent 'claim' @{claimId=$state.claimId;version=2}
                if ($null -eq $response.job) {
                    Remove-Item -LiteralPath $statePath -ErrorAction SilentlyContinue
                    $state=$null
                } else {
                    $job=$response.job
                    $data=[Convert]::FromBase64String($job.data)
                    $sha=[Security.Cryptography.SHA256]::Create()
                    try { $hash=([BitConverter]::ToString($sha.ComputeHash($data))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
                    $state.id=$job.id
                    if ($data.Length -gt 4000000 -or $data.Length -lt 200 -or $hash -ne $job.sha256 -or $job.id -notmatch '^[0-9a-f-]{36}$') {
                        $state.phase='receipt';$state.status='failed';Save-State $state
                    } else {
                        $permission=Control-Job $state 'start'
                        if (!$permission.mayPrint) {
                            $state.status='uncertain'
                            if ($permission.status -eq 'cancelled') { $state.status='cancelled';$state.cancelResult='cancelled' }
                        } else {
                            # Durable marker precedes any call into the spooler.
                            $state.phase='submitting';Save-State $state
                            try {
                                $shouldStop=[Func[bool]]{
                                    try { return [bool](Control-Job $state 'check').cancel } catch { return $false }
                                }
                                $state.spoolJobId=[InventoryRawPrinter]::Print($config.printer,('Inventory '+$job.id),$data,$shouldStop)
                                $state.status='submitted'
                            } catch { $state.status='uncertain' }
                        }
                        $state.phase='receipt';Save-State $state
                    }
                }
            }
            if ($null -ne $state -and $state.phase -eq 'receipt') {
                if ($state.status -eq 'submitted' -and $state.spoolJobId) {
                    $record=[pscustomobject]@{id=$state.id;claimId=$state.claimId;status=$state.status;spoolJobId=$state.spoolJobId;savedAt=[DateTime]::UtcNow.ToString('o');cancelPhase=$null;cancelResult=$null}
                    Save-Json (Join-Path $receiptDirectory ($state.id+'.json')) $record
                }
                Send-Receipt $state
                Remove-Item -LiteralPath $statePath
                $state=$null
            }
        } catch {
            # Retry transport/receipts, never physical printing. Do not log tokens or label data.
            if ($null -ne $state -and $state.phase -eq 'submitting') { $state.phase='receipt';$state.status='uncertain' }
            $message=($_.Exception.Message).Replace($config.token,'[redacted]')
            $diagnostic=([DateTime]::Now.ToString('s')+' '+$_.Exception.GetType().FullName+': '+$message)
            Write-Warning $diagnostic
            try { [IO.File]::WriteAllText((Join-Path (Split-Path -Parent $ConfigPath) 'last-error.txt'),$diagnostic) } catch {}
        }
        if (-not $Once) { Start-Sleep -Seconds 3 }
    } while (-not $Once)
} finally { $mutex.ReleaseMutex();$mutex.Dispose() }
