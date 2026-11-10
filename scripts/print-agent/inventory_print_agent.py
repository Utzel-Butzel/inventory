#!/usr/bin/env python3
"""Inventory print agent. Python 3.10+, no third-party Python dependencies.

CUPS on macOS/Linux; SumatraPDF for Windows PDF jobs; Winspool for P-touch.
No shell commands, destinations or executable paths are accepted from jobs.
"""
import argparse
import base64
import concurrent.futures
import ctypes
import ctypes.util
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import socket
import time
import tempfile
import threading
import urllib.parse
import urllib.request
import uuid

MAX_BYTES = 24 * 1024 * 1024


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Agent endpoint must not redirect")


def validate_config(config):
    url = urllib.parse.urlsplit(config.get("server", ""))
    if url.scheme != "https" or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise ValueError("A plain HTTPS server URL is required")
    if not re.fullmatch(r"iprt_[A-Za-z0-9_-]{43}", config.get("token", "")):
        raise ValueError("Invalid agent token")
    name = config.get("printer", "")
    if not name or len(name) > 200 or name.startswith("-") or any(ord(c) < 32 for c in name):
        raise ValueError("Invalid local printer name")
    kind = config.get("kind", "ptouch")
    if kind not in ("ptouch", "system"):
        raise ValueError("Invalid printer kind")
    # Local administrator settings only, never supplied by a remote job.
    paper = config.get("paper")
    if paper is not None and (not isinstance(paper, str) or not re.fullmatch(r"[\w .x-]{1,100}", paper)):
        raise ValueError("Invalid paper name")
    address, helper = config.get("bluetoothAddress"), config.get("bluetoothHelper")
    if address is not None or helper is not None:
        if kind != "ptouch" or not isinstance(address, str) or not re.fullmatch(r"[0-9A-Fa-f]{2}(?:[:-][0-9A-Fa-f]{2}){5}", address):
            raise ValueError("Bluetooth requires a P-touch printer and a device address")
        if not isinstance(helper, str) or not Path(helper).is_absolute():
            raise ValueError("bluetoothHelper must be an absolute local executable path")
    return {**config, "kind": kind}


def save_state(path, state):
    temporary = path.with_suffix(".new")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(state, stream)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    if os.name != "nt":
        fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def lock_queue(path):
    stream = path.open("a+b")
    try:
        if os.name == "nt":
            import msvcrt
            stream.seek(0)
            stream.write(b"0")
            stream.flush()
            stream.seek(0)
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return stream
    except Exception:
        stream.close()
        raise RuntimeError("Another agent already owns this printer queue") from None


