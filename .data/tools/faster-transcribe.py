#!/usr/bin/env python3
"""faster-whisper 转写脚本：stdin 接收 16k 单声道 WAV，stdout 输出 JSON。
用法: faster-transcribe.py <model_dir> <language|auto> <wav_path>"""
import json
import sys
import time


def main():
    if len(sys.argv) < 4:
        print(json.dumps({"error": "args"}), flush=True)
        return 2
    model_dir, language, wav_path = sys.argv[1], sys.argv[2], sys.argv[3]
    t0 = time.time()
    try:
        from faster_whisper import WhisperModel

        model = WhisperModel(model_dir, device="cpu", compute_type="int8")
        lang = None if language == "auto" else language
        segments, info = model.transcribe(
            wav_path,
            language=lang,
            beam_size=1,
            vad_filter=True,
            condition_on_previous_text=False,
        )
        text = "".join(s.text for s in segments).strip()
        print(
            json.dumps(
                {
                    "text": text,
                    "language": info.language if hasattr(info, "language") else "",
                    "elapsed_ms": int((time.time() - t0) * 1000),
                },
                ensure_ascii=False,
            ),
            flush=True,
        )
        return 0
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), flush=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
