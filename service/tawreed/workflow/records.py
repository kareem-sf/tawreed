"""The record of each step the AI ran: which step, on what, how it ended, and what it cost."""

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, ForeignKey, Integer, String, Text, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from tawreed.core.db import Base, UTCDateTime, now

UNFINISHED = ("out_of_steps", "tool_failed", "ai_failed")  # a run that ended like this is tried again


class StepRecord(Base):
    """One run of a step: written as it starts and completed as it ends, so the work can be explained."""

    __tablename__ = "turns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    step: Mapped[str | None] = mapped_column(String(8))  # read | plan | place
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


def runs(session: Session, project_id: str) -> list[StepRecord]:
    query = select(StepRecord).where(StepRecord.project_id == project_id).order_by(StepRecord.id)
    return list(session.scalars(query))
