import json

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from string import Template

from parsing import extract_json, normalize
from qwen_cli import run_qwen, run_qwen_stream
from prompts import PROMPTS

app = FastAPI(title="Qwen Web")
app.mount("/static", StaticFiles(directory="static"), name="static")


TASK_META = {
    "params_check": {
        "name": "Проверка параметров",
        "icon": "shield",
        "desc": "Поиск проблем во входных параметрах и результате функции: NULL, границы, переполнения, коды возврата.",
    },
    "headers": {
        "name": "Заголовки функций",
        "icon": "doc",
        "desc": "Генерация Doxygen-комментариев. На выходе — тот же файл, но с добавленными заголовками функций.",
    },
    "misra": {
        "name": "MISRA C:2012",
        "icon": "check",
        "desc": "Анализ соответствия стандарту MISRA C:2012 с указанием правила и исправления.",
    },
    "adsb": {
        "name": "ADS-B IN векторы",
        "icon": "plane",
        "desc": "Генерация тест-векторов 1090ES для ответчика ADS-B IN.",
    },
}

# Задачи, которые возвращают код, а не JSON
CODE_TASKS = {"headers"}

MAX_FILES = 20
MAX_FILE_BYTES = 256 * 1024
MAX_TOTAL_BYTES = 1024 * 1024


class FileItem(BaseModel):
    name: str
    content: str


class Request(BaseModel):
    task: str
    code: str = ""
    context: str | None = None
    files: list[FileItem] = []


def _sse(obj: dict) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


def _assemble_code(files: list[FileItem], extra: str) -> str:
    parts = []
    for f in files:
        parts.append(f"// ===== {f.name} =====\n{f.content}")
    if extra and extra.strip():
        parts.append("// ===== Дополнительный контекст =====\n" + extra.strip())
    return "\n\n".join(parts)


def _validate_files(files: list[FileItem]) -> None:
    if len(files) > MAX_FILES:
        raise HTTPException(400, f"Слишком много файлов (макс {MAX_FILES})")
    total = 0
    for f in files:
        size = len(f.content.encode("utf-8"))
        if size > MAX_FILE_BYTES:
            raise HTTPException(400, f"Файл {f.name} больше {MAX_FILE_BYTES // 1024} КБ")
        total += size
    if total > MAX_TOTAL_BYTES:
        raise HTTPException(400, f"Суммарный размер файлов больше {MAX_TOTAL_BYTES // 1024} КБ")


def _strip_code_fences(text: str) -> str:
    """Убирает markdown-обёртки ```...```, если модель их всё-таки добавила."""
    t = text.strip()
    if t.startswith("```"):
        first_nl = t.find("\n")
        if first_nl != -1:
            t = t[first_nl + 1:]
    if t.endswith("```"):
        t = t[:-3]
    return t.strip("\n") + "\n"


@app.get("/", response_class=HTMLResponse)
def index():
    return open("static/index.html", encoding="utf-8").read()


@app.get("/api/tasks")
def tasks():
    return [
        {
            "key": key,
            "name": TASK_META.get(key, {}).get("name", key),
            "icon": TASK_META.get(key, {}).get("icon", "dot"),
            "desc": TASK_META.get(key, {}).get("desc", ""),
        }
        for key in PROMPTS.keys()
    ]


@app.get("/api/status")
def status():
    from qwen_cli import MODE, OLLAMA_URL, OLLAMA_MODEL, TEMPERATURE
    return {
        "mode": MODE,
        "url": OLLAMA_URL,
        "model": OLLAMA_MODEL,
        "temperature": TEMPERATURE,
    }


@app.get("/api/limits")
def limits():
    return {
        "max_files": MAX_FILES,
        "max_file_kb": MAX_FILE_BYTES // 1024,
        "max_total_kb": MAX_TOTAL_BYTES // 1024,
    }


@app.post("/api/run")
def run(req: Request):
    if req.task not in PROMPTS:
        raise HTTPException(404, "unknown task")

    _validate_files(req.files)
    code = _assemble_code(req.files, req.code or "")

    template = Template(PROMPTS[req.task])
    prompt = template.safe_substitute(
        code=code,
        context=req.context or "",
    )

    raw = run_qwen(prompt)

    if req.task in CODE_TASKS:
        return {"task": req.task, "kind": "code", "code": _strip_code_fences(raw)}

    parsed = normalize(req.task, extract_json(raw))
    return {"task": req.task, "kind": "json", "raw": raw, "parsed": parsed}


@app.post("/api/run_stream")
def run_stream(req: Request):
    if req.task not in PROMPTS:
        raise HTTPException(404, "unknown task")

    _validate_files(req.files)
    code = _assemble_code(req.files, req.code or "")

    template = Template(req.task and PROMPTS[req.task])
    prompt = template.safe_substitute(
        code=code,
        context=req.context or "",
    )

    def generator():
        buf = []
        try:
            for chunk in run_qwen_stream(prompt):
                buf.append(chunk)
                yield _sse({"type": "chunk", "text": chunk})

            raw = "".join(buf)

            if req.task in CODE_TASKS:
                cleaned = _strip_code_fences(raw)
                yield _sse({"type": "code_result", "code": cleaned})
            else:
                parsed = normalize(req.task, extract_json(raw))
                yield _sse({"type": "done", "raw": raw, "parsed": parsed})
        except Exception as e:
            yield _sse({"type": "error", "message": str(e)})

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )