import json
import os
import urllib.request

from dotenv import load_dotenv

load_dotenv()

MODE = os.getenv("QWEN_MODE", "mock")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5-coder:7b")
TEMPERATURE = float(os.getenv("QWEN_TEMPERATURE", "0.0"))
TIMEOUT = int(os.getenv("QWEN_TIMEOUT", "600"))


def _mock_response(prompt: str) -> str:
    return json.dumps(
        {
            "mock": True,
            "echo_prompt_len": len(prompt),
            "findings": [
                {
                    "line": 1,
                    "severity": "mid",
                    "message": "Это mock-ответ. На практике подключится реальный Qwen.",
                    "fix": "",
                }
            ],
        },
        ensure_ascii=False,
        indent=2,
    )


def run_qwen(prompt: str, timeout: int | None = None) -> str:
    if MODE == "mock":
        return _mock_response(prompt)

    payload = json.dumps(
        {
            "model": OLLAMA_MODEL,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": TEMPERATURE,
                "num_ctx": 8192,
            },
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        f"{OLLAMA_URL}/api/generate",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout or TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        return f"[ERROR] {e}"

    return data.get("response", "")


def run_qwen_stream(prompt: str, timeout: int | None = None):
    """
    Генератор: выдаёт куски текста по мере генерации Ollama.
    В mock-режиме отдаёт фиктивный ответ по 40 символов с небольшой паузой.
    """
    if MODE == "mock":
        import time as _t
        mock = _mock_response(prompt)
        for i in range(0, len(mock), 40):
            yield mock[i:i + 40]
            _t.sleep(0.05)
        return

    payload = json.dumps(
        {
            "model": OLLAMA_MODEL,
            "prompt": prompt,
            "stream": True,
            "options": {
                "temperature": TEMPERATURE,
                "num_ctx": 8192,
            },
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        f"{OLLAMA_URL}/api/generate",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout or TIMEOUT) as resp:
            for line in resp:
                if not line.strip():
                    continue
                try:
                    obj = json.loads(line.decode("utf-8"))
                except Exception:
                    continue
                piece = obj.get("response", "")
                if piece:
                    yield piece
                if obj.get("done"):
                    break
    except Exception as e:
        yield f"\n[ERROR] {e}"