# Qwen Web

Веб-обёртка над Qwen для задач статического анализа, документирования,
генерации тестов и проверки MISRA.

## Задачи

| Ключ | Назначение |
|------|------------|
| `params_check` | Проверка входных параметров и результата функций (п.2) |
| `headers` | Генерация Doxygen-заголовков функций (п.3) |
| `tests` | Генерация unit-тестов (п.4) |
| `adsb` | Тест-векторы для ADS-B IN ответчика (п.5) |
| `misra` | Проверка соответствия MISRA C:2012 (п.6) |

## Быстрый старт

### Дома (Windows, без Qwen)

    python -m venv .venv
    .venv\Scripts\activate
    pip install -r requirements.txt
    copy .env.example .env
    # в .env: QWEN_MODE=mock
    uvicorn app:app --port 8000

Открыть http://localhost:8000 — всё работает на mock-ответах.

### Практика (Ubuntu)

    python3 -m venv .venv
    source .venv/bin/activate
    pip install -r requirements.txt
    cp .env.example .env
    # в .env прописать URL/модель Ollama или оставить mock
    uvicorn app:app --host 0.0.0.0 --port 8000

## Структура

    qwen/
    ├── app.py            FastAPI-приложение, эндпоинты
    ├── qwen_cli.py       Обёртка над Qwen (HTTP Ollama)
    ├── parsing.py        Извлечение и нормализация JSON из ответа
    ├── prompts.py        Промпты для 5 задач
    ├── static/index.html UI
    └── requirements.txt

## API

- `GET  /`              — UI
- `GET  /api/tasks`     — список задач
- `GET  /api/status`    — текущий режим и модель
- `POST /api/run`       — выполнить задачу

Тело запроса:

    {"task": "params_check", "code": "int f(int a){return a;}"}

    cd C:\Users\yvan0\Yandex.Disk\qwen

.\.venv\Scripts\Activate.ps1
uvicorn app:app --port 8000

def run_qwen_stream(prompt: str, timeout: int | None = None, num_ctx: int = 8192, num_predict: int = 4096):
    """
    Генератор. Yield'ит ('text', str) для кусков и ('meta', dict) в конце.
    """
    if MODE == "mock":
        import time as _t
        mock = _mock_response(prompt)
        for i in range(0, len(mock), 40):
            yield ("text", mock[i:i + 40])
            _t.sleep(0.05)
        yield ("meta", {"done_reason": "stop"})
        return

    payload = json.dumps(
        {
            "model": OLLAMA_MODEL,
            "prompt": prompt,
            "stream": True,
            "keep_alive": "1h",
            "options": {
                "temperature": TEMPERATURE,
                "num_ctx": num_ctx,
                "num_predict": num_predict,
            },
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        f"{OLLAMA_URL}/api/generate",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    idle_timeout = 90   # если Ollama молчит дольше — обрываем
    done_reason = "unknown"
    tokens_in = 0
    tokens_out = 0

    try:
        with urllib.request.urlopen(req, timeout=idle_timeout) as resp:
            for line in resp:
                if not line.strip():
                    continue
                try:
                    obj = json.loads(line.decode("utf-8"))
                except Exception:
                    continue

                piece = obj.get("response", "")
                if piece:
                    yield ("text", piece)

                if obj.get("done"):
                    done_reason = obj.get("done_reason", "stop")
                    tokens_in = obj.get("prompt_eval_count", 0)
                    tokens_out = obj.get("eval_count", 0)
                    break
    except Exception as e:
        yield ("meta", {"done_reason": "error", "error": str(e)})
        return

    yield ("meta", {
        "done_reason": done_reason,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
    })



@app.post("/api/run_stream")
def run_stream(req: Request):
    if req.task not in PROMPTS:
        raise HTTPException(404, "unknown task")

    _validate_files(req.files)
    code = _assemble_code(req.files, req.code or "")

    # адаптивный размер контекста и ответа
    num_ctx = _pick_num_ctx(len(code))
    num_predict = _pick_num_predict(req.task, len(code))

    template = Template(PROMPTS[req.task])
    prompt = template.safe_substitute(
        code=code,
        context=req.context or "",
    )

    def generator():
        buf = []
        meta = None
        try:
            for kind, value in run_qwen_stream(
                prompt, num_ctx=num_ctx, num_predict=num_predict
            ):
                if kind == "text":
                    buf.append(value)
                    yield _sse({"type": "chunk", "text": value})
                elif kind == "meta":
                    meta = value

            raw = "".join(buf)

            if req.task in CODE_TASKS:
                cleaned = _strip_code_fences(raw)
                yield _sse({
                    "type": "code_result",
                    "code": cleaned,
                    "meta": meta,
                })
            else:
                parsed = normalize(req.task, extract_json(raw))
                yield _sse({
                    "type": "done",
                    "raw": raw,
                    "parsed": parsed,
                    "meta": meta,
                })
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


def _pick_num_ctx(code_len: int) -> int:
    if code_len < 8000:
        return 8192
    if code_len < 24000:
        return 16384
    return 32768


def _pick_num_predict(task: str, code_len: int) -> int:
    if task in ("params_check", "misra"):
        return 2048
    if task == "adsb":
        return 4096
    # headers: длина ответа сопоставима с входом + комментарии
    return min(16384, max(4096, code_len // 2))


onDone: ({ parsed, raw, kind, code, meta }) => {
    if (kind === 'code') {
        CODE_RESULT = code || raw;
        CODE_RESULT_NAME = resultFileName();
        $('result-pill').textContent = CODE_RESULT_NAME;
        $('result-pill').style.display = '';
        renderCodeResult();
        showStopReason(meta);
    } else {
        // ... как было ...
        showStopReason(meta);
    }
}





