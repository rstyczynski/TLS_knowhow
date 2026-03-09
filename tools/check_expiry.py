#!/usr/bin/env python3
from pathlib import Path
from datetime import datetime, timezone
import argparse
import subprocess
import sys

parser = argparse.ArgumentParser(description="List certs by expiry and alert on threshold.")
parser.add_argument("--path", default=".", help="Root directory to scan")
parser.add_argument("--days", type=int, default=365, help="Alert threshold in days")
args = parser.parse_args()

root = Path(args.path).resolve()
patterns = ("*.pem", "*.crt", "*.cer")
files = []
for p in patterns:
    files.extend(root.rglob(p))

now = datetime.now(timezone.utc)
rows = []

for f in sorted(set(files)):
    try:
        end = subprocess.check_output(
            ["openssl", "x509", "-in", str(f), "-noout", "-enddate"],
            stderr=subprocess.DEVNULL, text=True
        ).strip()
        subj = subprocess.check_output(
            ["openssl", "x509", "-in", str(f), "-noout", "-subject"],
            stderr=subprocess.DEVNULL, text=True
        ).strip()
    except subprocess.CalledProcessError:
        continue

    if not end.startswith("notAfter="):
        continue

    dt = datetime.strptime(end.split("=", 1)[1], "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)
    days = (dt - now).days
    status = "ALERT" if days < args.days else "OK"
    rows.append((dt, days, status, str(f), subj.replace("subject=", "").strip()))

rows.sort(key=lambda r: r[0])

print(f"SCAN_ROOT={root}")
print(f"THRESHOLD_DAYS={args.days}")
print(f"TOTAL_CERTS={len(rows)}")
for dt, days, status, path, subj in rows:
    print(f"{dt.isoformat()} | {days:4d}d | {status} | {path} | {subj}")

alerts = [r for r in rows if r[2] == "ALERT"]
if alerts:
    print(f"ALERT_COUNT={len(alerts)}")
    sys.exit(2)

print("ALERT_COUNT=0")
sys.exit(0)
