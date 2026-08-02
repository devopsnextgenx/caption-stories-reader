import sys
import types
from pathlib import Path

from src.captions.ocr_processor import OCRProcessor


class DummyConfig:
    def get_ocr_config(self):
        return {
            "lang": "en",
            "use_gpu": False,
            "use_angle_cls": True,
            "show_log": False,
            "min_confidence": 0.5,
        }


class DummyPaddleOCR:
    def __init__(self, **kwargs):
        self.kwargs = kwargs

    def ocr(self, img, **kwargs):
        if "cls" in kwargs:
            raise TypeError("unexpected keyword argument 'cls'")
        return [[[(0, 0), (10, 0), (10, 5), (0, 5)], ("hello world", 0.99)]]


def test_ocr_process_image_uses_supported_paddleocr_api(tmp_path, monkeypatch):
    image_path = tmp_path / "sample.jpg"
    image_path.write_bytes(b"fake-jpg-bytes")

    monkeypatch.setitem(sys.modules, "paddleocr", types.SimpleNamespace(PaddleOCR=DummyPaddleOCR))

    processor = OCRProcessor(DummyConfig())
    result = processor.process_image(str(image_path))

    assert result["success"] is True
    assert result["full_text"] == "hello world"
    assert result["lines"][0]["text"] == "hello world"


class DummyPaddleOCRVarKwargs:
    def __init__(self, **kwargs):
        self.kwargs = kwargs

    def ocr(self, img, **kwargs):
        return [[[(0, 0), (10, 0), (10, 5), (0, 5)], ("hello world", 0.99)]]


def test_ocr_process_image_forces_cpu_device_when_gpu_disabled(tmp_path, monkeypatch):
    image_path = tmp_path / "sample.jpg"
    image_path.write_bytes(b"fake-jpg-bytes")

    device_calls = []

    def fake_set_device(device):
        device_calls.append(device)

    monkeypatch.setitem(sys.modules, "paddle", types.SimpleNamespace(set_device=fake_set_device))
    monkeypatch.setitem(sys.modules, "paddleocr", types.SimpleNamespace(PaddleOCR=DummyPaddleOCRVarKwargs))

    processor = OCRProcessor(DummyConfig())
    result = processor.process_image(str(image_path))

    assert result["success"] is True
    assert device_calls == ["cpu"]
    assert "use_gpu" not in processor.ocr_engine.kwargs


def test_ocr_process_image_falls_back_to_cpu_when_gpu_not_available(tmp_path, monkeypatch):
    image_path = tmp_path / "sample.jpg"
    image_path.write_bytes(b"fake-jpg-bytes")

    device_calls = []

    class GPUUnavailableConfig:
        def get_ocr_config(self):
            return {
                "lang": "en",
                "use_gpu": True,
                "use_angle_cls": True,
                "show_log": False,
                "min_confidence": 0.5,
            }

    def fake_set_device(device):
        device_calls.append(device)

    class FakePaddle:
        @staticmethod
        def set_device(device):
            fake_set_device(device)

        @staticmethod
        def is_compiled_with_cuda():
            return False

    monkeypatch.setitem(sys.modules, "paddle", FakePaddle)
    monkeypatch.setitem(sys.modules, "paddleocr", types.SimpleNamespace(PaddleOCR=DummyPaddleOCRVarKwargs))

    processor = OCRProcessor(GPUUnavailableConfig())
    result = processor.process_image(str(image_path))

    assert result["success"] is True
    assert device_calls == ["cpu"]
