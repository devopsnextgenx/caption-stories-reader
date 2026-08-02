"""OCR Processor using PaddleOCR for text extraction."""

import os
import gc
import logging
from typing import Dict, Any, List, Optional


class OCRProcessor:
    """PaddleOCR engine wrapper for extracting text from images."""

    def __init__(self, config_manager):
        """Initialize OCRProcessor.

        Args:
            config_manager: ConfigManager instance
        """
        self.config_manager = config_manager
        self.logger = logging.getLogger(__name__)
        self.ocr_engine = None
        self.ocr_cfg = config_manager.get_ocr_config()

        # Resolve device once at construction time so everything downstream is
        # consistent.  Critically, _configure_paddle_env() must be called here
        # — before *any* paddle / paddlex import — so the native libraries pick
        # up CUDA_VISIBLE_DEVICES on dlopen.
        requested_gpu = bool(self.ocr_cfg.get("use_gpu", False))
        self._effective_use_gpu = self._configure_paddle_env(requested_gpu)
        self._device = "gpu:0" if self._effective_use_gpu else "cpu"

    # ------------------------------------------------------------------
    # Environment & device setup
    # ------------------------------------------------------------------

    def _configure_paddle_env(self, requested_gpu: bool) -> bool:
        """Set all environment variables needed for a stable PaddleOCR/PaddleX run.

        Must be called BEFORE any paddle / paddleocr / paddlex import so that
        the native shared libraries pick up the settings on dlopen.

        Returns:
            True  — GPU will be used (CUDA compiled + device present + requested)
            False — CPU will be used
        """
        # ── Determine whether GPU is actually usable ──────────────────────────
        use_gpu = False
        if requested_gpu:
            use_gpu = self._probe_cuda()
            if requested_gpu and not use_gpu:
                self.logger.warning(
                    "GPU was requested but CUDA is unavailable; forcing CPU mode."
                )

        # ── CRITICAL: hide the GPU from PaddleX's static runner ──────────────
        # PaddleX builds an AnalysisPredictor whose device is determined by
        # whether CUDA devices are visible at predictor-creation time.  Passing
        # device="cpu" to PaddleOCR() is insufficient — the static runner reads
        # its own internal config, not the Python-level kwarg.  The only
        # reliable way to force CPU is to make the GPU invisible to the process
        # before any import happens.
        if not use_gpu:
            os.environ["CUDA_VISIBLE_DEVICES"] = ""
            self.logger.info("CUDA_VISIBLE_DEVICES='' set; GPU hidden from PaddleX static runner.")

        # ── Disable OneDNN / MKL-DNN (prevents PIR conversion crash) ─────────
        os.environ["PADDLE_DISABLE_ONEDNN"] = "1"
        os.environ["FLAGS_use_mkldnn"] = "0"
        os.environ["FLAGS_enable_pir_api"] = "0"
        os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"
        os.environ["PADDLE_PDX_ENABLE_MKLDNN_BYDEFAULT"] = "0"

        # ── Model cache directory ─────────────────────────────────────────────
        env_cache = os.environ.get("PADDLE_MODEL_CACHE_DIR")
        cfg_cache = self.ocr_cfg.get("model_cache_dir", "~/.paddlex")
        cache_dir = os.path.abspath(os.path.expanduser(env_cache or cfg_cache))
        os.makedirs(cache_dir, exist_ok=True)
        os.environ["PADDLE_HOME"] = cache_dir
        os.environ["PADDLEX_HOME"] = cache_dir
        os.environ["PPOCR_HOME"] = cache_dir

        return use_gpu

    def _probe_cuda(self) -> bool:
        """Return True only when paddle is installed, CUDA-compiled, and has ≥1 device."""
        try:
            import paddle

            cuda_compiled = False
            if hasattr(paddle, "device") and hasattr(paddle.device, "is_compiled_with_cuda"):
                cuda_compiled = bool(paddle.device.is_compiled_with_cuda())
            elif hasattr(paddle, "is_compiled_with_cuda"):
                cuda_compiled = bool(paddle.is_compiled_with_cuda())

            if not cuda_compiled:
                return False

            device_count = 0
            if hasattr(paddle, "device") and hasattr(paddle.device, "cuda") and hasattr(paddle.device.cuda, "device_count"):
                try:
                    device_count = int(paddle.device.cuda.device_count())
                except Exception:
                    pass
            elif hasattr(paddle, "cuda") and hasattr(paddle.cuda, "device_count"):
                try:
                    device_count = int(paddle.cuda.device_count())
                except Exception:
                    pass

            return device_count > 0

        except ImportError:
            return False
        except Exception as exc:
            self.logger.debug("CUDA probe failed: %s", exc)
            return False

    # ------------------------------------------------------------------
    # Engine initialisation (lazy)
    # ------------------------------------------------------------------

    def _init_ocr_engine(self) -> bool:
        """Lazy-load the PaddleOCR engine using the pre-resolved device."""
        if self.ocr_engine is not None:
            return True

        try:
            import paddle
            import inspect

            # Lock paddle's runtime device after the import.  This is a belt-
            # and-suspenders measure on top of CUDA_VISIBLE_DEVICES.
            try:
                if hasattr(paddle, "set_device"):
                    paddle.set_device(self._device)
                elif hasattr(paddle, "device") and hasattr(paddle.device, "set_device"):
                    paddle.device.set_device(self._device)
            except Exception as dev_err:
                self.logger.warning("paddle.set_device('%s') failed: %s", self._device, dev_err)

        except ImportError:
            self.logger.error("paddle is not installed; cannot initialise OCR engine.")
            return False

        try:
            from paddleocr import PaddleOCR
            import inspect

            lang          = self.ocr_cfg.get("lang", "en")
            use_angle_cls = self.ocr_cfg.get("use_angle_cls", True)
            show_log      = self.ocr_cfg.get("show_log", False)
            det_model_dir = self.ocr_cfg.get("det_model_dir")
            rec_model_dir = self.ocr_cfg.get("rec_model_dir")

            # Introspect to avoid passing unsupported kwargs.
            try:
                sig       = inspect.signature(PaddleOCR.__init__)
                supported = set(sig.parameters.keys())
            except (TypeError, ValueError):
                supported = set()

            kwargs: Dict[str, Any] = {}

            # Angle / orientation
            if "use_angle_cls" in supported:
                kwargs["use_angle_cls"] = use_angle_cls
            if "use_textline_orientation" in supported:
                kwargs["use_textline_orientation"] = use_angle_cls

            # Language
            if "lang" in supported:
                kwargs["lang"] = lang

            # Logging
            if "show_log" in supported:
                kwargs["show_log"] = show_log

            # Model directories
            if det_model_dir:
                if "det_model_dir" in supported:
                    kwargs["det_model_dir"] = det_model_dir
                elif "text_detection_model_dir" in supported:
                    kwargs["text_detection_model_dir"] = det_model_dir
            if rec_model_dir:
                if "rec_model_dir" in supported:
                    kwargs["rec_model_dir"] = rec_model_dir
                elif "text_recognition_model_dir" in supported:
                    kwargs["text_recognition_model_dir"] = rec_model_dir

            # Device — new API uses `device=`, old API uses `use_gpu=`.
            # With CUDA_VISIBLE_DEVICES="" already set, either value is safe,
            # but we pass the correct one for clarity.
            if "device" in supported:
                kwargs["device"] = self._device
            elif "use_gpu" in supported:
                kwargs["use_gpu"] = self._effective_use_gpu

            # Disable MKL-DNN at the PaddleOCR level too (belt-and-suspenders).
            if "enable_mkldnn" in supported:
                kwargs["enable_mkldnn"] = False

            # Suppress unused document-pipeline stages.
            if "use_doc_orientation_classify" in supported:
                kwargs["use_doc_orientation_classify"] = False
            if "use_doc_unwarping" in supported:
                kwargs["use_doc_unwarping"] = False

            self.logger.info(
                "Initializing PaddleOCR (lang=%s, device=%s, gpu=%s)...",
                lang, self._device, self._effective_use_gpu,
            )
            self.ocr_engine = PaddleOCR(**kwargs)
            self.logger.info("PaddleOCR initialised successfully on %s.", self._device)
            return True

        except Exception as exc:
            self.logger.error("Failed to initialise PaddleOCR: %s", exc, exc_info=True)
            return False

    # ------------------------------------------------------------------
    # Result parsing
    # ------------------------------------------------------------------

    def _parse_result(self, result) -> List[Dict[str, Any]]:
        """Normalise heterogeneous output formats across PaddleOCR versions.

        Handles:
          • New attribute-based PageResult objects  (PP-OCRv5 / PaddleX)
          • Legacy list-of-[box, (text, conf)]      (PaddleOCR < 2.8)
        """
        lines: List[Dict[str, Any]] = []
        min_conf: float = float(self.ocr_cfg.get("min_confidence", 0.5))

        if result is None:
            return lines

        # Materialise generators.
        items = list(result) if (hasattr(result, "__iter__") and not isinstance(result, (list, dict))) else result
        if not isinstance(items, list):
            items = [items]

        for page in items:
            if page is None:
                continue

            # ── PP-OCRv5 / PaddleX: attribute-based PageResult ────────────────
            rec_texts  = getattr(page, "rec_texts",  None)
            rec_scores = getattr(page, "rec_scores", None)
            rec_polys  = getattr(page, "rec_polys",  None)

            if rec_texts is None and isinstance(page, dict):
                rec_texts  = page.get("rec_texts")
                rec_scores = page.get("rec_scores", [])
                rec_polys  = page.get("rec_polys",  [])

            if rec_texts is not None:
                for i, text_str in enumerate(rec_texts):
                    conf = float(rec_scores[i]) if rec_scores and i < len(rec_scores) else 1.0
                    if conf < min_conf:
                        continue
                    poly = rec_polys[i] if rec_polys and i < len(rec_polys) else []
                    if hasattr(poly, "tolist"):
                        poly = poly.tolist()
                    lines.append({
                        "text":       str(text_str).strip(),
                        "confidence": round(conf, 4),
                        "box":        poly,
                    })
                continue  # next page

            # ── Legacy API: [[box, (text, conf)], ...] ────────────────────────
            candidates = page if isinstance(page, (list, tuple)) else []
            for item in candidates:
                if not isinstance(item, (list, tuple)) or len(item) < 2:
                    continue
                box, text_info = item[0], item[1]
                if isinstance(text_info, dict):
                    text = text_info.get("text") or text_info.get("transcription", "")
                    conf = float(text_info.get("confidence", 0.0))
                elif isinstance(text_info, (list, tuple)) and len(text_info) >= 2:
                    text, conf = str(text_info[0]), float(text_info[1])
                else:
                    continue
                if conf < min_conf:
                    continue
                lines.append({
                    "text":       str(text).strip(),
                    "confidence": round(conf, 4),
                    "box":        box,
                })

        return lines

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def process_image(self, image_path: str) -> Dict[str, Any]:
        """Perform text recognition on an image file.

        Args:
            image_path: Path to target image.

        Returns:
            Dict with keys: success, full_text, lines, line_count.
            On failure adds: error.
        """
        if not os.path.exists(image_path):
            return {
                "success": False,
                "error": f"File not found: {image_path}",
                "full_text": "",
                "lines": [],
            }

        if not self._init_ocr_engine():
            return {
                "success": False,
                "error": "PaddleOCR engine unavailable",
                "full_text": "",
                "lines": [],
            }

        try:
            import inspect

            # PP-OCRv5 / PaddleX exposes predict(); older builds use ocr().
            if hasattr(self.ocr_engine, "predict"):
                raw = self.ocr_engine.predict(image_path)
            else:
                ocr_kwargs: Dict[str, Any] = {}
                try:
                    sig = inspect.signature(self.ocr_engine.ocr)
                    if "cls" in sig.parameters:
                        ocr_kwargs["cls"] = self.ocr_cfg.get("use_angle_cls", True)
                except (TypeError, ValueError):
                    pass
                raw = self.ocr_engine.ocr(image_path, **ocr_kwargs)

            lines     = self._parse_result(raw)
            full_text = " ".join(ln["text"] for ln in lines).strip()

            return {
                "success":    True,
                "full_text":  full_text,
                "lines":      lines,
                "line_count": len(lines),
            }

        except Exception as exc:
            self.logger.error(
                "OCR execution error on image %s: %s", image_path, exc, exc_info=True
            )
            return {
                "success":  False,
                "error":    str(exc),
                "full_text": "",
                "lines":    [],
            }

    def release(self):
        """Destroy the OCR engine and free GPU memory."""
        if self.ocr_engine is not None:
            try:
                predictor = (
                    getattr(self.ocr_engine, "_pipeline", None)
                    or getattr(self.ocr_engine, "predictor", None)
                )
                if predictor is not None and hasattr(predictor, "destroy"):
                    predictor.destroy()
            except Exception as exc:
                self.logger.warning("Could not destroy OCR engine predictor: %s", exc)
            self.ocr_engine = None
            self.logger.info("OCR engine released.")

        gc.collect()

        if self._effective_use_gpu:
            try:
                import paddle
                if paddle.device.is_compiled_with_cuda():
                    paddle.device.cuda.empty_cache()
                    self.logger.info("Paddle CUDA cache cleared.")
            except Exception as exc:
                self.logger.warning("paddle.device.cuda.empty_cache() failed: %s", exc)