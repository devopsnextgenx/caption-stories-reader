"""Metadata combiner for structuring final YAML output."""

import os
import yaml
import logging
from typing import Dict, Any, Optional
from datetime import datetime


class MetadataCombiner:
    """Combines outputs from OCR, Vision, Text LLM, and Translation into standard schema."""

    def combine_metadata(
        self,
        image_path: str,
        ocr_data: Optional[Dict[str, Any]] = None,
        vision_data: Optional[Dict[str, Any]] = None,
        text_data: Optional[Dict[str, Any]] = None,
        translation_data: Optional[Dict[str, Any]] = None,
        processing_time: float = 0.0,
    ) -> Dict[str, Any]:
        """Combine outputs into structured dictionary.

        Args:
            image_path: Absolute or relative path to image file
            ocr_data: Result from OCRProcessor
            vision_data: Result from VisionAgent
            text_data: Result from TextAgent
            translation_data: Result from TranslatorAgent
            processing_time: Total processing time in seconds

        Returns:
            Structured dictionary matching caption YAML schema.
        """
        ocr_data = ocr_data or {}
        vision_data = vision_data or {}
        text_data = text_data or {}
        translation_data = translation_data or {}

        filename = os.path.basename(image_path)
        raw_ocr = ocr_data.get("full_text") or vision_data.get("visible_text", "")
        refined_text = text_data.get("corrected_text", raw_ocr)
        english_text = translation_data.get("translated_text", refined_text)

        metadata = {
            "image_filename": filename,
            "image_path": image_path,
            "processed_at": datetime.now().isoformat(),
            "processing_time_seconds": round(processing_time, 3),
            "content": {
                "raw_ocr_text": raw_ocr,
                "primary_text": refined_text,
                "english_translation": english_text,
                "description": vision_data.get("description", ""),
                "scene": vision_data.get("scene", ""),
                "story_narrative": vision_data.get("story", ""),
            },
            # "ocr_details": {
            #     "line_count": ocr_data.get("line_count", 0),
            #     "lines": [
            #         {"text": l.get("text"), "confidence": l.get("confidence")}
            #         for l in ocr_data.get("lines", [])
            #     ],
            # },
            "tags": self._extract_tags(refined_text, vision_data),
        }
        return metadata

    def save_yaml(self, metadata: Dict[str, Any], output_path: str) -> str:
        """Save metadata dictionary as YAML file.

        Args:
            metadata: Structured metadata dict
            output_path: Path to output .yml file

        Returns:
            Path to written YAML file.
        """
        with open(output_path, "w", encoding="utf-8") as f:
            yaml.dump(metadata, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
        return output_path

    def _extract_tags(self, text: str, vision_data: Dict[str, Any]) -> list[str]:
        """Generate keywords and tags from extracted text and vision output."""
        tags = set()
        if vision_data.get("scene"):
            tags.add(vision_data["scene"].lower())

        words = text.split()
        for w in words:
            clean = "".join(c for c in w if c.isalnum())
            if len(clean) > 4:
                tags.add(clean.lower())

        return list(tags)[:10]
