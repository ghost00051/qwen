const ICONS = {
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>',
    doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line>',
    check: '<polyline points="20 6 9 17 4 12"></polyline>',
    plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"></path>',
    dot: '<circle cx="12" cy="12" r="3"></circle>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline>',
};

let TASKS = [];
let current = null;
let ATTACHMENTS = [];
const LS_TEXT = 'qwenweb.text.';
const LS_TASK = 'qwenweb.task';
const LS_LIMITS = 'qwenweb.limits';

let LIMITS = { max_files: 20, max_file_kb: 256, max_total_kb: 1024 };

const $ = id => document.getElementById(id);
let uid = 0;

async function init() {
    try {
        const r = await fetch('/api/tasks');
        TASKS = await r.json();
    } catch { TASKS = []; }

    try {
        const r = await fetch('/api/limits');
        LIMITS = await r.json();
        $('dropzone-hint').textContent =
            `или нажми «Добавить» · до ${LIMITS.max_files} файлов, ` +
            `${LIMITS.max_file_kb} КБ каждый, ${LIMITS.max_total_kb} КБ суммарно`;
    } catch { }

    renderNav();

    const savedTask = localStorage.getItem(LS_TASK);
    if (savedTask && TASKS.find(t => t.key === savedTask)) selectTask(savedTask);
    else if (TASKS.length) selectTask(TASKS[0].key);

    loadStatus();
}

async function loadStatus() {
    try {
        const s = await (await fetch('/api/status')).json();
        const dotClass = s.mode === 'mock' ? 'mock' : '';
        $('status-bar').innerHTML =
            `<span class="status-dot ${dotClass}"></span>` +
            `<div><b>${s.mode}</b> · ${escapeHtml(s.model)}</div>` +
            `<div style="opacity:.7">${escapeHtml(s.url)} · T=${s.temperature}</div>`;
    } catch {
        $('status-bar').innerHTML = `<span class="status-dot err"></span>нет связи с API`;
    }
}

