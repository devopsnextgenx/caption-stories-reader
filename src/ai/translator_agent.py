"""Translator LLM agent for translating primary text to English."""

import logging
from typing import Dict, Any, Optional
from .ollama_client import OllamaClient


class TranslatorAgent:
    """Agent for translating non-English text to English."""

    def __init__(self, config_manager, ollama_client: Optional[OllamaClient] = None):
        """Initialize TranslatorAgent."""
        self.config_manager = config_manager
        ollama_cfg = config_manager.get_ollama_config()
        self.host = ollama_cfg.get("host", "http://localhost:11434")
        self.timeout = ollama_cfg.get("timeout", 120)
        self.ollama_client = ollama_client or OllamaClient(self.host, self.timeout)

        trans_cfg = ollama_cfg.get("translator_agent", {})
        self.model = trans_cfg.get("model") or ollama_cfg.get("models", {}).get("text_model", "gemma4:e2b")
        self.temperature = trans_cfg.get("temperature", 0.0)
        self.max_tokens = trans_cfg.get("max_tokens", 1500)
        self.system_prompt = trans_cfg.get("system_prompt", (
            "You are a translation assistant. Translate the provided text into fluent, natural English. "
            "If the text is already English, return it unchanged. Return only the translated text."
        ))
        self.logger = logging.getLogger(__name__)

    def translate(self, text: str) -> Dict[str, Any]:
        """Translate text to English.

        Args:
            text: Text to translate

        Returns:
            Dictionary containing translated text
        """
        if not text or not text.strip():
            return {"success": True, "translated_text": ""}

        prompt = f"Text to translate:\n{text}"
        result = self.ollama_client.generate(
            prompt=prompt,
            model=self.model,
            system=self.system_prompt,
            temperature=self.temperature,
            max_tokens=self.max_tokens,
        )

        if result.get("success"):
            return {
                "success": True,
                "translated_text": result.get("response", "").strip(),
            }
        else:
            return {
                "success": False,
                "translated_text": text,  # fallback to original
                "error": result.get("error"),
            }
