from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import DateTime, TypeDecorator, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

MIGRATIONS = Path(__file__).resolve().parent.parent / "migrations"


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
    home.mkdir(parents=True, exist_ok=True)
    url = f"sqlite:///{home / 'tawreed.sqlite'}"
    _upgrade(url)
    engine = create_engine(url)
    event.listen(engine, "connect", _sqlite_pragmas)
    return sessionmaker(engine, expire_on_commit=False)


def sessions(factory: sessionmaker[Session]) -> Iterator[Session]:
    with factory() as session:
        yield session


def _upgrade(url: str) -> None:
    """Migrate on a connection with foreign keys off (SQLite's default): SQLite changes a table by rebuilding it,
    and dropping the old table would otherwise delete every row that refers to it. The references are checked
    before the migration is kept."""
    engine = create_engine(url)
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS))
    try:
        with engine.begin() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
            broken = connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall()
            if broken:
                raise RuntimeError(f"The database upgrade left broken references: {broken[:5]}")
    finally:
        engine.dispose()


def _sqlite_pragmas(connection, _record) -> None:
    cursor = connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.close()