def request_agent(config, endpoint, body):
    req = urllib.request.Request(config["server"].rstrip("/") + "/api/v1/label-print-agent/" + endpoint,
                                 data=json.dumps(body).encode(), method="POST",
                                 headers={"Authorization": "Bearer " + config["token"], "Content-Type": "application/json"})
    with urllib.request.build_opener(NoRedirect).open(req, timeout=5 if endpoint == "control" else 25) as response:
        data = response.read(MAX_BYTES * 4 // 3 + 8193)
        if len(data) > MAX_BYTES * 4 // 3 + 8192:
            raise ValueError("Agent response is too large")
        return json.loads(data)


def validate_job(config, job):
    uuid.UUID(job["id"])
    expected = "pdf" if config["kind"] == "system" else "ptouch"
    if job.get("format", "ptouch") != expected:
        raise ValueError("Job format does not match the local adapter")
    data = base64.b64decode(job["data"], validate=True)
    if not 1 <= len(data) <= (MAX_BYTES if expected == "pdf" else 4_000_000):
        raise ValueError("Invalid job size")
    if hashlib.sha256(data).hexdigest() != job["sha256"]:
        raise ValueError("Job checksum mismatch")
    if expected == "pdf":
        if not data.startswith(b"%PDF-"):
            raise ValueError("Invalid PDF header")
        for key in ("pageWidthMm", "pageHeightMm"):
            value = job.get(key)
            if not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 < value <= 1000:
                raise ValueError("Invalid paper dimensions")
    return data


def system_command(config, job, path, platform=None):
    windows = (platform or os.name) == "nt"
    if config.get("bluetoothAddress"):
        executable = config["bluetoothHelper"]
        if windows or sys.platform != "darwin":
            raise ValueError("Native Bluetooth printing requires macOS")
        if not Path(executable).is_file() or not os.access(executable, os.X_OK):
            raise ValueError("Build and install the macOS P-touch Bluetooth helper")
        return [executable, config["bluetoothAddress"], "print", str(path)]
    if windows:
        executable = config.get("pdfPrinter") or shutil.which("SumatraPDF.exe")
        if not executable or not Path(executable).is_file():
            raise ValueError("Install SumatraPDF and set pdfPrinter to its absolute executable path")
        paper = config.get("paper") or f"{job['pageWidthMm']:g}mm x {job['pageHeightMm']:g}mm"
        return [str(executable), "-silent", "-print-to", config["printer"], "-print-settings",
                "noscale,disable-auto-rotation,simplex,paper=" + paper, str(path)]
    executable = shutil.which("lp")
    if not executable:
        raise ValueError("CUPS lp is required")
    command = [executable, "-d", config["printer"], "-t", "Inventory " + job["id"]]
    if config["kind"] == "ptouch":
        return command + ["-o", "raw", str(path)]
    paper = config.get("paper") or f"Custom.{job['pageWidthMm']:g}x{job['pageHeightMm']:g}mm"
    return command + ["-o", "media=" + paper, "-o", "print-scaling=none", "-o", "fit-to-page=false", "-o", "sides=one-sided", str(path)]


def winspool_raw(printer_name, data, stop=None, job_name="Inventory labels"):
    from ctypes import wintypes as w
    class DocInfo(ctypes.Structure):
        _fields_ = [("name", w.LPWSTR), ("output", w.LPWSTR), ("datatype", w.LPWSTR)]
    api = ctypes.WinDLL("winspool.drv", use_last_error=True)
    api.OpenPrinterW.argtypes = [w.LPWSTR, ctypes.POINTER(w.HANDLE), ctypes.c_void_p]
    api.OpenPrinterW.restype = w.BOOL
    api.StartDocPrinterW.argtypes = [w.HANDLE, w.DWORD, ctypes.POINTER(DocInfo)]
    api.StartDocPrinterW.restype = w.DWORD
    api.WritePrinter.argtypes = [w.HANDLE, ctypes.c_void_p, w.DWORD, ctypes.POINTER(w.DWORD)]
    api.WritePrinter.restype = w.BOOL
    for name in ("EndDocPrinter", "ClosePrinter", "AbortPrinter"):
        getattr(api, name).argtypes = [w.HANDLE]
        getattr(api, name).restype = w.BOOL
    handle = w.HANDLE()
    if not api.OpenPrinterW(printer_name, ctypes.byref(handle), None):
        raise ctypes.WinError(ctypes.get_last_error())
    started = False
    try:
        job_id = api.StartDocPrinterW(handle, 1, ctypes.byref(DocInfo(job_name, None, "RAW")))
        if not job_id:
            raise ctypes.WinError(ctypes.get_last_error())
        started = True
        buffer = ctypes.create_string_buffer(data)
        offset = 0
        while offset < len(data):
            if stop is not None and stop.is_set():
                raise InterruptedError("Print transfer stopped; inspect output")
            written = w.DWORD()
            if not api.WritePrinter(handle, ctypes.byref(buffer, offset), min(16384, len(data) - offset), ctypes.byref(written)) or not written.value:
                raise ctypes.WinError(ctypes.get_last_error())
            offset += written.value
        if not api.EndDocPrinter(handle):
            raise ctypes.WinError(ctypes.get_last_error())
        started = False
        return job_id
    finally:
        if started:
            api.AbortPrinter(handle)
        api.ClosePrinter(handle)


def submit_job(config, job, data, directory, stop=None):
    if config["kind"] == "ptouch" and os.name == "nt":
        return winspool_raw(config["printer"], data, stop, "Inventory " + job["id"])
    with tempfile.TemporaryDirectory(prefix="job-", dir=directory) as temp:
        path = Path(temp) / ("label.pdf" if config["kind"] == "system" else "label.bin")
        path.write_bytes(data)
        command = system_command(config, job, path)
        # A non-zero exit or timeout can occur after spooling: caller records uncertain.
        transport_lock = None
        if config.get("bluetoothAddress"):
            transport_lock = bluetooth_lock(config)
        try:
            with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) as process:
                deadline = time.monotonic() + 120
                while True:
                    try:
                        stdout, stderr = process.communicate(timeout=0.5)
                        if process.returncode:
                            raise RuntimeError("Print transport failed; inspect output")
                        result = subprocess.CompletedProcess(command, process.returncode, stdout, stderr)
                        break
                    except subprocess.TimeoutExpired:
                        if (stop is not None and stop.is_set()) or time.monotonic() > deadline:
                            process.terminate()
                            try:
                                process.communicate(timeout=3)
                            except subprocess.TimeoutExpired:
                                process.kill()
                                process.communicate()
                            raise InterruptedError("Transfer stopped; buffered output may still print")
        finally:
            if transport_lock is not None:
                transport_lock.close()
        if os.name != "nt" and not config.get("bluetoothAddress"):
            match = re.search(r"-(\d+)\s", result.stdout)
            if match:
                return int(match.group(1))
        return None


