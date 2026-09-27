import json
import re

TASK_KEYS = {
    "params_check": "findings",
    "misra": "violations",
    "adsb": "vectors",
}


def extract_json(raw: str):
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except Exception:
            pass

    start = raw.find("{")
    if start == -1:
        return None
    depth = 0
    for i, ch in enumerate(raw[start:], start):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(raw[start:i + 1])
                except Exception:
                    return None
    return None


def normalize(task: str, parsed):
    if parsed is None:
        return None
    key = TASK_KEYS.get(task)

    if isinstance(parsed, list):
        return {key: parsed} if key else parsed

    if isinstance(parsed, dict):
        if key and key in parsed:
            return parsed
        if key and any(k in parsed for k in ("line", "message", "rule", "severity")):
            return {key: [parsed]}

    return parsed