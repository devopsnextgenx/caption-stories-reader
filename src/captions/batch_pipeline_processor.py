"""Threaded assembly-line parallel pipeline processor for batch image captioning."""

import os
import queue
import time
import logging
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Any, List, Optional

from .single_image_processor import SingleImageProcessor
from .metadata_combiner import MetadataCombiner
from .qdrant_indexer import QdrantIndexer

logger = logging.getLogger(__name__)

_SENTINEL = object()


@dataclass
class WorkItem:
    """Item traveling through assembly-line pipeline stages."""

    img_path: str
    ocr_data: Optional[Dict[str, Any]] = None
    vl_data: Optional[Dict[str, Any]] = None
    text_data: Optional[Dict[str, Any]] = None
    translation_data: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    start_time: float = 0.0


class BatchPipelineProcessor:
    """Assembly-line concurrent pipeline processor for batch processing images."""

    def __init__(self, config_manager, single_processor: Optional[SingleImageProcessor] = None):
        """Initialize BatchPipelineProcessor."""
        self.config_manager = config_manager
        self.single_processor = single_processor or SingleImageProcessor(config_manager)
        self.metadata_combiner = MetadataCombiner()
        self.qdrant_indexer = self.single_processor.qdrant_indexer
        self.logger = logging.getLogger(__name__)

    def find_images(self, folder_path: str) -> List[str]:
        """Scan folder for supported image files."""
        supported = self.config_manager.get_supported_formats()
        images = []
        if not os.path.exists(folder_path):
            return []

        for root, _, files in os.walk(folder_path):
            for file in files:
                ext = os.path.splitext(file)[1].lower()
                if ext in supported and not file.endswith("_caption.yml"):
                    images.append(os.path.join(root, file))
        return sorted(images)

    def process_folder(self, folder_path: str, progress_callback=None) -> Dict[str, Any]:
        """Process all images in a directory using assembly-line parallel queues.

        Args:
            folder_path: Folder containing input image files
            progress_callback: Optional callable(completed_count, total_count)

        Returns:
            Dictionary with processing summary stats.
        """
        image_paths = self.find_images(folder_path)
        if not image_paths:
            return {
                "success": True,
                "total_images": 0,
                "processed": 0,
                "time_seconds": 0.0,
                "results": [],
            }

        start_time = time.monotonic()
        total_images = len(image_paths)
        logger.info("Starting pipeline batch processing of %d images in %s", total_images, folder_path)

        # Queues between stages
        vision_queue: queue.Queue = queue.Queue()
        text_queue: queue.Queue = queue.Queue()
        write_queue: queue.Queue = queue.Queue()

        results: List[Dict[str, Any]] = []
        results_lock = threading.Lock()
        completed_count = 0

        # Stage 1 Worker: OCR
        def ocr_worker():
            for img_path in image_paths:
                item = WorkItem(img_path=img_path, start_time=time.monotonic())
                try:
                    if self.single_processor.enable_ocr:
                        item.ocr_data = self.single_processor.ocr_processor.process_image(img_path)
                except Exception as e:
                    item.error = f"OCR Error: {e}"
                vision_queue.put(item)
            vision_queue.put(_SENTINEL)

        # Stage 2 Worker: Visual LLM
        def vision_worker():
            while True:
                item = vision_queue.get()
                if item is _SENTINEL:
                    text_queue.put(_SENTINEL)
                    break
                if not item.error and self.single_processor.enable_image_agent:
                    try:
                        item.vl_data = self.single_processor.vision_agent.process_image(item.img_path)
                    except Exception as e:
                        item.error = f"Vision Error: {e}"
                text_queue.put(item)

        # Stage 3 Worker: Text LLM & Translation
        def text_worker():
            while True:
                item = text_queue.get()
                if item is _SENTINEL:
                    write_queue.put(_SENTINEL)
                    break
                if not item.error:
                    try:
                        if self.single_processor.enable_text_agent:
                            raw = (item.ocr_data or {}).get("full_text", "")
                            item.text_data = self.single_processor.text_agent.process_text(raw, item.vl_data)

                        if self.single_processor.enable_translation:
                            txt = (item.text_data or {}).get("corrected_text") or (item.ocr_data or {}).get("full_text", "")
                            item.translation_data = self.single_processor.translator_agent.translate(txt)
                    except Exception as e:
                        item.error = f"Text processing error: {e}"
                write_queue.put(item)

        # Stage 4 Worker: Write YAML & Index
        def write_worker():
            nonlocal completed_count
            while True:
                item = write_queue.get()
                if item is _SENTINEL:
                    break

                proc_time = time.monotonic() - item.start_time
                metadata = self.metadata_combiner.combine_metadata(
                    image_path=item.img_path,
                    ocr_data=item.ocr_data,
                    vision_data=item.vl_data,
                    text_data=item.text_data,
                    translation_data=item.translation_data,
                    processing_time=proc_time,
                )

                base_name, _ = os.path.splitext(item.img_path)
                yml_path = f"{base_name}_caption.yml"
                self.metadata_combiner.save_yaml(metadata, yml_path)
                self.qdrant_indexer.index_caption(metadata)

                with results_lock:
                    completed_count += 1
                    results.append(
                        {
                            "image_path": item.img_path,
                            "yaml_path": yml_path,
                            "error": item.error,
                            "time_seconds": round(proc_time, 3),
                        }
                    )
                    if progress_callback:
                        progress_callback(completed_count, total_images)

        threads = [
            threading.Thread(target=ocr_worker, daemon=True, name="OCRWorker"),
            threading.Thread(target=vision_worker, daemon=True, name="VisionWorker"),
            threading.Thread(target=text_worker, daemon=True, name="TextWorker"),
            threading.Thread(target=write_worker, daemon=True, name="WriteWorker"),
        ]

        for t in threads:
            t.start()

        for t in threads:
            t.join()

        total_elapsed = time.monotonic() - start_time
        return {
            "success": True,
            "total_images": total_images,
            "processed": completed_count,
            "time_seconds": round(total_elapsed, 3),
            "results": results,
        }
