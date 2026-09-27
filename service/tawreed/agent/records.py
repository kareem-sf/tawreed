"""The conversation and the agent's turns. The engineer sees only these messages: what the agent sent through its
tool, what they wrote, and Tawreed's own notices, which are codes the interface puts in the engineer's language."""

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, ForeignKey, Integer, String, Text, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from tawreed.core.db import Base, UTCDateTime, now

UNFINISHED = ("out_of_steps", "tool_failed", "ai_failed")  # a turn that ended like this is picked up again


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    sender: Mapped[str] = mapped_column(String(8))  # agent | engineer | tawreed
    text: Mapped[str] = mapped_column(Text, default="")  # the agent's or the engineer's words
    notice: Mapped[str | None] = mapped_column(String(40))  # Tawreed's notice, as a code
    params: Mapped[dict[str, Any] | None] = mapped_column(JSON)  # the notice's details
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)


class TurnRecord(Base):
    """One agent turn: written as it starts and completed as it ends, so the work can be explained and resumed."""

    __tablename__ = "turns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    model: Mapped[str] = mapped_column(String(200))
    started_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)
    ended_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    # done | out_of_steps | tool_failed | ai_failed | stopped | failed; none while running or if Tawreed stopped
    ended: Mapped[str | None] = mapped_column(String(16))
    note: Mapped[str | None] = mapped_column(Text)
    calls: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)  # {tool, sent_back}
    requests: Mapped[int] = mapped_column(Integer, default=0)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)


def say(session: Session, project_id: str, sender: str, text: str) -> Message:
    message = Message(project_id=project_id, sender=sender, text=text)
    session.add(message)
    session.flush()
    return message


def notice(session: Session, project_id: str, code: str, **params: Any) -> Message:
    message = Message(project_id=project_id, sender="tawreed", notice=code, params=params or None)
    session.add(message)
    session.flush()
    return message


def messages(session: Session, project_id: str, limit: int | None = None) -> list[Message]:
    """The conversation, oldest first; with a limit, the latest that many."""
    query = select(Message).where(Message.project_id == project_id).order_by(Message.id.desc())
    if limit:
        query = query.limit(limit)
    return list(reversed(session.scalars(query).all()))


def last_turn(session: Session, project_id: str) -> TurnRecord | None:
    query = select(TurnRecord).where(TurnRecord.project_id == project_id).order_by(TurnRecord.id.desc()).limit(1)
    return session.scalars(query).first()


def turns_since(session: Session, project_id: str, moment: datetime | None) -> int:
    query = select(TurnRecord.id).where(TurnRecord.project_id == project_id)
    if moment:
        query = query.where(TurnRecord.started_at > moment)
    return len(session.scalars(query).all())