def bluetooth_lock(config):
    # Shared across server registrations on this Mac: probes must not steal an
    # active RFCOMM connection from another queue using the same physical device.
    directory = Path.home() / ".inventory-print-transports"
    directory.mkdir(mode=0o700, exist_ok=True)
    key = hashlib.sha256(config["bluetoothAddress"].lower().replace("-", ":").encode()).hexdigest()
    return lock_queue(directory / (key + ".lock"))


def probe_printer(config):
    status = {"host": socket.gethostname()[:120] or "Computer", "transport": "bluetooth" if config.get("bluetoothAddress") else "system",
              "device": config["printer"], "state": "unknown", "tape": None, "detail": "queue_only",
              "cancellation": "transfer" if config.get("bluetoothAddress") else "spooler" if config["kind"] == "ptouch" or os.name != "nt" else "process"}
    try:
        if config.get("bluetoothAddress"):
            try:
                transport_lock = bluetooth_lock(config)
            except RuntimeError:
                return {**status, "state": "busy", "detail": "none"}
            with transport_lock:
                result = subprocess.run([config["bluetoothHelper"], config["bluetoothAddress"], "status"], capture_output=True, text=True, timeout=35)
            device = re.search(r"Device: (.+) paired=", result.stdout)
            if device:
                status["device"] = device.group(1)[:200]
            match = re.search(r"Status: tape=(\d+) mm media=\d+ errors=([0-9a-fA-F]{2})/([0-9a-fA-F]{2})", result.stdout)
            if match and result.returncode == 0:
                tape = int(match[1])
                return {**status, "state": "error" if int(match[2], 16) or int(match[3], 16) else "ready",
                        "tape": 3.5 if tape == 4 else tape, "detail": "device_error" if int(match[2], 16) or int(match[3], 16) else "none"}
            return {**status, "state": "unreachable", "detail": "connection"}
        if os.name == "nt":
            # A clean Windows queue is not evidence of a working Bluetooth link.
            result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
                                     "$p=Get-Printer -Name $env:INVENTORY_QUEUE -ErrorAction Stop; [string]$p.PrinterStatus"],
                                    env={**os.environ, "INVENTORY_QUEUE": config["printer"]}, capture_output=True, text=True, timeout=10)
            if result.returncode or any(word in result.stdout.lower() for word in ("offline", "error", "paperout", "paused")):
                status.update(state="error", detail="device_error")
        else:
            result = subprocess.run(["lpstat", "-p", config["printer"]], env={**os.environ, "LC_ALL": "C"}, capture_output=True, text=True, timeout=10)
            if result.returncode or "disabled" in result.stdout.lower():
                status.update(state="error", detail="device_error")
    except Exception:
        status.update(state="unknown", detail="probe_failed")
    return status


