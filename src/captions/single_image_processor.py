"""Single image processor orchestrating complete caption extraction pipeline."""

import os
import time
import logging
from typing import Dict, Any, Optional

from .ocr_processor import OCRProcessor
from .metadata_combiner import MetadataCombiner
from .pipeline_state import PipelineStateManager
from .qdrant_indexer import QdrantIndexer
from ..ai.vision_agent import VisionAgent
from ..ai.text_agent import TextAgent
from ..ai.translator_agent import TranslatorAgent
from ..ai.embedding_agent import EmbeddingAgent


class SingleImageProcessor:
    """Processes an individual image through all enabled pipeline stages."""

    def __init__(
        self,
        config_manager,
        ocr_processor: Optional[OCRProcessor] = None,
        vision_agent: Optional[VisionAgent] = None,
        text_agent: Optional[TextAgent] = None,
        translator_agent: Optional[TranslatorAgent] = None,
        embedding_agent: Optional[EmbeddingAgent] = None,
        qdrant_indexer: Optional[QdrantIndexer] = None,
    ):
        """Initialize SingleImageProcessor."""
        self.config_manager = config_manager
        self.logger = logging.getLogger(__name__)

        self.ocr_processor = ocr_processor or OCRProcessor(config_manager)
        self.vision_agent = vision_agent or VisionAgent(config_manager)
        self.text_agent = text_agent or TextAgent(config_manager)
        self.translator_agent = translator_agent or TranslatorAgent(config_manager)
        self.embedding_agent = embedding_agent or EmbeddingAgent(config_manager)
        self.qdrant_indexer = qdrant_indexer or QdrantIndexer(config_manager, self.embedding_agent)
        self.metadata_combiner = MetadataCombiner()
        self.state_manager = PipelineStateManager()

        pipe_cfg = config_manager.get_pipeline_config()
        self.enable_ocr = pipe_cfg.get("enable_ocr", True)
        self.enable_image_agent = pipe_cfg.get("enable_image_agent", True)
        self.enable_text_agent = pipe_cfg.get("enable_text_agent", True)
        self.enable_translation = pipe_cfg.get("enable_translation", True)

    def process_image(self, image_path: str) -> Dict[str, Any]:
        """Run image through caption extraction pipeline and save output YAML file.

        Args:
            image_path: Path to target image file

        Returns:
            Dictionary containing metadata and output yaml path.
        """
        start_time = time.time()
        state = self.state_manager.create_initial_state(image_path)

        ocr_data: Dict[str, Any] = {}
        vision_data: Dict[str, Any] = {}
        text_data: Dict[str, Any] = {}
        translation_data: Dict[str, Any] = {}

        # 1. OCR Stage
        if self.enable_ocr:
            t0 = time.time()
            ocr_data = self.ocr_processor.process_image(image_path)
            self.state_manager.mark_step_complete(state, "ocr", time.time() - t0, ocr_data)

        # 2. Vision Agent Stage
        if self.enable_image_agent:
            t0 = time.time()
            vision_data = self.vision_agent.process_image(image_path)
            self.state_manager.mark_step_complete(state, "vision", time.time() - t0, vision_data)

        # 3. Text Agent Stage
        if self.enable_text_agent:
            t0 = time.time()
            raw_text = ocr_data.get("full_text", "")
            text_data = self.text_agent.process_text(raw_text, vision_data)
            self.state_manager.mark_step_complete(state, "text", time.time() - t0, text_data)

        # 4. Translation Stage
        if self.enable_translation:
            t0 = time.time()
            target_text = text_data.get("corrected_text") or ocr_data.get("full_text", "")
            translation_data = self.translator_agent.translate(target_text)
            self.state_manager.mark_step_complete(
                state, "translation", time.time() - t0, translation_data
            )

        # 5. Metadata Combiner & YAML Saver
        total_time = time.time() - start_time
        metadata = self.metadata_combiner.combine_metadata(
            image_path=image_path,
            ocr_data=ocr_data,
            vision_data=vision_data,
            text_data=text_data,
            translation_data=translation_data,
            processing_time=total_time,
        )

        base_name, _ = os.path.splitext(image_path)
        output_yaml_path = f"{base_name}_caption.yml"
        self.metadata_combiner.save_yaml(metadata, output_yaml_path)

        # 6. Vector Indexing in Qdrant
        self.qdrant_indexer.index_caption(metadata)

        return {
            "success": True,
            "image_path": image_path,
            "yaml_path": output_yaml_path,
            "processing_time": round(total_time, 3),
            "metadata": metadata,
        }
