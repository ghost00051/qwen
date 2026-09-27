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