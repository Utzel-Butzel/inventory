param([string]$ConfigPath = "$PSScriptRoot\config.json", [switch]$Once)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$base = [Uri]$config.server
if ($base.Scheme -ne 'https' -or $base.UserInfo -or $base.Query -or $base.Fragment) { throw 'An HTTPS server URL is required.' }
if ($config.printer -notmatch 'P[ _-]?710BT' -or $config.token -notmatch '^iprt_[A-Za-z0-9_-]{43}$') { throw 'Invalid printer configuration.' }
$mutex = New-Object Threading.Mutex($false, 'Global\InventoryPTP710BTPrintAgent')
if (-not $mutex.WaitOne(0)) { exit 0 }
$statePath = Join-Path (Split-Path -Parent $ConfigPath) 'pending.json'
function Save-State($state) {
    $temp = "$statePath.new"
    $bytes = [Text.Encoding]::UTF8.GetBytes(($state | ConvertTo-Json -Depth 5 -Compress))
    $file = [IO.File]::Open($temp, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $file.Write($bytes,0,$bytes.Length); $file.Flush($true) } finally { $file.Dispose() }
    if ([IO.File]::Exists($statePath)) { [IO.File]::Replace($temp,$statePath,$null) } else { [IO.File]::Move($temp,$statePath) }
}
function Request-Agent($path, $body) {
    Invoke-RestMethod -Uri ($config.server.TrimEnd('/') + '/api/v1/label-print-agent/' + $path) -Method Post -Headers @{Authorization=('Bearer ' + $config.token)} -ContentType 'application/json' -Body ($body | ConvertTo-Json -Compress) -TimeoutSec 25
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
    public static int Print(string printerName,string jobName,byte[] bytes) {
        IntPtr printer;
        if(!OpenPrinter(printerName,out printer,IntPtr.Zero)) throw new Win32Exception();
        bool started=false, ended=false;
        GCHandle pinned=default(GCHandle);
        try {
            int id=StartDocPrinter(printer,1,new DocInfo {name=jobName});
            if(id==0) throw new Win32Exception();
            started=true; pinned=GCHandle.Alloc(bytes,GCHandleType.Pinned);
            int offset=0;
            while(offset<bytes.Length) {
                int written;
                if(!WritePrinter(printer,IntPtr.Add(pinned.AddrOfPinnedObject(),offset),bytes.Length-offset,out written) || written<=0) throw new Win32Exception();
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
try {
    $state = $null
    if (Test-Path -LiteralPath $statePath) {
        $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
        # A crash after the write started must never result in automatic replay.
        if ($state.phase -eq 'submitting') { $state.phase='receipt';$state.status='uncertain';Save-State $state }
    }
    do {
        try {
            if ($null -eq $state) {
                $state = [pscustomobject]@{phase='claim';claimId=[Guid]::NewGuid().ToString();id=$null;status=$null;spoolJobId=$null}
                Save-State $state
            }
            if ($state.phase -eq 'claim') {
                $response = Request-Agent 'claim' @{claimId=$state.claimId}
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
                        # Durable marker precedes any call into the spooler.
                        $state.phase='submitting';Save-State $state
                        try {
                            $state.spoolJobId=[InventoryRawPrinter]::Print($config.printer,('Inventory '+$job.id),$data)
                            $state.status='submitted'
                        } catch { $state.status='uncertain' }
                        $state.phase='receipt';Save-State $state
                    }
                }
            }
            if ($null -ne $state -and $state.phase -eq 'receipt') {
                $null=Request-Agent 'ack' @{id=$state.id;claimId=$state.claimId;status=$state.status;spoolJobId=$state.spoolJobId}
                Remove-Item -LiteralPath $statePath
                $state=$null
            }
        } catch {
            # Retry transport/receipts, never physical printing. Do not log tokens or label data.
            Write-Warning ('Print server unavailable at '+[DateTime]::Now.ToString('s'))
        }
        if (-not $Once) { Start-Sleep -Seconds 3 }
    } while (-not $Once)
} finally { $mutex.ReleaseMutex();$mutex.Dispose() }
