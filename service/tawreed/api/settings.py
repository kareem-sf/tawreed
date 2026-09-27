from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

from tawreed import __version__, settings
from tawreed.ai import connections
from tawreed.api.common import Home, problem

router = APIRouter(tags=["settings"])

Language = Literal["en", "ar"]
Theme = Literal["system", "light", "dark"]


class AIChoice(BaseModel):
    connection_id: str
    model: str


class SettingsOut(BaseModel):
    language: Language
    theme: Theme
    ai: AIChoice | None


class SettingsChange(BaseModel):
    language: Language | None = None
    theme: Theme | None = None
    ai: AIChoice | None = None  # sending null clears the choice


class AboutOut(BaseModel):
    version: str
    data_folder: str


@router.get("/settings")
def get_settings(home: Home) -> SettingsOut:
    return SettingsOut.model_validate(settings.load(home))


@router.patch("/settings")
def change_settings(body: SettingsChange, home: Home) -> SettingsOut:
    values = body.model_dump(exclude_unset=True)
    for name in ("language", "theme"):
        if values.get(name, "") is None:
            del values[name]
    if values.get("ai"):
        connection = connections.get(home, values["ai"]["connection_id"])
        if connection is None:
            raise problem(404, "connection_not_found")
        if not connection["checks"].get(values["ai"]["model"], {}).get("ok"):
            raise problem(400, "model_not_checked")
    return SettingsOut.model_validate(settings.save(home, **values))


@router.get("/about")
def about(home: Home) -> AboutOut:
    return AboutOut(version=__version__, data_folder=str(home))
