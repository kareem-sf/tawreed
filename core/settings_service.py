"""Typed, merge-based application settings operations.

The legacy :mod:`core.db` API remains the persistence facade.  This
service adds section-level transactions so one Settings section never
overwrites unapplied values owned by another section.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass

from core import db
from core.ai import get_provider_config, is_valid_provider
from core.i18n import SUPPORTED_LANGUAGES


class SettingsValidationError(ValueError):
    """Raised when a Settings section cannot be persisted safely."""


@dataclass(frozen=True, slots=True)
class AppSettings:
    provider: str
    api_key: str
    base_url: str
    model: str
    language: str
    theme: str

    @classmethod
    def from_mapping(cls, values: Mapping[str, object]) -> AppSettings:
        return cls(
            provider=str(values.get("provider") or "Codex"),
            api_key=str(values.get("api_key") or ""),
            base_url=str(values.get("base_url") or ""),
            model=str(values.get("model_id") or values.get("model") or ""),
            language=str(values.get("language") or "en"),
            theme=str(values.get("theme") or "system"),
        )


class SettingsService:
    """Own validation and merge semantics for independently applied sections."""

    def load(self) -> AppSettings:
        return AppSettings.from_mapping(db.get_settings())

    def save_ai_connection(
        self,
        provider: str,
        api_key: str,
        base_url: str,
        available_models: Iterable[str] = (),
    ) -> AppSettings:
        if not is_valid_provider(provider):
            raise SettingsValidationError("Unknown AI provider")
        config = get_provider_config(provider)
        api_key = api_key.strip()
        base_url = base_url.strip() or str(config.get("base_url") or "")
        if config.get("requires_api_key", True) and not api_key:
            raise SettingsValidationError("API key is required")
        if config.get("requires_base_url") and not base_url:
            raise SettingsValidationError("Base URL is required")

        current = self.load()
        candidates = tuple(model.strip() for model in available_models if model.strip())
        model = current.model
        if provider != current.provider or (candidates and model not in candidates):
            model = candidates[0] if candidates else str(config.get("default_model") or "")
        return self._merge(
            provider=provider,
            api_key=api_key,
            base_url=base_url,
            model=model,
            model_id=model,
        )

    def save_model(self, model: str) -> AppSettings:
        model = model.strip()
        if not model:
            raise SettingsValidationError("Model is required")
        return self._merge(model=model, model_id=model)

    def save_appearance(self, theme: str) -> AppSettings:
        if theme not in {"system", "light", "dark"}:
            raise SettingsValidationError("Unknown theme")
        return self._merge(theme=theme)

    def save_language(self, language: str) -> AppSettings:
        if language not in SUPPORTED_LANGUAGES:
            raise SettingsValidationError("Unsupported language")
        return self._merge(language=language)

    def _merge(self, **changes: object) -> AppSettings:
        values = db.get_settings()
        values.update(changes)
        db.save_settings(values)
        return self.load()


__all__ = ["AppSettings", "SettingsService", "SettingsValidationError"]
