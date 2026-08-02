"""Embedding agent for generating text vector embeddings."""

import math
import logging
from typing import List, Optional
from .ollama_client import OllamaClient


class EmbeddingAgent:
    """Agent for generating dense vector embeddings for caption content."""

    def __init__(self, config_manager, ollama_client: Optional[OllamaClient] = None):
        """Initialize EmbeddingAgent."""
        self.config_manager = config_manager
        ollama_cfg = config_manager.get_ollama_config()
        self.host = ollama_cfg.get("host", "http://localhost:11434")
        self.ollama_client = ollama_client or OllamaClient(self.host)
        self.qdrant_cfg = config_manager.get_qdrant_config()
        self.embedding_model = ollama_cfg.get("models", {}).get("embedding_model", "nomic-embed-text")
        self.vector_size = self.qdrant_cfg.get("vector_size", 768)
        self.logger = logging.getLogger(__name__)

    def generate_embedding(self, text: str) -> List[float]:
        """Generate embedding vector for text string.

        Args:
            text: Input string to embed

        Returns:
            List of floats representing normalized vector embedding.
        """
        if not text or not text.strip():
            return [0.0] * self.vector_size

        vec = self.ollama_client.embeddings(prompt=text, model=self.embedding_model)
        if vec and len(vec) > 0:
            # Pad or trim vector to match configured vector_size if needed
            if len(vec) < self.vector_size:
                vec.extend([0.0] * (self.vector_size - len(vec)))
            elif len(vec) > self.vector_size:
                vec = vec[: self.vector_size]
            return vec

        # Fallback hash-based normalized embedding if LLM embedding is unavailable
        return self._generate_fallback_embedding(text)

    def _generate_fallback_embedding(self, text: str) -> List[float]:
        """Deterministic fallback embedding generator when model service is offline."""
        vec = [0.0] * self.vector_size
        words = text.lower().split()
        for idx, word in enumerate(words):
            for char_idx, char in enumerate(word):
                pos = (hash(word) + char_idx * 13 + ord(char)) % self.vector_size
                vec[pos] += 1.0 / (idx + 1)

        # Normalize vector
        magnitude = math.sqrt(sum(v * v for v in vec))
        if magnitude > 0:
            vec = [v / magnitude for v in vec]
        return vec
