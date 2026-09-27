"""Prove a model can do Tawreed's work: it must call a tool with a code only this request contains. Then ask it to
read a number from an image, because some services accept images for models that cannot see them."""

import io
import secrets

from PIL import Image, ImageDraw, ImageFont
from pydantic_ai import Agent, BinaryContent, UsageLimits
from pydantic_ai.models import Model
from pydantic_ai.settings import ModelSettings

from tawreed.ai.providers import explain


class _Confirmed(Exception):
    """Ends the check as soon as the tool is called: the model's closing reply proves nothing more."""


async def check_model(model: Model) -> tuple[bool, str | None, bool]:
    """Whether it works, the problem code when it doesn't, and whether it can read images."""
    problem = await _uses_tools(model)
    if problem:
        return False, problem, False
    return True, None, await _reads_images(model)


async def _uses_tools(model: Model) -> str | None:
    code = secrets.token_hex(3)
    received: list[str] = []

    def confirm(code: str) -> str:
        """Confirm the code you were given."""
        received.append(code)
        raise _Confirmed()

    agent = Agent(
        model,
        instructions="This is a connection check. Call the confirm tool once with the code you are given.",
        tools=[confirm],
        model_settings=ModelSettings(timeout=120.0),
    )
    try:
        await agent.run(f"The code is {code}.", usage_limits=UsageLimits(request_limit=3))
    except Exception as error:  # noqa: BLE001  (any failure is reported to the engineer in plain words)
        if code in received:
            return None
        return explain(error)[0]
    return None if code in received else "no_tool_use"


def number_image(number: str) -> bytes:
    """A PNG with a number written large on it, for checking that a model reads images."""
    image = Image.new("RGB", (420, 180), "white")
    ImageDraw.Draw(image).text((60, 30), number, fill="black", font=ImageFont.load_default(size=110))
    png = io.BytesIO()
    image.save(png, format="PNG")
    return png.getvalue()


async def _reads_images(model: Model) -> bool:
    number = str(secrets.randbelow(900) + 100)
    agent = Agent(model, instructions="Read images exactly.", model_settings=ModelSettings(timeout=120.0))
    question = "What number is written in this image? Reply with the digits only."
    try:
        result = await agent.run([question, BinaryContent(number_image(number), media_type="image/png")])
    except Exception:  # noqa: BLE001  (a model that refuses images simply can't read them)
        return False
    return number in str(result.output)