def cups_job_matches(config, spool_id, expected_title):
    # cups_job_t layout from the CUPS public header, not the alphabetized docs.
    class Job(ctypes.Structure):
        _fields_ = [("id", ctypes.c_int), ("dest", ctypes.c_char_p), ("title", ctypes.c_char_p),
                    ("user", ctypes.c_char_p), ("format", ctypes.c_char_p), ("state", ctypes.c_int),
                    ("size", ctypes.c_int), ("priority", ctypes.c_int), ("completed", ctypes.c_long),
                    ("created", ctypes.c_long), ("processing", ctypes.c_long)]
    library = ctypes.util.find_library("cups")
    if not library:
        return False
    cups = ctypes.CDLL(library)
    pointer = ctypes.POINTER(Job)()
    cups.cupsGetJobs.argtypes = [ctypes.POINTER(ctypes.POINTER(Job)), ctypes.c_char_p, ctypes.c_int, ctypes.c_int]
    cups.cupsGetJobs.restype = ctypes.c_int
    cups.cupsFreeJobs.argtypes = [ctypes.c_int, ctypes.POINTER(Job)]
    count = cups.cupsGetJobs(ctypes.byref(pointer), config["printer"].encode(), 1, 0)
    try:
        return 0 < count < 100000 and any(pointer[i].id == spool_id and pointer[i].title == expected_title.encode() for i in range(count))
    finally:
        if count > 0:
            cups.cupsFreeJobs(count, pointer)


def cancel_spooled(config, spool_id, job_id):
    # spool_id is read exclusively from our durable local journal, never a command
    # or queue name supplied by the server. Even success cannot retract printed pages.
    if not isinstance(spool_id, int) or spool_id <= 0:
        return "unsupported"
    expected_title = "Inventory " + job_id
    if os.name == "nt":
        from ctypes import wintypes as w
        class JobInfo(ctypes.Structure):
            _fields_ = [("id", w.DWORD), ("printer", w.LPWSTR), ("machine", w.LPWSTR), ("user", w.LPWSTR), ("document", w.LPWSTR)]
        api = ctypes.WinDLL("winspool.drv", use_last_error=True)
        api.GetJobW.argtypes = [w.HANDLE, w.DWORD, w.DWORD, ctypes.c_void_p, w.DWORD, ctypes.POINTER(w.DWORD)]
        api.GetJobW.restype = w.BOOL
        api.OpenPrinterW.argtypes = [w.LPWSTR, ctypes.POINTER(w.HANDLE), ctypes.c_void_p]
        api.OpenPrinterW.restype = w.BOOL
        api.SetJobW.argtypes = [w.HANDLE, w.DWORD, w.DWORD, ctypes.c_void_p, w.DWORD]
        api.SetJobW.restype = w.BOOL
        api.ClosePrinter.argtypes = [w.HANDLE]
        handle = w.HANDLE()
        if not api.OpenPrinterW(config["printer"], ctypes.byref(handle), None):
            return "uncertain"
        try:
            needed = w.DWORD()
            api.GetJobW(handle, spool_id, 1, None, 0, ctypes.byref(needed))
            if not ctypes.sizeof(JobInfo) <= needed.value <= 1024 * 1024:
                return "uncertain"
            buffer = ctypes.create_string_buffer(needed.value)
            if not api.GetJobW(handle, spool_id, 1, buffer, needed.value, ctypes.byref(needed)) or ctypes.cast(buffer, ctypes.POINTER(JobInfo)).contents.document != expected_title:
                return "uncertain"
            return "stopped" if api.SetJobW(handle, spool_id, 0, None, 5) else "uncertain"
        finally:
            api.ClosePrinter(handle)
    if not cups_job_matches(config, spool_id, expected_title):
        return "uncertain"
    result = subprocess.run(["cancel", f"{config['printer']}-{spool_id}"], capture_output=True, timeout=10)
    return "stopped" if result.returncode == 0 else "uncertain"


