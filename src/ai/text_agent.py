"""Text LLM agent for correcting OCR outputs and polishing content."""

import logging
from typing import Dict, Any, Optional
from .ollama_client import OllamaClient


class TextAgent:
    """Agent for refining OCR extracted text using LLMs."""

    def __init__(self, config_manager, ollama_client: Optional[OllamaClient] = None):
        """Initialize TextAgent.

        Args:
            config_manager: ConfigManager instance
            ollama_client: Optional OllamaClient instance
        """
        self.config_manager = config_manager
        ollama_cfg = config_manager.get_ollama_config()
        self.host = ollama_cfg.get("host", "http://localhost:11434")
        self.timeout = ollama_cfg.get("timeout", 120)
        self.ollama_client = ollama_client or OllamaClient(self.host, self.timeout)

        self.text_model = ollama_cfg.get("models", {}).get("text_model", "gemma4:e2b")
        txt_agent_cfg = ollama_cfg.get("text_agent", {})
        self.temperature = txt_agent_cfg.get("temperature", 0.3)
        self.max_tokens = txt_agent_cfg.get("max_tokens", 2000)
        self.system_prompt = txt_agent_cfg.get("system_prompt", (
            "You are an expert text correction assistant. Your task is to:\n"
            "1. Review OCR text and visual analysis\n"
            "2. Correct OCR errors, spelling, and character mistakes\n"
            "3. Complete incomplete words or sentences while maintaining meaning\n"
            "4. Provide a polished, readable text."
        ))
        self.logger = logging.getLogger(__name__)

    def process_text(
        self, ocr_text: str, vision_context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Correct and refine raw OCR text with LLM.

        Args:
            ocr_text: Raw OCR extracted text
            vision_context: Optional dictionary from VisionAgent

        Returns:
            Dictionary with refined text and metadata
        """
        if not ocr_text and not vision_context:
            return {"success": False, "corrected_text": "", "error": "No text provided"}

        prompt = f"Raw OCR Text:\n{ocr_text}\n\n"
        if vision_context:
            prompt += f"Visual Context:\n{vision_context.get('description', '')}\nVisible Text: {vision_context.get('visible_text', '')}\n\n"

        prompt += "Please provide the corrected, coherent, and polished version of the text."

        result = self.ollama_client.generate(
            prompt=prompt,
            model=self.text_model,
            system=self.system_prompt,
            temperature=self.temperature,
            max_tokens=self.max_tokens,
        )

        if result.get("success"):
            corrected = result.get("response", "").strip()
            return {
                "success": True,
                "corrected_text": corrected,
                "model_used": result.get("model"),
            }
        else:
            # Fallback to original OCR text if LLM failed
            return {
                "success": False,
                "corrected_text": ocr_text,
                "error": result.get("error"),
            }
