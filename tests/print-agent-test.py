import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('agent', Path(__file__).parents[1] / 'scripts/print-agent/inventory_print_agent.py')
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)
CONFIG = {'server':'https://inventory.example','token':'iprt_'+'A'*43,'printer':'Office Printer','kind':'system'}
DATA = b'%PDF-1.7\nTest only'
JOB = {'id':'ac53fa28-e167-47c0-bcbc-581e30554899','format':'pdf','data':base64.b64encode(DATA).decode(),'sha256':hashlib.sha256(DATA).hexdigest(),'pageWidthMm':210,'pageHeightMm':297}

class AgentTests(unittest.TestCase):
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
            queue=agent.QueueAgent(CONFIG,Path(temp),lambda c,e,b: receipts.append(b) or {},lambda *args: self.fail('must not print'))
            agent.save_state(queue.path,{'phase':'submitting','id':JOB['id'],'claimId':JOB['id'],'spoolJobId':None})
            queue.tick()
            self.assertEqual(receipts[0]['status'],'uncertain')

    @patch.object(agent.shutil, 'which', return_value='/usr/bin/lp')
    def test_lost_claim_reuses_same_id_and_invalid_data_never_prints(self, _):
        claims=[]; receipts=[]
        def request(c,e,b):
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

    def test_only_one_process_can_own_queue(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'queue.lock'
            with agent.lock_queue(path):
                with self.assertRaises(RuntimeError): agent.lock_queue(path)

if __name__=='__main__': unittest.main()
