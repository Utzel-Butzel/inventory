import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import time
import sys
sys.path.insert(0, str(Path(__file__).parents[1] / "scripts/print-agent"))
import spool_queue
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('agent', Path(__file__).parents[1] / 'scripts/print-agent/inventory_print_agent.py')
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)
CONFIG = {'server':'https://inventory.example','token':'iprt_'+'A'*43,'printer':'Office Printer','kind':'system'}
DATA = b'%PDF-1.7\nTest only'
REAL_PROBE = agent.probe_printer
JOB = {'id':'ac53fa28-e167-47c0-bcbc-581e30554899','format':'pdf','data':base64.b64encode(DATA).decode(),'sha256':hashlib.sha256(DATA).hexdigest(),'pageWidthMm':210,'pageHeightMm':297}

class AgentTests(unittest.TestCase):
    def setUp(self):
        spool = patch.object(spool_queue, "snapshot", return_value=({"supported": False, "jobs": []}, {}))
        spool.start()
        self.addCleanup(spool.stop)
        probe = patch.object(agent, 'probe_printer', return_value={'host':'Test','device':'Test','transport':'system','state':'unknown','tape':None,'detail':'queue_only','cancellation':'spooler'})
        probe.start()
        self.addCleanup(probe.stop)

    def test_bluetooth_config_requires_local_helper_and_ptouch(self):
        config = {**CONFIG, 'kind':'ptouch', 'bluetoothAddress':'B4:22:00:EC:AE:9D', 'bluetoothHelper':'/tmp/helper'}
        self.assertEqual(agent.validate_config(config)['kind'], 'ptouch')
        for change in [{'kind':'system'}, {'bluetoothAddress':'--other-device'}, {'bluetoothHelper':'relative-helper'}, {'bluetoothHelper':None}]:
            with self.assertRaises(ValueError): agent.validate_config({**config, **change})

    @patch.object(agent.sys, 'platform', 'darwin')
    def test_bluetooth_destination_cannot_be_overridden_by_remote_job(self):
        with tempfile.NamedTemporaryFile() as helper:
            Path(helper.name).chmod(0o700)
            config=agent.validate_config({**CONFIG, 'kind':'ptouch', 'bluetoothAddress':'B4:22:00:EC:AE:9D', 'bluetoothHelper':helper.name})
            job={**JOB, 'bluetoothAddress':'other-device', 'bluetoothHelper':'/bin/false'}
            self.assertEqual(agent.system_command(config,job,Path('/tmp/label.bin'),platform='posix'),
                             [helper.name,config['bluetoothAddress'],'print','/tmp/label.bin'])
            with self.assertRaises(ValueError): agent.system_command(config,job,Path('/tmp/label.bin'),platform='nt')

    def test_payload_validation(self):
        self.assertEqual(agent.validate_job(CONFIG, JOB), DATA)
        for change in [{'format':'ptouch'}, {'sha256':'bad'}, {'pageWidthMm':float('nan')}, {'data':'%bad'}]:
            with self.assertRaises(Exception): agent.validate_job(CONFIG, {**JOB, **change})
        for change in [{'server':'http://inventory.example'},{'server':'https://user@inventory.example'}, {'printer':'-evil'}, {'kind':'shell'}]:
            with self.assertRaises(ValueError): agent.validate_config({**CONFIG,**change})

    @patch.object(agent.shutil, 'which', return_value='/usr/bin/lp')
    def test_command_uses_local_destination_and_exact_scale(self, _):
        command = agent.system_command(CONFIG, JOB, Path('/tmp/test.pdf'), platform='posix')
        self.assertEqual(command[1:3], ['-d','Office Printer'])
        self.assertIn('media=Custom.210x297mm',command)
        self.assertIn('print-scaling=none',command)
        with tempfile.NamedTemporaryFile() as executable:
            command=agent.system_command({**CONFIG,'pdfPrinter':executable.name},JOB,Path('/tmp/test.pdf'),platform='nt')
        self.assertIn('noscale,disable-auto-rotation,simplex,paper=210mm x 297mm',command)

    @patch.object(agent.shutil, 'which', return_value='/usr/bin/lp')
    def test_lost_receipt_never_reprints(self, _):
        calls=[]; receipts=[]
        def request(config, endpoint, body):
            if endpoint=='status': return {}
            if endpoint=='control': return {'mayPrint':True}
            if endpoint=='claim': return {'job':JOB}
            receipts.append(body)
            if len(receipts)==1: raise TimeoutError()
            return {'ok':True}
        with tempfile.TemporaryDirectory() as temp:
            queue=agent.QueueAgent(CONFIG,Path(temp),request,lambda *args: calls.append('printed') or 42)
            with self.assertRaises(TimeoutError): queue.tick()
            self.assertEqual(json.loads(queue.path.read_text())['phase'],'receipt')
            queue.tick()
            self.assertEqual(calls,['printed'])
            self.assertEqual(receipts[-1]['status'],'submitted')
            self.assertEqual(receipts[-1]['spoolJobId'],42)
            self.assertFalse(queue.path.exists())

    def test_crash_during_submission_becomes_uncertain(self):
        receipts=[]
        with tempfile.TemporaryDirectory() as temp:
            queue=agent.QueueAgent(CONFIG,Path(temp),lambda c,e,b: (receipts.append(b) or {}) if e=='ack' else {},lambda *args: self.fail('must not print'))
            agent.save_state(queue.path,{'phase':'submitting','id':JOB['id'],'claimId':JOB['id'],'spoolJobId':None})
            queue.tick()
            self.assertEqual(receipts[0]['status'],'uncertain')

    @patch.object(agent.shutil, 'which', return_value='/usr/bin/lp')
    def test_lost_claim_reuses_same_id_and_invalid_data_never_prints(self, _):
        claims=[]; receipts=[]
        def request(c,e,b):
            if e=='status': return {}
            if e=='control': return {'mayPrint':True}
            if e=='claim':
                claims.append(b['claimId'])
                if len(claims)==1: raise TimeoutError()
                return {'job':{**JOB,'sha256':'wrong'}}
            receipts.append(b); return {}
        with tempfile.TemporaryDirectory() as temp:
            queue=agent.QueueAgent(CONFIG,Path(temp),request,lambda *args:self.fail('must not print'))
            with self.assertRaises(TimeoutError): queue.tick()
            queue.tick()
        self.assertEqual(claims[0],claims[1]); self.assertEqual(receipts[0]['status'],'failed')

    def test_cancellation_before_start_never_submits(self):
        receipts=[]
        def request(c,e,b):
            if e=='claim': return {'job':JOB}
            if e=='control': return {'mayPrint':False,'cancel':True,'status':'cancelled'}
            if e=='ack': receipts.append(b)
            return {}
        with tempfile.TemporaryDirectory() as temp, patch.object(agent.shutil,'which',return_value='/usr/bin/lp'):
            queue=agent.QueueAgent(CONFIG,Path(temp),request,lambda *args:self.fail('cancelled job must not print'))
            queue.tick()
        self.assertEqual(receipts[-1]['status'],'cancelled')

    def test_lost_start_response_never_authorizes_duplicate_transfer(self):
        starts=[]; receipts=[]
        def request(c,e,b):
            if e=='claim': return {'job':JOB}
            if e=='control':
                starts.append(b)
                if len(starts)==1: raise TimeoutError()
                return {'mayPrint':False,'status':'claimed'}
            if e=='ack': receipts.append(b)
            return {}
        with tempfile.TemporaryDirectory() as temp, patch.object(agent.shutil,'which',return_value='/usr/bin/lp'):
            queue=agent.QueueAgent(CONFIG,Path(temp),request,lambda *args:self.fail('ambiguous authorization must not print'))
            with self.assertRaises(TimeoutError): queue.tick()
            queue.tick()
        self.assertEqual(receipts[-1]['status'],'uncertain')

    def test_cancel_during_transfer_signals_worker_without_retry(self):
        receipts=[]; calls=[]
        def request(c,e,b):
            if e=='claim': return {'job':JOB}
            if e=='control': return {'mayPrint':b['action']=='start','cancel':b['action']=='check','status':'claimed'}
            if e=='ack': receipts.append(b)
            return {}
        def submit(c,j,d,p,stop):
            calls.append('transfer')
            if not stop.wait(3): self.fail('worker did not receive stop')
            raise InterruptedError()
        with tempfile.TemporaryDirectory() as temp, patch.object(agent.shutil,'which',return_value='/usr/bin/lp'):
            agent.QueueAgent(CONFIG,Path(temp),request,submit).tick()
        self.assertEqual(calls,['transfer'])
        self.assertEqual(receipts[-1]['status'],'uncertain')
        self.assertEqual(receipts[-1]['cancelResult'],'uncertain')

    def test_cancel_receipt_retries_without_repeating_spool_operation(self):
        receipts=[]; cancels=[]; server_finished=False
        def request(c,e,b):
            nonlocal server_finished
            if e=='status': return {'cancellations':[] if server_finished else [{'id':JOB['id'],'claimId':JOB['id']}]}
            if e=='claim': return {'job':None}
            if e=='ack':
                receipts.append(b)
                server_finished=True
                if len(receipts)==1: raise TimeoutError()
            return {}
        with tempfile.TemporaryDirectory() as temp:
            queue=agent.QueueAgent(CONFIG,Path(temp),request,cancel=lambda c,j,i:cancels.append(j) or 'stopped')
            record={'id':JOB['id'],'claimId':JOB['id'],'status':'submitted','spoolJobId':42,'savedAt':time.time()}
            agent.save_state(queue.tracked_path,{JOB['id']:record})
            agent.save_state(queue.path,{**record,'phase':'receipt'})
            with self.assertRaises(TimeoutError): queue.tick()
            queue.tick()
            self.assertFalse(queue.path.exists())
        self.assertEqual(cancels,[42])
        self.assertEqual(len(receipts),2)
        self.assertEqual(receipts[-1]['cancelResult'],'stopped')

    def test_server_cannot_choose_arbitrary_spool_job(self):
        receipts=[]
        def request(c,e,b):
            if e=='status': return {'cancellations':[{'id':JOB['id'],'claimId':JOB['id'],'spoolJobId':666}]}
            if e=='claim': return {'job':None}
            if e=='ack': receipts.append(b)
            return {}
        with tempfile.TemporaryDirectory() as temp:
            agent.QueueAgent(CONFIG,Path(temp),request,cancel=lambda *args:self.fail('no local receipt')).tick()
        self.assertEqual(receipts[-1]['cancelResult'],'uncertain')

    def test_cups_cancellation_targets_only_the_recorded_job(self):
        with patch.object(agent.os,'name','posix'), patch.object(agent,'cups_job_matches',return_value=True) as matches, patch.object(agent.subprocess,'run') as run:
            run.return_value.returncode=0
            self.assertEqual(agent.cancel_spooled(CONFIG,42,JOB['id']),'stopped')
            self.assertEqual(run.call_args.args[0],['cancel','Office Printer-42'])
            matches.assert_called_once_with(CONFIG,42,'Inventory '+JOB['id'])
            run.reset_mock()
            matches.return_value=False
            self.assertEqual(agent.cancel_spooled(CONFIG,42,JOB['id']),'uncertain')
            run.assert_not_called()
            self.assertEqual(agent.cancel_spooled(CONFIG,None,JOB['id']),'unsupported')
            run.assert_not_called()

    def test_bluetooth_probe_reports_device_errors_and_tape(self):
        config={**CONFIG,'kind':'ptouch','bluetoothAddress':'AA:BB:CC:DD:EE:FF','bluetoothHelper':'/test/helper'}
        with tempfile.TemporaryFile() as lock, patch.object(agent,'bluetooth_lock',return_value=lock), patch.object(agent.subprocess,'run') as run:
            run.return_value=agent.subprocess.CompletedProcess([],0,'Device: PT-P710BT123 paired=1\nStatus: tape=24 mm media=1 errors=00/00 type=0','')
            ready=REAL_PROBE(config)
            self.assertEqual(ready['state'],'ready');self.assertEqual(ready['tape'],24)
        with tempfile.TemporaryFile() as lock, patch.object(agent,'bluetooth_lock',return_value=lock), patch.object(agent.subprocess,'run') as run:
            run.return_value=agent.subprocess.CompletedProcess([],0,'Status: tape=0 mm media=1 errors=01/00 type=0','')
            self.assertEqual(REAL_PROBE(config)['state'],'error')
        with tempfile.TemporaryFile() as lock, patch.object(agent,'bluetooth_lock',return_value=lock), patch.object(agent.subprocess,'run') as run:
            run.return_value=agent.subprocess.CompletedProcess([],1,'','Connect failed')
            self.assertEqual(REAL_PROBE(config)['state'],'unreachable')

    def test_only_one_process_can_own_queue(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'queue.lock'
            with agent.lock_queue(path):
                with self.assertRaises(RuntimeError): agent.lock_queue(path)


class SpoolTests(unittest.TestCase):
    def test_snapshot_refs_detect_reused_ids(self):
        row={'id':12,'title':'Original','owner':'alice','stamp':'1','state':'pending'}
        with patch.object(spool_queue,'cups_jobs',return_value=[row]):
            first,mapping=spool_queue.snapshot(CONFIG)
        with patch.object(spool_queue,'cups_jobs',return_value=[{**row,'stamp':'2'}]):
            second,_=spool_queue.snapshot(CONFIG)
        self.assertNotEqual(first['jobs'][0]['ref'],second['jobs'][0]['ref'])
        command={'id':'test-command','refs':list(mapping)}
        with tempfile.TemporaryDirectory() as temp, patch.object(spool_queue,'snapshot',return_value=(second,{})), patch.object(spool_queue,'remove_job') as remove:
            result=spool_queue.process_commands(CONFIG,temp,[command],mapping,agent.save_state)
            self.assertEqual(result[0]['result'],'uncertain')
            remove.assert_not_called()

    def test_cancellation_is_durable_and_does_not_purge_new_jobs(self):
        row={'id':12,'title':'Original','owner':'alice','stamp':'1','state':'pending'}
        command={'id':'test-command','refs':['original']}
        with tempfile.TemporaryDirectory() as temp, patch.object(spool_queue,'snapshot',return_value=({}, {'original':row,'new':{**row,'id':13}})), patch.object(spool_queue,'remove_job') as remove:
            for _ in range(2):
                result=spool_queue.process_commands(CONFIG,temp,[command],{'original':row},agent.save_state)
                self.assertEqual(result[0]['result'],'done')
            remove.assert_called_once_with(CONFIG,row)

    def test_native_bluetooth_has_no_os_queue(self):
        with patch.object(spool_queue,'cups_jobs') as read:
            self.assertFalse(spool_queue.snapshot({**CONFIG,'bluetoothAddress':'00:11:22:33:44:55'})[0]['supported'])
            read.assert_not_called()

if __name__=='__main__': unittest.main()
