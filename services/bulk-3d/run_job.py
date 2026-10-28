"""Small supervisor: serial GPU access, a hard deadline, and durable job state."""
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import time


def state(directory, value):
    temporary = directory / "state.tmp"
    temporary.write_text(json.dumps(value))
    temporary.replace(directory / "state.json")


def run(directory, lock_file):
    request = json.loads((directory / "request.json").read_text())
    deadline = request["deadline"] / 1000
    lock_file.parent.mkdir(parents=True, exist_ok=True)
    try:
        with lock_file.open("a") as lock:
            while True:
                if time.time() >= deadline:
                    raise subprocess.TimeoutExpired("GPU queue", 600)
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    time.sleep(1)
            state(directory, {"status": "loading"})
            worker = Path(__file__).with_name("worker.py")
            completed = subprocess.run([sys.executable, str(worker), str(directory)],
                                       timeout=max(1, deadline - time.time()), check=False)
            current = json.loads((directory / "state.json").read_text())
            if completed.returncode != 0 or current.get("status") != "completed":
                state(directory, {"status": "failed", "code": "analysisFailed"})
    except subprocess.TimeoutExpired:
        state(directory, {"status": "failed", "code": "timeout"})
    except Exception:
        state(directory, {"status": "failed", "code": "analysisFailed"})
        raise
    finally:
        # Original uploads are no longer needed after the inference attempt.
        for image in directory.glob("image-*.jpg"):
            image.unlink(missing_ok=True)


if __name__ == "__main__":
    os.umask(0o077)
    run(Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve())