class QueueAgent:
    def __init__(self, config, directory, request=request_agent, submit=submit_job, probe=None, cancel=cancel_spooled):
        self.config = validate_config(config)
        self.directory = directory
        self.directory.mkdir(parents=True, exist_ok=True)
        self.path = directory / "pending.json"
        self.tracked_path = directory / "submitted.json"
        self.request, self.submit, self.probe, self.cancel = request, submit, probe or probe_printer, cancel
        self.last_probe = 0
        self.telemetry = None

    def receipt(self, state):
        body = {key: state.get(key) for key in ("id", "claimId", "status", "spoolJobId")}
        if state.get("cancelResult"):
            body["cancelResult"] = state["cancelResult"]
        self.request(self.config, "ack", body)

    def heartbeat(self):
        from spool_queue import snapshot, process_commands
        spool, mapping = snapshot(self.config)
        response = self.request(self.config, "status", {"spool": spool})
        receipts = process_commands(self.config, self.directory, response.get("spoolCommands", []), mapping, save_state)
        if receipts:
            self.request(self.config, "status", {"spoolReceipts": receipts})
        if response.get("recheck") or time.monotonic() - self.last_probe > 20:
            self.telemetry = self.probe(self.config)
            response = self.request(self.config, "status", {"telemetry": self.telemetry})
            self.last_probe = time.monotonic()
        tracked = json.loads(self.tracked_path.read_text()) if self.tracked_path.exists() else {}
        tracked = {key: value for key, value in tracked.items() if value.get("cancelPhase") or time.time() - value["savedAt"] < 600}
        commands = {command["id"]: command for command in response.get("cancellations", [])}
        for key, value in tracked.items():
            if value.get("cancelPhase"):
                commands[key] = {"id": key, "claimId": value["claimId"]}
        for command in commands.values():
            record = tracked.get(command["id"])
            if not record or record["claimId"] != command["claimId"]:
                # No matching local receipt: never cancel someone else's spool job.
                self.receipt({**command, "status": "uncertain", "spoolJobId": None, "cancelResult": "uncertain"})
                continue
            if record.get("cancelPhase") == "stopping":
                record.update(cancelPhase="receipt", status="uncertain", cancelResult="uncertain")
            if not record.get("cancelPhase"):
                record["cancelPhase"] = "stopping"
                save_state(self.tracked_path, tracked)
                try:
                    result = self.cancel(self.config, record["spoolJobId"], record["id"])
                except Exception:
                    result = "uncertain"
                record.update(cancelPhase="receipt", status="uncertain", cancelResult=result)
            save_state(self.tracked_path, tracked)
            self.receipt(record)
            if self.path.exists():
                pending = json.loads(self.path.read_text())
                if pending.get("id") == record["id"] and pending.get("phase") == "receipt":
                    self.path.unlink()
            del tracked[command["id"]]
        save_state(self.tracked_path, tracked)

    def control(self, state, action):
        return self.request(self.config, "control", {"id": state["id"], "claimId": state["claimId"], "action": action})

    def dispatch(self, state, job, data):
        stop = threading.Event()
        if self.telemetry:
            self.request(self.config, "status", {"telemetry": {**self.telemetry, "state": "busy", "tape": None}})
        # Keep cancellation responsive during a slow Bluetooth write or PDF process.
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(self.submit, self.config, job, data, self.directory, stop)
            while not future.done():
                try:
                    result = self.control(state, "check")
                    if result.get("cancel"):
                        stop.set()
                    self.request(self.config, "status", {})
                except Exception:
                    # A lost control connection must not trigger a duplicate submission.
                    pass
                try:
                    future.result(timeout=1)
                except concurrent.futures.TimeoutError:
                    continue
                except Exception:
                    break
            try:
                state["spoolJobId"] = future.result()
                state["status"] = "completed" if self.config.get("bluetoothAddress") else "submitted"
            except Exception:
                state["status"] = "uncertain"
            if stop.is_set():
                state["cancelResult"] = "too_late" if state["status"] == "completed" else "uncertain"
                if state.get("spoolJobId"):
                    try:
                        state["cancelResult"] = self.cancel(self.config, state["spoolJobId"], state["id"])
                    except Exception:
                        state["cancelResult"] = "uncertain"
                    state["status"] = "uncertain"
        # Device observations made before printing no longer describe current state.
        self.last_probe = 0
        try:
            if self.telemetry:
                self.request(self.config, "status", {"telemetry": {**self.telemetry, "state": "unknown", "tape": None}})
        except Exception:
            pass

    def tick(self):
        self.heartbeat()
        state = json.loads(self.path.read_text()) if self.path.exists() else None
        if state is None:
            # Do not consume jobs while a device is known to be unavailable.
            if self.telemetry and self.telemetry["state"] in ("unreachable", "error", "busy"):
                return
            state = {"phase": "claim", "claimId": str(uuid.uuid4()), "id": None, "spoolJobId": None}
            save_state(self.path, state)
        if state["phase"] == "submitting":
            state.update(phase="receipt", status="uncertain")
            save_state(self.path, state)
        if state["phase"] == "claim":
            job = self.request(self.config, "claim", {"claimId": state["claimId"], "version": 2, "formats": ["pdf" if self.config["kind"] == "system" else "ptouch"]}).get("job")
            if job is None:
                self.path.unlink()
                return
            state["id"] = job["id"]
            try:
                data = validate_job(self.config, job)
                if not (self.config["kind"] == "ptouch" and os.name == "nt"):
                    system_command(self.config, job, Path("preflight.pdf"))
            except Exception:
                state.update(phase="receipt", status="failed")
                save_state(self.path, state)
            else:
                # Server-side row lock resolves cancellation racing with dispatch.
                permission = self.control(state, "start")
                if not permission.get("mayPrint"):
                    state.update(phase="receipt", status="cancelled" if permission.get("status") == "cancelled" else "uncertain")
                    if state["status"] == "cancelled":
                        state["cancelResult"] = "cancelled"
                else:
                    state["phase"] = "submitting"
                    save_state(self.path, state)
                    self.dispatch(state, job, data)
                    state["phase"] = "receipt"
                save_state(self.path, state)
        if state["phase"] == "receipt":
            if state.get("spoolJobId") and state["status"] == "submitted":
                tracked = json.loads(self.tracked_path.read_text()) if self.tracked_path.exists() else {}
                tracked[state["id"]] = {**state, "savedAt": time.time()}
                save_state(self.tracked_path, tracked)
            self.receipt(state)
            self.path.unlink()