function renderNav() {
    const nav = $('nav');
    nav.innerHTML = '';
    for (const t of TASKS) {
        const item = document.createElement('div');
        item.className = 'nav-item';
        item.dataset.key = t.key;
        item.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        ${ICONS[t.icon] || ICONS.dot}
    </svg>
    <span>${escapeHtml(t.name)}</span>
    `;
        item.onclick = () => selectTask(t.key);
        nav.appendChild(item);
    }
}

function selectTask(key) {
    current = key;
    localStorage.setItem(LS_TASK, key);

    document.querySelectorAll('.nav-item').forEach(el => {
        el.classList.toggle('active', el.dataset.key === key);
    });

    const t = TASKS.find(x => x.key === key);
    if (!t) return;

    $('page-name').textContent = t.name;
    $('page-desc').textContent = t.desc;
    $('page-icon').innerHTML = ICONS[t.icon] || ICONS.dot;

    $('text').value = localStorage.getItem(LS_TEXT + key) || '';

    $('result-card').style.display = 'none';
    $('raw-card').style.display = 'none';
}

$('text')?.addEventListener('input', () => {
    if (current) localStorage.setItem(LS_TEXT + current, $('text').value);
});

function clearText() {
    $('text').value = '';
    if (current) localStorage.removeItem(LS_TEXT + current);
}

function openFilePicker() { $('file-input').click(); }

function onFilePick(e) {
    const files = Array.from(e.target.files || []);
    if (files.length) addFiles(files);
    e.target.value = '';
}

async function addFiles(files) {
    for (const f of files) {
        if (ATTACHMENTS.length >= LIMITS.max_files) {
            toast(`Максимум ${LIMITS.max_files} файлов`);
            break;
        }

        const id = ++uid;
        const item = { id, name: f.name, size: f.size, content: '', loading: true, error: null };
        ATTACHMENTS.push(item);
        renderFiles();

        if (f.size > LIMITS.max_file_kb * 1024) {
            item.loading = false;
            item.error = `больше ${LIMITS.max_file_kb} КБ`;
            renderFiles();
            continue;
        }

        const isText = await isProbablyText(f);
        if (!isText) {
            item.loading = false;
            item.error = 'бинарный файл';
            renderFiles();
            continue;
        }

        try {
            item.content = await f.text();
            item.loading = false;
        } catch {
            item.loading = false;
            item.error = 'не удалось прочитать';
        }
        renderFiles();
    }
}

async function isProbablyText(file) {
    const slice = file.slice(0, 4096);
    const buf = await slice.arrayBuffer();
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] === 0) return false;
    }
    return true;
}

function removeFile(id) {
    ATTACHMENTS = ATTACHMENTS.filter(f => f.id !== id);
    renderFiles();
}

function clearFiles() {
    ATTACHMENTS = [];
    renderFiles();
}

function renderFiles() {
    const list = $('files-list');
    list.innerHTML = '';

    const valid = ATTACHMENTS.filter(f => !f.error && !f.loading);
    const totalBytes = valid.reduce((s, f) => s + f.content.length, 0);

    for (const f of ATTACHMENTS) {
        const chip = document.createElement('div');
        chip.className = 'file-chip' +
            (f.loading ? ' loading' : '') +
            (f.error ? ' error' : '');

        const sizeText = f.error
            ? `<span class="file-chip-error">${escapeHtml(f.error)}</span>`
            : `<span class="file-chip-size">${formatSize(f.size)}</span>`;

        chip.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        ${ICONS.file}
    </svg>
    <span class="file-chip-name">${escapeHtml(f.name)}</span>
    ${sizeText}
    <button class="file-chip-remove" title="Убрать">×</button>
    `;
        chip.querySelector('.file-chip-remove').onclick = () => removeFile(f.id);
        list.appendChild(chip);
    }

    $('clear-files-btn').style.display = ATTACHMENTS.length ? '' : 'none';

    if (totalBytes > LIMITS.max_total_kb * 1024) {
        const warn = document.createElement('div');
        warn.className = 'file-chip error';
        warn.innerHTML = `<span class="file-chip-error">Суммарный размер превышает ${LIMITS.max_total_kb} КБ — сервер отклонит запрос</span>`;
        list.appendChild(warn);
    }
}

function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

(function setupDnD() {
    const dz = $('dropzone');
    let depth = 0;

    const stop = e => { e.preventDefault(); e.stopPropagation(); };

    dz.addEventListener('click', openFilePicker);

    dz.addEventListener('dragenter', e => {
        if (!e.dataTransfer?.types?.includes('Files')) return;
        stop(e); depth++;
        dz.classList.add('drag');
    });

    dz.addEventListener('dragover', e => {
        if (!e.dataTransfer?.types?.includes('Files')) return;
        stop(e);
        e.dataTransfer.dropEffect = 'copy';
    });

    dz.addEventListener('dragleave', e => {
        stop(e);
        depth = Math.max(0, depth - 1);
        if (depth === 0) dz.classList.remove('drag');
    });

    dz.addEventListener('drop', e => {
        stop(e);
        depth = 0;
        dz.classList.remove('drag');
        const files = Array.from(e.dataTransfer?.files || []);
        if (files.length) addFiles(files);
    });

    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('drop', e => {
        if (e.target.closest('.dropzone')) return;
        e.preventDefault();
    });
})();

