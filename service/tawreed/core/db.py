import sqlite3
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from alembic.util import CommandError
from sqlalchemy import DateTime, Engine, TypeDecorator, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

MIGRATIONS = Path(__file__).resolve().parent.parent / "migrations"
BUSY_MILLISECONDS = 10_000  # how long a writer waits for another before "database is locked"


class DatabaseTooNew(RuntimeError):
    """The data was written by a newer Tawreed than this one."""


class Base(DeclarativeBase):
    pass


class UTCDateTime(TypeDecorator[datetime]):
    """Stores aware datetimes as UTC and reads them back as UTC; SQLite itself keeps no time zone."""

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect) -> datetime | None:
        return value.astimezone(UTC).replace(tzinfo=None) if value else None

    def process_result_value(self, value: datetime | None, dialect) -> datetime | None:
        return value.replace(tzinfo=UTC) if value else None


def now() -> datetime:
    return datetime.now(UTC)


def open_database(home: Path) -> sessionmaker[Session]:
    """Open the database under the data home, bring its schema up to date and return a session factory."""
    home.mkdir(parents=True, exist_ok=True, mode=0o700)
    file = home / "tawreed.sqlite"
    url = f"sqlite:///{file}"
    _upgrade(url, file)
    engine = _engine(url)
    event.listen(engine, "connect", _sqlite_pragmas)
    return sessionmaker(engine, expire_on_commit=False)


def _engine(url: str) -> Engine:
    """An engine whose transactions are explicit. pysqlite begins a transaction only before the first write, so
    two requests that read and then write can fail with "database is locked" at the moment they write. Taking the
    write lock when the transaction begins makes the second one wait (up to BUSY_MILLISECONDS) instead. This is the
    recipe in SQLAlchemy's pysqlite notes: the driver is told not to begin transactions, and a listener does."""
    engine = create_engine(url)

    @event.listens_for(engine, "connect")
    def connect(connection: sqlite3.Connection, _record) -> None:
        connection.isolation_level = None  # the driver emits no BEGIN of its own
        cursor = connection.cursor()
        cursor.execute(f"PRAGMA busy_timeout={BUSY_MILLISECONDS}")
        cursor.close()

    @event.listens_for(engine, "begin")
    def begin(connection) -> None:
        connection.exec_driver_sql("BEGIN IMMEDIATE")

    return engine


def sessions(factory: sessionmaker[Session]) -> Iterator[Session]:
    with factory() as session:
        yield session


def _upgrade(url: str, file: Path) -> None:
    """Migrate on a connection with foreign keys off (SQLite's default): SQLite changes a table by rebuilding it,
    and dropping the old table would otherwise delete every row that refers to it. The references are checked
    before the migration is kept. Before an existing database is changed, it is copied to
    `tawreed.sqlite.bak-<revision>`; a database from a newer Tawreed is refused."""
    engine = _engine(url)
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS))
    scripts = ScriptDirectory.from_config(config)
    try:
        with engine.connect() as connection:
            current = MigrationContext.configure(connection).get_current_revision()
        if current is not None and not _known(scripts, current):
            raise DatabaseTooNew(
                f"This data was saved by a newer version of Tawreed (database revision {current}). "
                "Install the newer version to open it; nothing has been changed."
            )
        if current is not None and current != scripts.get_current_head():
            backup = file.with_name(f"{file.name}.bak-{current}")
            if not backup.exists():
                _copy(file, backup)
        with engine.begin() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
            broken = connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall()
            if broken:
                raise RuntimeError(f"The database upgrade left broken references: {broken[:5]}")
    finally:
        engine.dispose()


def _known(scripts: ScriptDirectory, revision: str) -> bool:
    try:
        return scripts.get_revision(revision) is not None
    except CommandError:
        return False


def _copy(file: Path, backup: Path) -> None:
    """A consistent copy of the database, taken with SQLite's own backup so the write-ahead log is included."""
    source, target = sqlite3.connect(file), sqlite3.connect(backup)
    try:
        source.backup(target)
    finally:
        target.close()
        source.close()


def _sqlite_pragmas(connection, _record) -> None:
    cursor = connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.close()
