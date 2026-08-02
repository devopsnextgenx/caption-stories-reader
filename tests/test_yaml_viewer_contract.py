from pathlib import Path


def test_yaml_viewer_contract_is_present_in_frontend():
    app_js = Path(__file__).resolve().parents[1] / "src" / "web" / "static" / "js" / "app.js"
    css = Path(__file__).resolve().parents[1] / "src" / "web" / "static" / "css" / "style.css"
    js_text = app_js.read_text(encoding="utf-8")
    css_text = css.read_text(encoding="utf-8")

    assert "openYamlViewer" in js_text
    assert "Escape" in js_text or "keydown" in js_text
    assert "Next" in js_text or "prevBtn" in js_text or "nextBtn" in js_text
    assert "yaml-syntax" in css_text or "yaml-viewer" in css_text
    assert "background" in js_text.lower() or "overlay" in js_text.lower()
    assert "view-yaml-btn" in js_text
    assert "tag-cloud" in js_text
