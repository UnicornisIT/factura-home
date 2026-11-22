"""Check SQLite's rollback boundary with the shipped SQL in a temporary DB."""
import argparse
import sqlite3
from pathlib import Path
from tempfile import TemporaryDirectory


def statements(path):
    return [part.strip() for part in path.read_text(encoding="utf-8").split(";") if part.strip()]


def apply(conn, migration):
    for statement in statements(migration):
        conn.execute(statement)
    conn.execute("INSERT INTO marker VALUES (?)", (migration.name,))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("migrations", type=Path)
    args = parser.parse_args()
    files = sorted(args.migrations.glob("*.sqlite.sql"))
    interrupted = next(path for path in files if path.name.startswith("004_"))

    with TemporaryDirectory(prefix="factura-audit-") as directory:
        database = Path(directory) / "audit.sqlite"
        conn = sqlite3.connect(database, isolation_level=None)
        try:
            conn.execute("CREATE TABLE marker (name TEXT PRIMARY KEY)")
            for migration in files[:files.index(interrupted)]:
                apply(conn, migration)

            conn.execute("BEGIN IMMEDIATE")
            first, *_ = statements(interrupted)
            conn.execute(first)
            assert "logoImage" in {row[1] for row in conn.execute("PRAGMA table_info(siteContent)")}
        finally:
            # Closing a connection with an active transaction rolls back the DDL.
            conn.close()

        conn = sqlite3.connect(database, isolation_level=None)
        try:
            assert "logoImage" not in {row[1] for row in conn.execute("PRAGMA table_info(siteContent)")}
            assert conn.execute("SELECT 1 FROM marker WHERE name = ?", (interrupted.name,)).fetchone() is None
            conn.execute("BEGIN IMMEDIATE")
            for migration in files[files.index(interrupted):]:
                apply(conn, migration)
            conn.execute("COMMIT")
            assert conn.execute("SELECT COUNT(*) FROM marker").fetchone() == (len(files),)
            assert "logoImage" in {row[1] for row in conn.execute("PRAGMA table_info(siteContent)")}
        finally:
            conn.close()
    print("SQLite DDL rollback and replay passed")


if __name__ == "__main__":
    main()