def run_queue(config, directory, stop, once):
    agent = QueueAgent(config, directory)
    with lock_queue(directory / "queue.lock"):
        while not stop.is_set():
            try:
                agent.tick()
            except Exception as error:
                # Do not log payloads, credentials or subprocess arguments.
                print(f"{config['printer']}: {type(error).__name__}; check configuration/network and queue", file=sys.stderr)
                if once:
                    raise
            if once:
                return
            stop.wait(3)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", action="append", default=[])
    parser.add_argument("--state-dir", default=str(Path.home() / ".inventory-print-agent"))
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--list-printers", action="store_true")
    args = parser.parse_args()
    if args.list_printers:
        if os.name == "nt":
            subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "Get-Printer | Select-Object Name,DriverName,PortName | Format-Table -AutoSize"], check=True)
        else:
            subprocess.run(["lpstat", "-p", "-d"], check=True)
        return
    if os.name != "nt":
        os.umask(0o077)
    configs = []
    for filename in args.config or ["config.json"]:
        value = json.loads(Path(filename).read_text(encoding="utf-8-sig"))
        configs.extend(value.get("printers", [value]))
    configs = [validate_config(config) for config in configs]
    if not 1 <= len(configs) <= 20:
        raise ValueError("Configure 1 to 20 printers")
    keys = [hashlib.sha256((c["server"].rstrip("/") + "\n" + c["printer"]).encode()).hexdigest()[:24] for c in configs]
    if len(set(keys)) != len(keys):
        raise ValueError("Duplicate printer configuration")
    stop = threading.Event()
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(configs)) as executor:
        futures = [executor.submit(run_queue, config, Path(args.state_dir).resolve() / key, stop, args.once) for config, key in zip(configs, keys)]
        try:
            for future in concurrent.futures.as_completed(futures):
                future.result()
        except BaseException:
            stop.set()
            raise


if __name__ == "__main__":
    main()
