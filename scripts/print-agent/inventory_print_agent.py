#!/usr/bin/env python3
"""Inventory print agent. Python 3.10+, no third-party Python dependencies.

CUPS on macOS/Linux; SumatraPDF for Windows PDF jobs; Winspool for P-touch.
No shell commands, destinations or executable paths are accepted from jobs.
"""
import argparse
import base64
import concurrent.futures
import ctypes
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
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
    with urllib.request.build_opener(NoRedirect).open(req, timeout=25) as response:
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


def winspool_raw(printer_name, data):
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
        job_id = api.StartDocPrinterW(handle, 1, ctypes.byref(DocInfo("Inventory labels", None, "RAW")))
        if not job_id:
            raise ctypes.WinError(ctypes.get_last_error())
        started = True
        buffer = ctypes.create_string_buffer(data)
        offset = 0
        while offset < len(data):
            written = w.DWORD()
            if not api.WritePrinter(handle, ctypes.byref(buffer, offset), len(data) - offset, ctypes.byref(written)) or not written.value:
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


def submit_job(config, job, data, directory):
    if config["kind"] == "ptouch" and os.name == "nt":
        return winspool_raw(config["printer"], data)
    with tempfile.TemporaryDirectory(prefix="job-", dir=directory) as temp:
        path = Path(temp) / ("label.pdf" if config["kind"] == "system" else "label.bin")
        path.write_bytes(data)
        command = system_command(config, job, path)
        # A non-zero exit or timeout can occur after spooling: caller records uncertain.
        result = subprocess.run(command, check=True, capture_output=True, text=True, timeout=120)
        if os.name != "nt":
            match = re.search(r"-(\d+)\s", result.stdout)
            if match:
                return int(match.group(1))
        return None


class QueueAgent:
    def __init__(self, config, directory, request=request_agent, submit=submit_job):
        self.config = validate_config(config)
        self.directory = directory
        self.directory.mkdir(parents=True, exist_ok=True)
        self.path = directory / "pending.json"
        self.request, self.submit = request, submit

    def tick(self):
        state = json.loads(self.path.read_text()) if self.path.exists() else None
        if state is None:
            state = {"phase": "claim", "claimId": str(uuid.uuid4()), "id": None, "spoolJobId": None}
            save_state(self.path, state)
        if state["phase"] == "submitting":
            # Crash recovery must never repeat a call to the physical print system.
            state.update(phase="receipt", status="uncertain")
            save_state(self.path, state)
        if state["phase"] == "claim":
            job = self.request(self.config, "claim", {"claimId": state["claimId"], "formats": ["pdf" if self.config["kind"] == "system" else "ptouch"]}).get("job")
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
                state["phase"] = "submitting"
                save_state(self.path, state)  # durable BEFORE touching the spooler
                try:
                    state["spoolJobId"] = self.submit(self.config, job, data, self.directory)
                    state["status"] = "submitted"
                except Exception:
                    state["status"] = "uncertain"
                state["phase"] = "receipt"
                save_state(self.path, state)
        if state["phase"] == "receipt":
            self.request(self.config, "ack", {key: state[key] for key in ("id", "claimId", "status", "spoolJobId")})
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
