#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""faster-whisper 常驻服务：模型只加载一次，通过 stdin/stdout 逐行收发请求。
请求行: {"id": 1, "model": "/path/to/model", "language": "auto|zh|en", "wav": "/path/to/audio.wav"}
响应行: {"id": 1, "text": "...", "language": "en"} 或 {"id": 1, "error": "..."}
"""
import json
import sys

from faster_whisper import WhisperModel

_loaded: dict[str, WhisperModel] = {}


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            rid = req.get("id", 0)
            model_dir = req["model"]
            lang = req.get("language", "auto")
            wav = req["wav"]
            if model_dir not in _loaded:
                _loaded[model_dir] = WhisperModel(
                    model_dir, device="cpu", compute_type="int8"
                )
            model = _loaded[model_dir]
            segments, info = model.transcribe(
                wav,
                language=None if lang == "auto" else lang,
                beam_size=1,
                vad_filter=True,
                condition_on_previous_text=False,
            )
            text = " ".join(seg.text.strip() for seg in segments)
            sys.stdout.write(
                json.dumps(
                    {"id": rid, "text": text, "language": info.language},
                    ensure_ascii=False,
                )
                + "\n"
            )
            sys.stdout.flush()
        except Exception as exc:  # noqa: BLE001 - 常驻服务必须吞掉单条错误
            sys.stdout.write(
                json.dumps(
                    {"id": req.get("id", 0) if "req" in dir() else 0, "error": str(exc)},
                    ensure_ascii=False,
                )
                + "\n"
            )
            sys.stdout.flush()


if __name__ == "__main__":
    main()
