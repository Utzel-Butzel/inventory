"""OS queue administration. Opaque snapshot refs prevent acting on reused job IDs."""
import ctypes
import ctypes.util
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time


def windows_jobs(config):
    script = "@(Get-PrintJob -PrinterName $env:INVENTORY_QUEUE -ErrorAction Stop | Select-Object ID,DocumentName,UserName,JobStatus,@{n='Submitted';e={$_.SubmittedTime.ToUniversalTime().ToString('o')}}) | ConvertTo-Json -Compress"
    result = subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-Command',script],env={**os.environ,'INVENTORY_QUEUE':config['printer']},capture_output=True,text=True,check=True,timeout=10)
    rows=json.loads(result.stdout or '[]')
    return [{'id':int(r['ID']),'title':r.get('DocumentName') or '', 'owner':r.get('UserName') or '', 'state':str(r.get('JobStatus') or ''),'stamp':r.get('Submitted') or ''} for r in (rows if isinstance(rows,list) else [rows])]


def cups_jobs(config):
    class Job(ctypes.Structure):
        _fields_=[('id',ctypes.c_int),('dest',ctypes.c_char_p),('title',ctypes.c_char_p),('user',ctypes.c_char_p),('format',ctypes.c_char_p),('state',ctypes.c_int),('size',ctypes.c_int),('priority',ctypes.c_int),('completed',ctypes.c_long),('created',ctypes.c_long),('processing',ctypes.c_long)]
    cups=ctypes.CDLL(ctypes.util.find_library('cups'))
    ptr=ctypes.POINTER(Job)()
    cups.cupsGetJobs.argtypes=[ctypes.POINTER(ctypes.POINTER(Job)),ctypes.c_char_p,ctypes.c_int,ctypes.c_int]
    cups.cupsGetJobs.restype=ctypes.c_int
    cups.cupsFreeJobs.argtypes=[ctypes.c_int,ctypes.POINTER(Job)]
    count=cups.cupsGetJobs(ctypes.byref(ptr),config['printer'].encode(),0,0)
    if count<0: raise RuntimeError('Queue unavailable')
    try:
        return [{'id':ptr[i].id,'title':(ptr[i].title or b'').decode(errors='replace'),'owner':(ptr[i].user or b'').decode(errors='replace'),'state':{3:'pending',4:'held',5:'processing',6:'stopped'}.get(ptr[i].state,str(ptr[i].state)),'stamp':str(ptr[i].created)} for i in range(min(count,201))]
    finally:
        if count>0: cups.cupsFreeJobs(count,ptr)


def snapshot(config):
    if config.get('bluetoothAddress'): return {'supported':False,'jobs':[]},{}
    try:
        rows=windows_jobs(config) if os.name=='nt' else cups_jobs(config)
        if len(rows)>200: return {'supported':False,'jobs':[]},{}
        mapping={hashlib.sha256(json.dumps([config['printer'],r['id'],r['title'],r['owner'],r['stamp']],ensure_ascii=True).encode()).hexdigest():r for r in rows}
        jobs=[{'ref':ref,'id':r['id'],'title':r['title'][:240],'owner':r['owner'][:120],'state':r['state'][:80]} for ref,r in mapping.items()]
        return {'supported':True,'jobs':jobs},mapping
    except Exception:
        return {'supported':False,'jobs':[]},{}


def remove_job(config, row):
    if os.name=='nt':
        # Recheck document and timestamp inside the same PowerShell invocation.
        script="$j=Get-PrintJob -PrinterName $env:INVENTORY_QUEUE -ID ([int]$env:INVENTORY_JOB) -ErrorAction Stop; if($j.DocumentName -ne $env:INVENTORY_TITLE -or $j.SubmittedTime.ToUniversalTime().ToString('o') -ne $env:INVENTORY_STAMP){throw 'Queue changed'}; Remove-PrintJob -PrinterName $env:INVENTORY_QUEUE -ID $j.ID -ErrorAction Stop"
        subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-Command',script],env={**os.environ,'INVENTORY_QUEUE':config['printer'],'INVENTORY_JOB':str(row['id']),'INVENTORY_TITLE':row['title'],'INVENTORY_STAMP':row['stamp']},check=True,capture_output=True,timeout=10)
    else:
        subprocess.run(['cancel',f"{config['printer']}-{row['id']}"],check=True,capture_output=True,timeout=10)


def process_commands(config,directory,commands,mapping,save_state):
    path=Path(directory)/'spool-commands.json'
    journal=json.loads(path.read_text()) if path.exists() else {}
    journal={k:v for k,v in journal.items() if time.time()-v['at']<86400}
    results=[]
    for command in commands:
        key=command['id']
        if key not in journal:
            journal[key]={'at':time.time(),'result':'uncertain'}
            save_state(path,journal)  # Durable before any destructive OS call.
            good=True
            for ref in command['refs']:
                # Fresh enumeration before each removal, never a blanket OS purge.
                _,current=snapshot(config)
                if ref not in mapping or ref not in current:
                    good=False
                    continue
                try:
                    if command.get('action', 'cancel') != 'cancel': raise RuntimeError('Unsupported operation')
                    remove_job(config,current[ref])
                except Exception: good=False
            journal[key]['result']='done' if good else 'uncertain'
            save_state(path,journal)
        results.append({'id':key,'result':journal[key]['result']})
    return results