async function run() {
    if (!current) return;

    const validFiles = ATTACHMENTS.filter(f => !f.error && !f.loading);
    const extra = $('text').value.trim();

    if (!validFiles.length && !extra) {
        toast('Добавь файл или напиши контекст');
        return;
    }

    const btn = $('run-btn');
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Анализ...`;
    $('hint').textContent = 'Qwen генерирует ответ...';

    $('result-card').style.display = 'block';
    $('raw-card').style.display = 'none';
    $('out').innerHTML = `<span class="live-text streaming"></span>`;
    const liveEl = $('out').querySelector('.live-text');

    const body = {
        task: current,
        code: extra,
        files: validFiles.map(f => ({ name: f.name, content: f.content })),
    };

    try {
        await streamRun(body, {
            onChunk: (text) => {
                liveEl.textContent += text;
                $('out').scrollTop = $('out').scrollHeight;
            },
            onDone: ({ parsed, raw }) => {
                $('out').dataset.copy = parsed ? JSON.stringify(parsed, null, 2) : raw;
                $('out').innerHTML = '';
                if (parsed) renderStructured($('out'), parsed);
                else $('out').innerHTML =
                    `<div style="font-family:'JetBrains Mono',monospace;white-space:pre-wrap">${escapeHtml(raw)}</div>`;
                $('raw-card').style.display = 'block';
                $('raw').textContent = raw || '(пусто)';
            },
            onError: (msg) => renderError(msg),
        });
    } catch (e) {
        renderError('Ошибка сети: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Запустить`;
        $('hint').textContent = '';
    }
}

async function streamRun(body, { onChunk, onDone, onError }) {
    const r = await fetch('/api/run_stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!r.ok || !r.body) {
        onError(`HTTP ${r.status}: ${await r.text()}`);
        return;
    }

    const reader = r.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);

            const line = block.split('\n').find(l => l.startsWith('data: '));
            if (!line) continue;

            let payload;
            try { payload = JSON.parse(line.slice(6)); } catch { continue; }

            if (payload.type === 'chunk') onChunk(payload.text || '');
            else if (payload.type === 'done') onDone({ parsed: payload.parsed, raw: payload.raw });
            else if (payload.type === 'error') onError(payload.message || 'неизвестная ошибка');
        }
    }
}

function renderStructured(container, parsed) {
    if (parsed.findings) { renderFindings(container, parsed.findings, 'severity'); return; }
    if (parsed.violations) { renderFindings(container, parsed.violations, 'rule'); return; }
    if (parsed.vectors) { container.innerHTML = highlightJson(parsed); return; }
    container.innerHTML = highlightJson(parsed);
}

function renderFindings(container, items, kind) {
    if (!items.length) {
        container.innerHTML = `<div class="empty">Нарушений не найдено</div>`;
        return;
    }
    for (const f of items) {
        const sev = (f.severity || 'low').toLowerCase();
        const el = document.createElement('div');
        el.className = 'finding ' + (sev === 'high' || sev === 'mid' || sev === 'low' ? sev : 'low');
        const badge = kind === 'rule'
            ? `<span class="badge rule">${escapeHtml(f.rule || '?')}</span>`
            : `<span class="badge ${sev}">${escapeHtml(sev)}</span>`;
        el.innerHTML = `
    <div class="finding-body">
        <div class="finding-meta">
            ${badge}
            ${f.line !== undefined ? `<span>строка ${f.line}</span>` : ''}
        </div>
        <div class="finding-msg">${escapeHtml(f.message || '')}</div>
        ${f.fix ? `<div class="finding-fix">→ ${escapeHtml(f.fix)}</div>` : ''}
    </div>
    `;
        container.appendChild(el);
    }
}

function highlightJson(obj) {
    let json = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
    json = escapeHtml(json);
    return json.replace(
        /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
        m => {
            let cls = 'n';
            if (/^"/.test(m)) cls = /:$/.test(m) ? 'k' : 's';
            else if (/true|false/.test(m)) cls = 'b';
            else if (/null/.test(m)) cls = 'null';
            return `<span class="${cls}">${m}</span>`;
        }
    );
}

function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderError(msg) {
    $('result-card').style.display = 'block';
    $('out').innerHTML = `<div class="error-box">${escapeHtml(msg)}</div>`;
}

async function copyResult() {
    const text = $('out').dataset.copy || $('out').textContent || '';
    try {
        await navigator.clipboard.writeText(text);
        toast('Скопировано в буфер');
    } catch { toast('Не удалось скопировать'); }
}

function toggleRaw(btn) {
    const el = $('raw');
    const hidden = el.style.display === 'none';
    el.style.display = hidden ? '' : 'none';
    btn.textContent = hidden ? 'Свернуть' : 'Развернуть';
}

function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove('show'), 1800);
}

init();
