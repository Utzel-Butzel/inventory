#!/usr/bin/env python3
"""Install a named Inventory agent for the current macOS user. No sudo required.

python3 install_macos.py --config config.json --name paperlesspaper
Install the updated server first. The agent can consume waiting print jobs.
"""
import argparse
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("--name", required=True)
    args = parser.parse_args()
    if sys.platform != "darwin" or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,31}", args.name):
        parser.error("Use macOS and a name containing lowercase letters, numbers and hyphens")
    from inventory_print_agent import validate_config
    os.umask(0o077)
    source = Path(__file__).resolve().parent
    directory = Path.home() / "Library/Application Support" / ("InventoryPrintAgent-" + args.name)
    configuration = json.loads(Path(args.config).read_text())
    configs = configuration.get("printers", [configuration])
    if not 1 <= len(configs) <= 20:
        raise ValueError("Configure 1 to 20 printers")
    for config in configs:
        if config.get("bluetoothAddress"):
            config["bluetoothHelper"] = str(directory / "inventory-ptouch-bluetooth")
        validate_config(config)
    # Refuse to kill an active transfer or lose an unacknowledged journal.
    if any((directory / "state").glob("*/pending.json")):
        raise RuntimeError("Agent has a pending journal. Let it finish before updating; do not delete the journal.")
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    directory.chmod(0o700)
    label = "de.paperlesspaper.inventory-print-agent." + args.name
    plist = Path.home() / "Library/LaunchAgents" / (label + ".plist")
    target = f"gui/{os.getuid()}/{label}"
    # Compile before touching an existing working installation.
    if any(c.get("bluetoothAddress") for c in configs):
        subprocess.run(["clang", "-fobjc-arc", "-fblocks", "-framework", "Foundation", "-framework", "IOBluetooth",
                        str(source / "macos_ptouch_bluetooth.m"), "-o", str(directory / "inventory-ptouch-bluetooth.new")], check=True)
    subprocess.run(["launchctl", "bootout", target], capture_output=True)
    if any((directory / "state").glob("*/pending.json")):
        # A claim raced the first check. Preserve it for crash recovery.
        subprocess.run(["launchctl", "bootstrap", f"gui/{os.getuid()}", str(plist)], capture_output=True)
        raise RuntimeError("A job arrived during update. Retry after it finishes.")
    if (directory / "inventory-ptouch-bluetooth.new").exists():
        (directory / "inventory-ptouch-bluetooth.new").replace(directory / "inventory-ptouch-bluetooth")
    shutil.copy2(source / "inventory_print_agent.py", directory / "inventory_print_agent.py")
    shutil.copy2(source / "spool_queue.py", directory / "spool_queue.py")
    config_path = directory / "config.json"
    config_path.write_text(json.dumps({"printers": configs}, indent=2) + "\n")
    config_path.chmod(0o600)
    plist.parent.mkdir(parents=True, exist_ok=True)
    plist.write_bytes(plistlib.dumps({
        "Label": label,
        "ProgramArguments": [sys.executable, str(directory / "inventory_print_agent.py"), "--config", str(config_path), "--state-dir", str(directory / "state")],
        "WorkingDirectory": str(directory), "RunAtLoad": True, "KeepAlive": True, "ThrottleInterval": 10,
        "StandardOutPath": str(directory / "agent.log"), "StandardErrorPath": str(directory / "agent-error.log"),
    }))
    subprocess.run(["launchctl", "bootstrap", f"gui/{os.getuid()}", str(plist)], check=True)
    print(f"Installed {label}. Check printer status in Inventory; no test print was requested.")


if __name__ == "__main__":
    main()
