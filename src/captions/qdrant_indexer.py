"""Qdrant indexer for caption image vectors and payload metadata."""

import uuid
import logging
from typing import Dict, Any, Optional, List


class QdrantIndexer:
    """Stores caption embeddings and metadata into Qdrant collection."""

    def __init__(self, config_manager, embedding_agent=None):
        """Initialize QdrantIndexer."""
        self.config_manager = config_manager
        self.embedding_agent = embedding_agent
        self.qdrant_cfg = config_manager.get_qdrant_config()
        self.logger = logging.getLogger(__name__)
        self.client = None

    def _init_client(self) -> bool:
        """Lazy load Qdrant client."""
        if self.client is not None:
            return True

        if not self.qdrant_cfg.get("enabled", True):
            return False

        try:
            from qdrant_client import QdrantClient
            from qdrant_client.models import Distance, VectorParams

            url = self.qdrant_cfg.get("url")
            host = self.qdrant_cfg.get("host", "localhost")
            port = self.qdrant_cfg.get("port", 6333)
            api_key = self.qdrant_cfg.get("api_key")

            if url:
                self.client = QdrantClient(url=url, api_key=api_key)
            else:
                self.client = QdrantClient(host=host, port=port, api_key=api_key)

            collection_name = self.qdrant_cfg.get("collection_name", "captions_index")
            vector_size = self.qdrant_cfg.get("vector_size", 768)

            # Ensure collection exists
            collections = [c.name for c in self.client.get_collections().collections]
            if collection_name not in collections:
                self.client.create_collection(
                    collection_name=collection_name,
                    vectors_config=VectorParams(size=vector_size, distance=Distance.COSINE),
                )
                self.logger.info("Created Qdrant collection '%s'", collection_name)
            return True
        except Exception as e:
            self.logger.warning("Could not connect to Qdrant server: %s", e)
            return False

    def index_caption(
        self, metadata: Dict[str, Any], vector: Optional[List[float]] = None
    ) -> bool:
        """Index caption metadata and vector embedding into Qdrant.

        Args:
            metadata: Caption metadata dictionary
            vector: Optional vector embedding float list

        Returns:
            True if indexing succeeded, False otherwise.
        """
        if not self._init_client():
            return False

        try:
            from qdrant_client.models import PointStruct

            content = metadata.get("content", {})
            text_to_embed = f"{content.get('primary_text', '')} {content.get('description', '')}"

            if vector is None and self.embedding_agent:
                vector = self.embedding_agent.generate_embedding(text_to_embed)

            if not vector:
                self.logger.warning("No vector generated for caption %s", metadata.get("image_filename"))
                return False

            point_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, metadata.get("image_path", "")))
            collection_name = self.qdrant_cfg.get("collection_name", "captions_index")

            point = PointStruct(
                id=point_id,
                vector=vector,
                payload={
                    "image_filename": metadata.get("image_filename"),
                    "image_path": metadata.get("image_path"),
                    "processed_at": metadata.get("processed_at"),
                    "primary_text": content.get("primary_text"),
                    "english_translation": content.get("english_translation"),
                    "description": content.get("description"),
                    "scene": content.get("scene"),
                    "tags": metadata.get("tags", []),
                },
            )

            self.client.upsert(collection_name=collection_name, points=[point])
            self.logger.info("Successfully indexed caption '%s' in Qdrant", metadata.get("image_filename"))
            return True
        except Exception as e:
            self.logger.warning("Failed to index caption in Qdrant: %s", e)
            return False
