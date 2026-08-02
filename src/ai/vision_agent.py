"""Vision LLM agent for analyzing caption images."""

import os
import logging
from typing import Dict, Any, Optional
from PIL import Image

from .ollama_client import OllamaClient


class VisionAgent:
    """Agent for image analysis using Visual LLM models."""

    def __init__(self, config_manager, ollama_client: Optional[OllamaClient] = None):
        """Initialize VisionAgent.

        Args:
            config_manager: ConfigManager instance
            ollama_client: Optional OllamaClient instance
        """
        self.config_manager = config_manager
        ollama_cfg = config_manager.get_ollama_config()
        self.host = ollama_cfg.get("host", "http://localhost:11434")
        self.timeout = ollama_cfg.get("timeout", 120)
        self.ollama_client = ollama_client or OllamaClient(self.host, self.timeout)

        self.vision_model = ollama_cfg.get("models", {}).get("vision_model", "minicpm-v4.6:1b")
        img_agent_cfg = ollama_cfg.get("image_agent", {})
        self.temperature = img_agent_cfg.get("temperature", 0.7)
        self.max_tokens = img_agent_cfg.get("max_tokens", 1000)
        self.system_prompt = img_agent_cfg.get("system_prompt", (
            "You are an expert image analyst. Analyze the provided image and extract:\n"
            "1. Description: A detailed description of what you see\n"
            "2. Scene: The type of scene or setting\n"
            "3. Text: Any visible text in the image\n"
            "4. Story: A brief narrative or context about the image\n"
            "Provide your response in a clear structured format."
        ))
        self.resize_spec = config_manager.get_image_resize_spec()
        self.logger = logging.getLogger(__name__)

    def process_image(self, image_path: str) -> Dict[str, Any]:
        """Analyze image with Visual LLM model.

        Args:
            image_path: Path to target image file

        Returns:
            Dictionary containing extracted vision metadata
        """
        if not os.path.exists(image_path):
            return {"success": False, "error": f"Image file not found: {image_path}"}

        prep_path = self._prepare_image(image_path)

        prompt = "Analyze this caption image and describe the content, text, scene, and narrative context."
        result = self.ollama_client.generate(
            prompt=prompt,
            model=self.vision_model,
            system=self.system_prompt,
            images=[prep_path],
            temperature=self.temperature,
            max_tokens=self.max_tokens,
        )

        # Cleanup temp resized image if created
        if prep_path != image_path and os.path.exists(prep_path):
            try:
                os.remove(prep_path)
            except Exception:
                pass

        if result.get("success"):
            parsed = self._parse_vision_response(result.get("response", ""))
            return {
                "success": True,
                "raw_response": result.get("response"),
                "description": parsed.get("description", ""),
                "scene": parsed.get("scene", ""),
                "visible_text": parsed.get("visible_text", ""),
                "story": parsed.get("story", ""),
            }
        else:
            return {
                "success": False,
                "error": result.get("error", "Vision LLM processing failed"),
                "raw_response": "",
            }

    def _prepare_image(self, image_path: str) -> str:
        """Resize image if required by configuration before sending to Visual LLM."""
        if not self.resize_spec.get("enabled", True):
            return image_path

        try:
            max_w, max_h = self.resize_spec.get("max_size", [1024, 1024])
            with Image.open(image_path) as img:
                w, h = img.size
                if w <= max_w and h <= max_h:
                    return image_path

                img.thumbnail((max_w, max_h), Image.Resampling.LANCZOS)
                temp_path = f"{image_path}.vision_temp.jpg"
                img.convert("RGB").save(temp_path, "JPEG", quality=85)
                return temp_path
        except Exception as e:
            self.logger.warning("Image resize before vision processing failed: %s", e)
            return image_path

    def _parse_vision_response(self, response_text: str) -> Dict[str, str]:
        """Parse structured sections from vision LLM text output."""
        sections = {"description": "", "scene": "", "visible_text": "", "story": ""}
        current_section = "description"

        lines = response_text.split("\n")
        for line in lines:
            lower = line.lower()
            if "scene:" in lower:
                current_section = "scene"
                sections["scene"] += line.split(":", 1)[-1].strip() + " "
            elif "text:" in lower or "visible text:" in lower:
                current_section = "visible_text"
                sections["visible_text"] += line.split(":", 1)[-1].strip() + " "
            elif "story:" in lower:
                current_section = "story"
                sections["story"] += line.split(":", 1)[-1].strip() + " "
            elif "description:" in lower:
                current_section = "description"
                sections["description"] += line.split(":", 1)[-1].strip() + " "
            else:
                sections[current_section] += line.strip() + " "

        return {k: v.strip() for k, v in sections.items()}
