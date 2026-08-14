#!/usr/bin/env python3
"""Build the committable CI DuckDB fixture (ADR-12 / SAD-OQ-6).

The practice database is ~151 MB, which exceeds GitHub's 100 MB per-file hard
limit. Nearly all of that weight is `events` (6.5M rows) and `sessions` (1.4M),
neither of which the MVP tool surface reads. Copying only the five MVP-read
tables — with every row intact — yields a ~3.2 MB file.

Full rows are deliberate. A row-subset fixture would have to be regenerated
whenever a demo persona or eval script referenced a new id, and the temporal
measurements recorded in the SAD (shiftDays=584, 79 active memberships) would
need separate CI expectations. Copying whole tables keeps the fixture a faithful
sample-free replica, so any query that holds locally holds in CI.

Content-deterministic: same source in, same rows and checksums out. The bytes are
not reproducible — DuckDB stamps internal metadata on each write — so rebuilding
produces a 3.2 MB binary diff even when nothing changed. Rebuild only when the
practice database changes; use --check to verify the committed fixture otherwise.

Writes to a temp file and atomically replaces the target (aamad-core: State and
Output).

Usage:
    python3 scripts/build-ci-fixture.py [--source PATH] [--out PATH] [--check]

    --check   verify an existing fixture against the source instead of building

Source resolution order: --source, $NOVAMART_DUCKDB_PATH, then the default
fixture path below.
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
from pathlib import Path

try:
    import duckdb
except ImportError:  # pragma: no cover - dependency guidance
    sys.exit("duckdb is required: pip install duckdb")

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = REPO_ROOT / "data" / "fixtures" / "novamart_practice.duckdb"
DEFAULT_OUT = REPO_ROOT / "data" / "fixtures" / "novamart_ci.duckdb"

# The MVP tool surface, per SAD §4 "Data architecture". `support_tickets` is
# excluded on purpose: only its category enum is used, and only in code.
MVP_TABLES = ("users", "orders", "order_items", "products", "memberships")

# Cheap, order-independent aggregates used to prove the copy is faithful.
CHECKS = {
    "users": "select count(*), sum(user_id) from users",
    "orders": "select count(*), sum(order_id) from orders",
    "order_items": "select count(*), sum(line_total)::decimal(18,2) from order_items",
    "products": "select count(*), sum(product_id) from products",
    "memberships": "select count(*), sum(membership_id) from memberships",
}

GITHUB_WARN_BYTES = 50 * 1024 * 1024
GITHUB_LIMIT_BYTES = 100 * 1024 * 1024


def resolve_source(explicit: str | None) -> Path:
    for candidate in (explicit, os.environ.get("NOVAMART_DUCKDB_PATH"), DEFAULT_SOURCE):
        if candidate:
            path = Path(candidate).expanduser()
            if path.exists():
                return path
    sys.exit(
        "practice database not found. Pass --source, set NOVAMART_DUCKDB_PATH, "
        f"or place it at {DEFAULT_SOURCE}"
    )


def fingerprint(con: duckdb.DuckDBPyConnection, prefix: str = "") -> dict[str, tuple]:
    return {
        table: con.execute(sql.replace(f"from {table}", f"from {prefix}{table}")).fetchone()
        for table, sql in CHECKS.items()
    }


def build(source: Path, out: Path) -> Path:
    out.parent.mkdir(parents=True, exist_ok=True)

    fd, tmp_name = tempfile.mkstemp(suffix=".duckdb", dir=out.parent)
    os.close(fd)
    tmp = Path(tmp_name)
    tmp.unlink()  # DuckDB wants to create the file itself

    con = duckdb.connect(str(tmp))
    try:
        con.execute(f"attach '{source}' as src (read_only)")
        for table in MVP_TABLES:
            con.execute(f"create table {table} as select * from src.{table}")
        con.execute("detach src")
        con.execute("checkpoint")
    finally:
        con.close()

    os.replace(tmp, out)
    return out


def verify(source: Path, out: Path) -> bool:
    src = duckdb.connect(str(source), read_only=True)
    fix = duckdb.connect(str(out), read_only=True)  # also proves read-only open works
    try:
        expected = fingerprint(src)
        actual = fingerprint(fix)
    finally:
        src.close()
        fix.close()

    ok = True
    print(f"\n{'table':<14}{'rows':>10}{'checksum':>18}   match")
    for table in MVP_TABLES:
        rows, checksum = actual[table]
        match = actual[table] == expected[table]
        ok &= match
        print(f"{table:<14}{rows:>10,}{str(checksum):>18}   {'yes' if match else 'NO'}")

    size = out.stat().st_size
    print(f"\nfixture: {out.relative_to(REPO_ROOT)}  {size / 1e6:.1f} MB")
    if size >= GITHUB_LIMIT_BYTES:
        print("FAIL: exceeds GitHub's 100 MB hard limit")
        ok = False
    elif size >= GITHUB_WARN_BYTES:
        print("WARN: over GitHub's 50 MB soft warning")
    return ok


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", help="path to novamart_practice.duckdb")
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="fixture output path")
    parser.add_argument(
        "--check", action="store_true", help="verify an existing fixture; do not rebuild"
    )
    args = parser.parse_args()

    source = resolve_source(args.source)
    out = Path(args.out).expanduser()
    print(f"source:  {source}")

    if args.check:
        if not out.exists():
            sys.exit(f"no fixture at {out}; run without --check to build it")
    else:
        build(source, out)

    return 0 if verify(source, out) else 1


if __name__ == "__main__":
    raise SystemExit(main())
