"""Ollama / LM-Studio client for LLM and Vision interactions."""

import base64
import logging
import requests
from typing import Dict, Any, List, Optional


class OllamaClient:
    """Client for communicating with Ollama or OpenAI-compatible local LLM endpoints."""

    def __init__(self, host: str = "http://localhost:11434", timeout: int = 120):
        """Initialize Ollama Client.

        Args:
            host: Ollama API host endpoint
            timeout: Request timeout in seconds
        """
        self.host = host.rstrip("/")
        self.timeout = timeout
        self.logger = logging.getLogger(__name__)

    def generate(
        self,
        prompt: str,
        model: str,
        system: Optional[str] = None,
        images: Optional[List[str]] = None,
        temperature: float = 0.7,
        max_tokens: Optional[int] = 1000,
    ) -> Dict[str, Any]:
        """Generate text completion from prompt.

        Args:
            prompt: User prompt string
            model: Model identifier name
            system: Optional system prompt
            images: List of base64 encoded image strings or image paths
            temperature: Sampling temperature
            max_tokens: Maximum tokens to generate

        Returns:
            Dictionary with response text and metadata
        """
        url = f"{self.host}/api/generate"

        payload: Dict[str, Any] = {
            "model": model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": temperature,
            },
        }

        if system:
            payload["system"] = system

        if max_tokens:
            payload["options"]["num_predict"] = max_tokens

        if images:
            encoded_images = []
            for img in images:
                if len(img) < 1024 and (img.endswith((".png", ".jpg", ".jpeg", ".webp"))):
                    # It's a file path
                    try:
                        with open(img, "rb") as f:
                            encoded_images.append(base64.b64encode(f.read()).decode("utf-8"))
                    except Exception as e:
                        self.logger.error("Failed to read image file for Ollama: %s", e)
                else:
                    # Already base64 encoded string
                    encoded_images.append(img)
            payload["images"] = encoded_images

        try:
            response = requests.post(url, json=payload, timeout=self.timeout)
            response.raise_for_status()
            data = response.json()
            return {
                "success": True,
                "response": data.get("response", "").strip(),
                "model": data.get("model", model),
                "done": data.get("done", True),
                "context": data.get("context", []),
            }
        except Exception as e:
            self.logger.error("Ollama generate failed (model %s): %s", model, e)
            return {
                "success": False,
                "error": str(e),
                "response": "",
            }

    def embeddings(self, prompt: str, model: str = "nomic-embed-text") -> List[float]:
        """Generate vector embedding for a text string.

        Args:
            prompt: Text to embed
            model: Embedding model identifier

        Returns:
            List of floats representing vector embedding.
        """
        url = f"{self.host}/api/embeddings"
        payload = {"model": model, "prompt": prompt}

        try:
            response = requests.post(url, json=payload, timeout=30)
            response.raise_for_status()
            data = response.json()
            return data.get("embedding", [])
        except Exception as e:
            self.logger.warning("Ollama embedding failed (model %s): %s", model, e)
            return []
