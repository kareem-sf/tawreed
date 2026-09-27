"""Reads new BOQ files in the background, one at a time. Files left half-read by a restart are read again."""

import json
import logging
import shutil
import threading
from collections.abc import Callable
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, sessionmaker

from tawreed.sources import Source, SourcePage, copy_of, overlap, pages_folder, readers

log = logging.getLogger("tawreed.sources")


class Reader:
    """`after_read` runs in the same transaction once a file is read; `notify` runs once that is saved."""

    def __init__(
        self,
        home: Path,
        sessions: sessionmaker[Session],
        after_read: Callable[[Session, Source], None] | None = None,
        notify: Callable[[], None] | None = None,
    ):
        self.home = home
        self.sessions = sessions
        self.after_read = after_read
        self.notify = notify
        self._wake = threading.Event()
        self._closing = threading.Event()
        self._thread = threading.Thread(target=self._run, name="tawreed-reader", daemon=True)

    def start(self) -> None:
        with self.sessions() as session:
            for source in session.scalars(select(Source).where(Source.status == "reading")):
                source.status = "added"  # interrupted by a restart: read it again from the start
            session.commit()
        self._thread.start()

    def wake(self) -> None:
        self._wake.set()

    def close(self) -> None:
        self._closing.set()
        self._wake.set()
        self._thread.join(timeout=30)

    def _run(self) -> None:
        while not self._closing.is_set():
            self._wake.clear()
            while not self._closing.is_set() and self._read_next():
                pass
            self._wake.wait(timeout=10)

    def _read_next(self) -> bool:
        with self.sessions() as session:
            source = session.scalars(select(Source).where(Source.status == "added").order_by(Source.added_at)).first()
            if source is None:
                return False
            source.status = "reading"
            session.commit()
            try:
                read_source(session, self.home, source)
                if source.status == "read" and self.after_read:
                    self.after_read(session, source)
                session.commit()
            except Exception:  # noqa: BLE001  (one bad file must not stop the reader for the others)
                log.exception("Reading %s failed", source.filename)
                session.rollback()
                source = session.get(Source, source.id)
                source.status, source.problem = "failed", "unreadable_file"
                session.commit()
        if self.notify:
            self.notify()
        return True


def read_source(session: Session, home: Path, source: Source) -> None:
    """Read the file into pages, keep each page's content as JSON beside the copy, and note how it went."""
    folder = pages_folder(home, source)
    try:
        pages = readers.read_file(copy_of(home, source), source.kind)
    except readers.Unreadable as error:
        source.status, source.problem = "failed", error.code
        return
    except Exception:  # noqa: BLE001  (a file that breaks a reader must not stop the others)
        log.exception("Could not read %s", source.filename)
        source.status, source.problem = "failed", "unreadable_file"
        return
    if not pages:
        source.status, source.problem = "failed", "nothing_to_read"
        return
    shutil.rmtree(folder, ignore_errors=True)
    folder.mkdir(parents=True)
    session.execute(delete(SourcePage).where(SourcePage.source_id == source.id))  # before the new pages go in
    for page in pages:
        (folder / f"{page.number}.json").write_text(json.dumps(page.content, ensure_ascii=False), encoding="utf-8")
        session.add(
            SourcePage(
                source_id=source.id,
                number=page.number,
                kind=page.kind,
                name=page.name,
                has_text=page.has_text,
                hidden=bool(page.content.get("hidden")),
                rows=page.rows,
                cols=page.cols,
                width=page.width,
                height=page.height,
            )
        )
    (folder / "fingerprints.json").write_text(json.dumps(overlap.fingerprints(pages)), encoding="utf-8")
    source.status, source.problem = "read", None
