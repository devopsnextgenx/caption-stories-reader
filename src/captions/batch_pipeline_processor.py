"""Threaded assembly-line parallel pipeline processor for batch image captioning."""

import os
import queue
import time
import logging
import threading
import tempfile
from dataclasses import dataclass, field
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
    start_time: float = field(default_factory=time.monotonic)


class BatchPipelineProcessor:
    """Assembly-line concurrent pipeline processor for batch processing images.

    Images flow through four independent stages:
        OCR → Vision → Text/Translation → Write YAML + Index

    Each stage runs in its own thread and processes one image at a time,
    handing off to the next stage via a queue.  This means up to four
    images are in-flight simultaneously (one per stage), giving throughput
    gains without overloading any single resource.

    The OCR engine is initialised once before the pipeline starts to
    avoid concurrent init races that caused the repeated
    "paddle is not installed" errors when multiple images all tried to
    lazy-load the engine at the same time.
    """

    def __init__(
        self,
        config_manager,
        single_processor: Optional[SingleImageProcessor] = None,
    ):
        self.config_manager = config_manager
        self.single_processor = single_processor or SingleImageProcessor(config_manager)
        self.metadata_combiner = MetadataCombiner()
        self.qdrant_indexer = self.single_processor.qdrant_indexer
        self.logger = logging.getLogger(__name__)

    # ------------------------------------------------------------------
    # File discovery
    # ------------------------------------------------------------------

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

    # ------------------------------------------------------------------
    # Engine warm-up
    # ------------------------------------------------------------------

    def _warmup_ocr(self) -> bool:
        """Pre-initialise the OCR engine before the pipeline starts.

        Calling _init_ocr_engine() here — in the main thread, before any
        worker thread exists — guarantees that paddle's native .so is
        loaded exactly once.  Without this, all N images hit the lazy-init
        simultaneously and every call fails with the 'libpaddle.so' error.

        Returns True if the engine is ready, False if OCR is disabled or
        initialisation failed (pipeline will skip OCR gracefully).
        """
        if not self.single_processor.enable_ocr:
            return False

        self.logger.info("Pre-initialising OCR engine before pipeline starts...")
        ok = self.single_processor.ocr_processor._init_ocr_engine()
        if ok:
            self.logger.info("OCR engine ready.")
        else:
            self.logger.warning(
                "OCR engine failed to initialise; OCR stage will be skipped for all images."
            )
        return ok

    # ------------------------------------------------------------------
    # Vision temp-file helper
    # ------------------------------------------------------------------

    @staticmethod
    def _make_vision_temp(img_path: str) -> str:
        """Return a unique temp path in /tmp for vision resizing.

        Writing next to the source image (e.g. foo.jpg.vision_temp.jpg)
        fails when the captions mount is read-only or owned by another
        user.  /tmp is always writable by the container process.
        """
        basename = os.path.basename(img_path)
        fd, tmp_path = tempfile.mkstemp(
            suffix=".jpg",
            prefix=f"vision_{basename}_",
            dir="/tmp",
        )
        os.close(fd)
        return tmp_path

    # ------------------------------------------------------------------
    # Pipeline
    # ------------------------------------------------------------------

    def process_folder(self, folder_path: str, progress_callback=None) -> Dict[str, Any]:
        """Process all images in a directory using an assembly-line pipeline.

        Stage topology (one thread each):

            [OCR worker]  →  vision_queue
            [Vision worker]  →  text_queue
            [Text/Translation worker]  →  write_queue
            [Write worker]  →  results list

        Each stage blocks on its input queue, processes one item, then
        puts it on the next queue.  A _SENTINEL object signals the end of
        the stream and is passed downstream so every stage shuts down
        cleanly.

        Args:
            folder_path: Folder containing input image files.
            progress_callback: Optional callable(completed_count, total_count).

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

        total_images = len(image_paths)
        self.logger.info(
            "Starting pipeline batch processing of %d images in %s",
            total_images,
            folder_path,
        )

        # Warm up OCR once in the main thread — prevents concurrent init races.
        ocr_ready = self._warmup_ocr()

        start_time = time.monotonic()

        # Inter-stage queues (unbounded — backpressure is handled by stage
        # processing time naturally slowing the producer).
        vision_queue: queue.Queue = queue.Queue()
        text_queue: queue.Queue = queue.Queue()
        write_queue: queue.Queue = queue.Queue()

        results: List[Dict[str, Any]] = []
        results_lock = threading.Lock()
        completed_count = 0

        # ── Stage 1: OCR ──────────────────────────────────────────────────────
        def ocr_worker():
            for img_path in image_paths:
                item = WorkItem(img_path=img_path)
                if ocr_ready:
                    try:
                        item.ocr_data = self.single_processor.ocr_processor.process_image(img_path)
                    except Exception as exc:
                        item.error = f"OCR error: {exc}"
                        self.logger.warning("OCR failed for %s: %s", img_path, exc)
                vision_queue.put(item)
            vision_queue.put(_SENTINEL)

        # ── Stage 2: Vision LLM ───────────────────────────────────────────────
        def vision_worker():
            while True:
                item = vision_queue.get()
                if item is _SENTINEL:
                    text_queue.put(_SENTINEL)
                    break

                if item.error or not self.single_processor.enable_image_agent:
                    text_queue.put(item)
                    continue

                # Provide a writable /tmp path so the vision agent never tries
                # to write a temp file alongside the (possibly read-only) source.
                tmp_path = self._make_vision_temp(item.img_path)
                try:
                    item.vl_data = self.single_processor.vision_agent.process_image(
                        item.img_path,
                        # Pass the temp path if the vision agent accepts one;
                        # if it manages temp files internally this is a no-op.
                        **({"temp_path": tmp_path}
                           if _agent_accepts_temp_path(self.single_processor.vision_agent)
                           else {}),
                    )
                except Exception as exc:
                    item.error = f"Vision error: {exc}"
                    self.logger.warning("Vision failed for %s: %s", item.img_path, exc)
                finally:
                    # Always clean up, even on error.
                    try:
                        os.unlink(tmp_path)
                    except OSError:
                        pass

                text_queue.put(item)

        # ── Stage 3: Text LLM + Translation ──────────────────────────────────
        def text_worker():
            while True:
                item = text_queue.get()
                if item is _SENTINEL:
                    write_queue.put(_SENTINEL)
                    break

                if item.error:
                    write_queue.put(item)
                    continue

                try:
                    if self.single_processor.enable_text_agent:
                        raw = (item.ocr_data or {}).get("full_text", "")
                        item.text_data = self.single_processor.text_agent.process_text(
                            raw, item.vl_data
                        )
                except Exception as exc:
                    item.error = f"Text processing error: {exc}"
                    self.logger.warning("Text agent failed for %s: %s", item.img_path, exc)

                try:
                    if self.single_processor.enable_translation and not item.error:
                        txt = (item.text_data or {}).get("corrected_text") or (
                            item.ocr_data or {}
                        ).get("full_text", "")
                        item.translation_data = self.single_processor.translator_agent.translate(txt)
                except Exception as exc:
                    # Translation failure is non-fatal — log and carry on.
                    self.logger.warning(
                        "Translation failed for %s: %s", item.img_path, exc
                    )

                write_queue.put(item)

        # ── Stage 4: Write YAML + Qdrant index ───────────────────────────────
        def write_worker():
            nonlocal completed_count
            while True:
                item = write_queue.get()
                if item is _SENTINEL:
                    break

                proc_time = time.monotonic() - item.start_time
                try:
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
                except Exception as exc:
                    if not item.error:
                        item.error = f"Write error: {exc}"
                    self.logger.error(
                        "Write/index failed for %s: %s", item.img_path, exc, exc_info=True
                    )
                    yml_path = ""

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
                        try:
                            progress_callback(completed_count, total_images)
                        except Exception as cb_exc:
                            self.logger.warning("progress_callback raised: %s", cb_exc)

        # ── Launch all four stages concurrently ───────────────────────────────
        threads = [
            threading.Thread(target=ocr_worker,    daemon=True, name="OCRWorker"),
            threading.Thread(target=vision_worker,  daemon=True, name="VisionWorker"),
            threading.Thread(target=text_worker,    daemon=True, name="TextWorker"),
            threading.Thread(target=write_worker,   daemon=True, name="WriteWorker"),
        ]

        for t in threads:
            t.start()
        for t in threads:
            t.join()

        total_elapsed = time.monotonic() - start_time
        errors = [r for r in results if r.get("error")]
        self.logger.info(
            "Pipeline complete: %d/%d images processed in %.1fs (%d errors)",
            completed_count, total_images, total_elapsed, len(errors),
        )
        return {
            "success": True,
            "total_images": total_images,
            "processed": completed_count,
            "failed": len(errors),
            "time_seconds": round(total_elapsed, 3),
            "results": results,
        }


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _agent_accepts_temp_path(agent) -> bool:
    """Return True if the vision agent's process_image() accepts a temp_path kwarg."""
    import inspect
    try:
        sig = inspect.signature(agent.process_image)
        return "temp_path" in sig.parameters
    except (TypeError, ValueError):
        return False