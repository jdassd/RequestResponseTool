
const STATE_KEY = 'rrt_state';
const LOGS_KEY = 'rrt_logs';
const LANG_KEY = 'rrt_lang';

const DEFAULT_STATE = {
    enabled: true,
    rules: [],
    scripts: []
};

const state = {
    data: DEFAULT_STATE,
    logs: [],
    editingRuleId: null,
    editingScriptId: null,
    batch: {
        rows: [],
        running: false,
        abort: false,
        results: []
    }
};

let currentLang = 'zh_CN';
let messages = {};

const elements = {
    globalEnabled: document.getElementById('globalEnabled'),
    globalStatus: document.getElementById('globalStatus'),
    ruleCount: document.getElementById('ruleCount'),
    scriptCount: document.getElementById('scriptCount'),
    ruleList: document.getElementById('ruleList'),
    newRuleBtn: document.getElementById('newRuleBtn'),
    editingBadge: document.getElementById('editingBadge'),
    ruleName: document.getElementById('ruleName'),
    ruleType: document.getElementById('ruleType'),
    rulePriority: document.getElementById('rulePriority'),
    ruleEnabled: document.getElementById('ruleEnabled'),
    ruleMethod: document.getElementById('ruleMethod'),
    matchType: document.getElementById('matchType'),
    matchValue: document.getElementById('matchValue'),
    redirectFields: document.getElementById('redirectFields'),
    blockFields: document.getElementById('blockFields'),
    headersFields: document.getElementById('headersFields'),
    mockFields: document.getElementById('mockFields'),
    interceptFields: document.getElementById('interceptFields'),
    redirectUrl: document.getElementById('redirectUrl'),
    requestHeadersList: document.getElementById('requestHeadersList'),
    responseHeadersList: document.getElementById('responseHeadersList'),
    addRequestHeader: document.getElementById('addRequestHeader'),
    addResponseHeader: document.getElementById('addResponseHeader'),
    mockStatus: document.getElementById('mockStatus'),
    mockDelay: document.getElementById('mockDelay'),
    mockContentType: document.getElementById('mockContentType'),
    mockBody: document.getElementById('mockBody'),
    interceptRequestMode: document.getElementById('interceptRequestMode'),
    interceptRequestUrl: document.getElementById('interceptRequestUrl'),
    interceptRequestHeaders: document.getElementById('interceptRequestHeaders'),
    interceptRequestBody: document.getElementById('interceptRequestBody'),
    interceptResponseMode: document.getElementById('interceptResponseMode'),
    interceptResponseStatus: document.getElementById('interceptResponseStatus'),
    interceptDelay: document.getElementById('interceptDelay'),
    interceptResponseHeaders: document.getElementById('interceptResponseHeaders'),
    interceptResponseBody: document.getElementById('interceptResponseBody'),
    resetRule: document.getElementById('resetRule'),
    saveRule: document.getElementById('saveRule'),
    ruleStatus: document.getElementById('ruleStatus'),
    testUrl: document.getElementById('testUrl'),
    runTest: document.getElementById('runTest'),
    testResults: document.getElementById('testResults'),
    scriptList: document.getElementById('scriptList'),
    newScriptBtn: document.getElementById('newScriptBtn'),
    scriptName: document.getElementById('scriptName'),
    scriptRunAt: document.getElementById('scriptRunAt'),
    scriptEnabled: document.getElementById('scriptEnabled'),
    scriptMatchType: document.getElementById('scriptMatchType'),
    scriptMatchValue: document.getElementById('scriptMatchValue'),
    scriptJs: document.getElementById('scriptJs'),
    scriptCss: document.getElementById('scriptCss'),
    resetScript: document.getElementById('resetScript'),
    saveScript: document.getElementById('saveScript'),
    batchUrl: document.getElementById('batchUrl'),
    batchMethod: document.getElementById('batchMethod'),
    batchHeaders: document.getElementById('batchHeaders'),
    batchBody: document.getElementById('batchBody'),
    batchConcurrency: document.getElementById('batchConcurrency'),
    batchTimeout: document.getElementById('batchTimeout'),
    batchFile: document.getElementById('batchFile'),
    batchStart: document.getElementById('batchStart'),
    batchStop: document.getElementById('batchStop'),
    batchStatus: document.getElementById('batchStatus'),
    batchMetrics: document.getElementById('batchMetrics'),
    batchResults: document.getElementById('batchResults'),
    logList: document.getElementById('logList'),
    clearLogs: document.getElementById('clearLogs'),
    exportBtn: document.getElementById('exportBtn'),
    importInput: document.getElementById('importInput'),
    importStatus: document.getElementById('importStatus'),
    langToggle: document.getElementById('langToggle')
};

function msg(key, vars) {
    const entry = messages[key];
    let text = entry ? entry.message : key;
    if (vars) {
        Object.keys(vars).forEach((name) => {
            text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), vars[name]);
        });
    }
    return text;
}

async function loadMessages(lang) {
    const url = chrome.runtime.getURL(`_locales/${lang}/messages.json`);
    const response = await fetch(url);
    return response.json();
}

async function setLanguage(lang) {
    currentLang = lang;
    await chrome.storage.local.set({ [LANG_KEY]: lang });
    messages = await loadMessages(lang);
    applyI18n();
    updateGlobalStatus();
    renderRuleList();
    renderScriptList();
    renderLogs();
    updateEditingBadge();
    renderBatchMetricsSnapshot();
}

function applyI18n() {
    document.title = msg('app_name');
    document.documentElement.lang = currentLang === 'en' ? 'en' : 'zh-CN';
    document.querySelectorAll('[data-i18n]').forEach((el) => {
        el.textContent = msg(el.dataset.i18n);
    });
    document.querySelectorAll('[data-placeholder]').forEach((el) => {
        el.placeholder = msg(el.dataset.placeholder);
    });
}

function updateEditingBadge() {
    const label = state.editingRuleId ? msg('editor_badge_editing') : msg('editor_badge_creating');
    elements.editingBadge.textContent = label;
}

function saveState() {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [STATE_KEY]: state.data }, resolve);
    });
}

function loadState() {
    return new Promise((resolve) => {
        chrome.storage.local.get([STATE_KEY, LOGS_KEY, LANG_KEY], (result) => {
            state.data = result[STATE_KEY] || DEFAULT_STATE;
            state.logs = result[LOGS_KEY] || [];
            currentLang = result[LANG_KEY] || 'zh_CN';
            resolve();
        });
    });
}

function saveLogs(logs) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [LOGS_KEY]: logs }, resolve);
    });
}

function showStatus(target, message) {
    if (!target) {
        return;
    }
    target.textContent = message;
}

function updateGlobalStatus() {
    elements.globalEnabled.checked = !!state.data.enabled;
    elements.globalStatus.textContent = state.data.enabled ? msg('status_enabled') : msg('status_disabled');
    elements.ruleCount.textContent = String(state.data.rules.length);
    elements.scriptCount.textContent = String(state.data.scripts.length);
}

function showFieldsForType(type) {
    elements.redirectFields.style.display = type === 'redirect' ? 'block' : 'none';
    elements.blockFields.style.display = type === 'block' ? 'block' : 'none';
    elements.headersFields.style.display = type === 'headers' ? 'block' : 'none';
    elements.mockFields.style.display = type === 'mock' ? 'block' : 'none';
    elements.interceptFields.style.display = type === 'intercept' ? 'block' : 'none';
}

function createHeaderRow(targetList, data = {}) {
    const row = document.createElement('div');
    row.className = 'header-row';

    const headerInput = document.createElement('input');
    headerInput.placeholder = msg('header_placeholder');
    headerInput.value = data.header || '';

    const operationSelect = document.createElement('select');
    ['set', 'remove', 'append'].forEach((operation) => {
        const option = document.createElement('option');
        option.value = operation;
        option.textContent = operation.toUpperCase();
        if (operation === (data.operation || 'set')) {
            option.selected = true;
        }
        operationSelect.appendChild(option);
    });

    const valueInput = document.createElement('input');
    valueInput.placeholder = msg('value_placeholder');
    valueInput.value = data.value || '';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'ghost';
    removeBtn.textContent = msg('action_remove');
    removeBtn.addEventListener('click', () => row.remove());

    row.appendChild(headerInput);
    row.appendChild(operationSelect);
    row.appendChild(valueInput);
    row.appendChild(removeBtn);

    targetList.appendChild(row);
}

function collectHeaders(list) {
    const rows = list.querySelectorAll('.header-row');
    const headers = [];
    rows.forEach((row) => {
        const inputs = row.querySelectorAll('input, select');
        const header = inputs[0].value.trim();
        const operation = inputs[1].value;
        const value = inputs[2].value.trim();
        if (!header) {
            return;
        }
        headers.push({ header, operation, value: value || undefined });
    });
    return headers;
}

function parseJsonValue(text) {
    if (!text || !text.trim()) {
        return null;
    }
    return JSON.parse(text);
}

function matchesUrl(url, match) {
    if (!match || !match.value) {
        return false;
    }
    if (match.type === 'regex') {
        try {
            return new RegExp(match.value).test(url);
        } catch (error) {
            return false;
        }
    }
    if (match.type === 'wildcard') {
        const escaped = match.value.replace(/[.+^${}()|[\\]\\?]/g, '\\$&');
        const regex = new RegExp('^' + escaped.replace(/\*/g, '.*') + '$');
        return regex.test(url);
    }
    return url.includes(match.value);
}

function resetRuleEditor() {
    state.editingRuleId = null;
    updateEditingBadge();
    elements.ruleName.value = '';
    elements.ruleType.value = 'redirect';
    elements.rulePriority.value = 1;
    elements.ruleEnabled.value = 'true';
    elements.ruleMethod.value = '*';
    elements.matchType.value = 'string';
    elements.matchValue.value = '';
    elements.redirectUrl.value = '';
    elements.mockStatus.value = 200;
    elements.mockDelay.value = 0;
    elements.mockContentType.value = 'application/json';
    elements.mockBody.value = '';
    elements.interceptRequestMode.value = 'pass';
    elements.interceptRequestUrl.value = '';
    elements.interceptRequestHeaders.value = '';
    elements.interceptRequestBody.value = '';
    elements.interceptResponseMode.value = 'pass';
    elements.interceptResponseStatus.value = 200;
    elements.interceptDelay.value = 0;
    elements.interceptResponseHeaders.value = '';
    elements.interceptResponseBody.value = '';
    elements.requestHeadersList.innerHTML = '';
    elements.responseHeadersList.innerHTML = '';
    showStatus(elements.ruleStatus, '');
    showFieldsForType('redirect');
}

function resetScriptEditor() {
    state.editingScriptId = null;
    elements.scriptName.value = '';
    elements.scriptRunAt.value = 'document_start';
    elements.scriptEnabled.value = 'true';
    elements.scriptMatchType.value = 'string';
    elements.scriptMatchValue.value = '';
    elements.scriptJs.value = '';
    elements.scriptCss.value = '';
}
function ruleTypeLabel(type) {
    const map = {
        redirect: 'rule_type_redirect',
        block: 'rule_type_block',
        headers: 'rule_type_headers',
        mock: 'rule_type_mock',
        intercept: 'rule_type_intercept'
    };
    return msg(map[type] || type);
}

function matchTypeLabel(type) {
    const map = {
        string: 'match_type_string',
        wildcard: 'match_type_wildcard',
        regex: 'match_type_regex'
    };
    return msg(map[type] || type);
}

function runAtLabel(value) {
    const map = {
        document_start: 'script_runat_start',
        document_end: 'script_runat_ready',
        document_idle: 'script_runat_idle'
    };
    return msg(map[value] || value);
}

function renderRuleList() {
    elements.ruleList.innerHTML = '';
    if (!state.data.rules.length) {
        const empty = document.createElement('p');
        empty.className = 'hint';
        empty.textContent = msg('empty_rules');
        elements.ruleList.appendChild(empty);
        return;
    }

    state.data.rules.forEach((rule) => {
        const card = document.createElement('div');
        card.className = 'rule-card';
        card.draggable = true;
        card.dataset.ruleId = rule.id;

        const info = document.createElement('div');
        const title = document.createElement('h3');
        title.textContent = rule.name || msg('rule_name_label');
        const meta = document.createElement('div');
        meta.className = 'rule-meta';
        meta.innerHTML = `
            <span>${ruleTypeLabel(rule.type)}</span>
            <span>${msg('label_priority')} ${rule.priority || 1}</span>
            <span>${matchTypeLabel(rule.match?.type || 'string')}</span>
            <span>${rule.match?.value || ''}</span>
        `;
        info.appendChild(title);
        info.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'card-actions';

        const toggle = document.createElement('label');
        toggle.className = 'switch';
        const toggleInput = document.createElement('input');
        toggleInput.type = 'checkbox';
        toggleInput.checked = !!rule.enabled;
        const slider = document.createElement('span');
        slider.className = 'slider';
        toggle.appendChild(toggleInput);
        toggle.appendChild(slider);
        toggleInput.addEventListener('change', async () => {
            rule.enabled = toggleInput.checked;
            await saveState();
            renderRuleList();
            updateGlobalStatus();
        });

        const editBtn = document.createElement('button');
        editBtn.className = 'ghost';
        editBtn.textContent = msg('action_edit');
        editBtn.addEventListener('click', () => {
            loadRuleIntoEditor(rule);
            setActiveSection('editor');
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'ghost';
        deleteBtn.textContent = msg('action_delete');
        deleteBtn.addEventListener('click', async () => {
            state.data.rules = state.data.rules.filter((item) => item.id !== rule.id);
            await saveState();
            renderRuleList();
            updateGlobalStatus();
        });

        actions.appendChild(toggle);
        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);

        card.appendChild(info);
        card.appendChild(actions);

        attachDragHandlers(card);
        elements.ruleList.appendChild(card);
    });
}

function attachDragHandlers(card) {
    card.addEventListener('dragstart', () => {
        card.classList.add('dragging');
    });
    card.addEventListener('dragend', async () => {
        card.classList.remove('dragging');
        const ids = Array.from(elements.ruleList.querySelectorAll('.rule-card'))
            .map((item) => Number(item.dataset.ruleId))
            .filter((id) => !Number.isNaN(id));
        state.data.rules.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
        state.data.rules.forEach((rule, index) => {
            rule.priority = index + 1;
        });
        await saveState();
        renderRuleList();
    });
}

function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.rule-card:not(.dragging)')];

    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset, element: child };
        }
        return closest;
    }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
}

function loadRuleIntoEditor(rule) {
    state.editingRuleId = rule.id;
    updateEditingBadge();
    elements.ruleName.value = rule.name || '';
    elements.ruleType.value = rule.type;
    elements.rulePriority.value = rule.priority || 1;
    elements.ruleEnabled.value = rule.enabled ? 'true' : 'false';
    elements.ruleMethod.value = rule.method || '*';
    elements.matchType.value = rule.match?.type || 'string';
    elements.matchValue.value = rule.match?.value || '';
    elements.redirectUrl.value = rule.action?.redirectUrl || '';
    elements.mockStatus.value = rule.action?.mock?.statusCode || 200;
    elements.mockDelay.value = rule.action?.mock?.delay || 0;
    elements.mockContentType.value = rule.action?.mock?.contentType || 'application/json';
    elements.mockBody.value = rule.action?.mock?.body || '';

    elements.interceptRequestMode.value = rule.action?.request?.mode || 'pass';
    elements.interceptRequestUrl.value = rule.action?.request?.url || '';
    elements.interceptRequestHeaders.value = rule.action?.request?.headers
        ? JSON.stringify(rule.action.request.headers, null, 2)
        : '';
    elements.interceptRequestBody.value = rule.action?.request?.body || '';
    elements.interceptResponseMode.value = rule.action?.response?.mode || 'pass';
    elements.interceptResponseStatus.value = rule.action?.response?.statusCode || 200;
    elements.interceptDelay.value = rule.action?.response?.delay || 0;
    elements.interceptResponseHeaders.value = rule.action?.response?.headers
        ? JSON.stringify(rule.action.response.headers, null, 2)
        : '';
    elements.interceptResponseBody.value = rule.action?.response?.body || '';

    elements.requestHeadersList.innerHTML = '';
    elements.responseHeadersList.innerHTML = '';

    (rule.action?.requestHeaders || []).forEach((header) => createHeaderRow(elements.requestHeadersList, header));
    (rule.action?.responseHeaders || []).forEach((header) => createHeaderRow(elements.responseHeadersList, header));

    showFieldsForType(rule.type);
}

function renderScriptList() {
    elements.scriptList.innerHTML = '';
    if (!state.data.scripts.length) {
        const empty = document.createElement('p');
        empty.className = 'hint';
        empty.textContent = msg('empty_scripts');
        elements.scriptList.appendChild(empty);
        return;
    }

    state.data.scripts.forEach((script) => {
        const card = document.createElement('div');
        card.className = 'rule-card';
        const info = document.createElement('div');
        const title = document.createElement('h3');
        title.textContent = script.name || msg('script_name_label');
        const meta = document.createElement('div');
        meta.className = 'rule-meta';
        meta.innerHTML = `
            <span>${runAtLabel(script.runAt)}</span>
            <span>${matchTypeLabel(script.match?.type || 'string')}</span>
            <span>${script.match?.value || ''}</span>
        `;
        info.appendChild(title);
        info.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'card-actions';

        const toggle = document.createElement('label');
        toggle.className = 'switch';
        const toggleInput = document.createElement('input');
        toggleInput.type = 'checkbox';
        toggleInput.checked = !!script.enabled;
        const slider = document.createElement('span');
        slider.className = 'slider';
        toggle.appendChild(toggleInput);
        toggle.appendChild(slider);
        toggleInput.addEventListener('change', async () => {
            script.enabled = toggleInput.checked;
            await saveState();
            renderScriptList();
            updateGlobalStatus();
        });

        const editBtn = document.createElement('button');
        editBtn.className = 'ghost';
        editBtn.textContent = msg('action_edit');
        editBtn.addEventListener('click', () => {
            loadScriptIntoEditor(script);
            setActiveSection('scripts');
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'ghost';
        deleteBtn.textContent = msg('action_delete');
        deleteBtn.addEventListener('click', async () => {
            state.data.scripts = state.data.scripts.filter((item) => item.id !== script.id);
            await saveState();
            renderScriptList();
            updateGlobalStatus();
        });

        actions.appendChild(toggle);
        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);

        card.appendChild(info);
        card.appendChild(actions);

        elements.scriptList.appendChild(card);
    });
}

function loadScriptIntoEditor(script) {
    state.editingScriptId = script.id;
    elements.scriptName.value = script.name || '';
    elements.scriptRunAt.value = script.runAt || 'document_start';
    elements.scriptEnabled.value = script.enabled ? 'true' : 'false';
    elements.scriptMatchType.value = script.match?.type || 'string';
    elements.scriptMatchValue.value = script.match?.value || '';
    elements.scriptJs.value = script.js || '';
    elements.scriptCss.value = script.css || '';
}
function renderLogs() {
    elements.logList.innerHTML = '';
    if (!state.logs.length) {
        const empty = document.createElement('p');
        empty.className = 'hint';
        empty.textContent = msg('empty_logs');
        elements.logList.appendChild(empty);
        return;
    }

    state.logs.forEach((log) => {
        const item = document.createElement('div');
        item.className = 'log-item';
        const title = document.createElement('strong');
        title.textContent = `${log.ruleName || msg('rules_title')} · ${ruleTypeLabel(log.type || 'unknown')}`;
        const url = document.createElement('span');
        url.textContent = log.url || '';
        const time = document.createElement('span');
        time.textContent = log.time ? new Date(log.time).toLocaleString() : '';
        item.appendChild(title);
        item.appendChild(url);
        item.appendChild(time);
        elements.logList.appendChild(item);
    });
}

function runRuleTest() {
    const url = elements.testUrl.value.trim();
    elements.testResults.innerHTML = '';
    if (!url) {
        showStatus(elements.ruleStatus, msg('test_missing_url'));
        return;
    }

    const matches = state.data.rules
        .filter((rule) => matchesUrl(url, rule.match))
        .sort((a, b) => (a.priority || 1) - (b.priority || 1));

    if (!matches.length) {
        const row = document.createElement('div');
        row.className = 'test-row';
        row.textContent = msg('test_no_match');
        elements.testResults.appendChild(row);
        return;
    }

    matches.forEach((rule, index) => {
        const row = document.createElement('div');
        row.className = 'test-row';
        row.innerHTML = `<span>#${index + 1} ${rule.name || msg('rule_name_label')} (${ruleTypeLabel(rule.type)})</span><span>${msg('label_priority')} ${rule.priority || 1}</span>`;
        elements.testResults.appendChild(row);
    });
}

function getNextRuleId() {
    const ids = state.data.rules.map((rule) => rule.id || 0);
    return ids.length ? Math.max(...ids) + 1 : 1;
}

function getNextScriptId() {
    return `script-${Date.now()}`;
}

function updateRulesForType() {
    showFieldsForType(elements.ruleType.value);
}

function validateRule(rule) {
    if (!rule.match.value) {
        return msg('rule_status_missing_url');
    }
    if (rule.match.type === 'regex') {
        try {
            new RegExp(rule.match.value);
        } catch (error) {
            return msg('rule_status_regex_invalid');
        }
    }
    if (rule.type === 'redirect' && !rule.action.redirectUrl) {
        return msg('rule_status_redirect_required');
    }
    return '';
}

async function handleSaveRule() {
    showStatus(elements.ruleStatus, '');

    const rule = {
        id: state.editingRuleId || getNextRuleId(),
        name: elements.ruleName.value.trim() || msg('rule_name_label'),
        type: elements.ruleType.value,
        priority: Number(elements.rulePriority.value) || 1,
        enabled: elements.ruleEnabled.value === 'true',
        method: elements.ruleMethod.value,
        match: {
            type: elements.matchType.value,
            value: elements.matchValue.value.trim()
        },
        action: {}
    };

    if (rule.type === 'redirect') {
        rule.action.redirectUrl = elements.redirectUrl.value.trim();
    }

    if (rule.type === 'headers') {
        rule.action.requestHeaders = collectHeaders(elements.requestHeadersList);
        rule.action.responseHeaders = collectHeaders(elements.responseHeadersList);
    }

    if (rule.type === 'mock') {
        rule.action.mock = {
            statusCode: Number(elements.mockStatus.value) || 200,
            contentType: elements.mockContentType.value.trim() || 'application/json',
            body: elements.mockBody.value,
            delay: Number(elements.mockDelay.value) || 0
        };
    }

    if (rule.type === 'intercept') {
        let requestHeaders = null;
        let responseHeaders = null;
        try {
            requestHeaders = parseJsonValue(elements.interceptRequestHeaders.value);
            responseHeaders = parseJsonValue(elements.interceptResponseHeaders.value);
        } catch (error) {
            showStatus(elements.ruleStatus, msg('intercept_headers_invalid'));
            return;
        }

        rule.action.request = {
            mode: elements.interceptRequestMode.value,
            url: elements.interceptRequestUrl.value.trim() || undefined,
            headers: requestHeaders || undefined,
            body: elements.interceptRequestBody.value || undefined
        };
        rule.action.response = {
            mode: elements.interceptResponseMode.value,
            statusCode: Number(elements.interceptResponseStatus.value) || 200,
            headers: responseHeaders || undefined,
            body: elements.interceptResponseBody.value || undefined,
            delay: Number(elements.interceptDelay.value) || 0
        };
    }

    const validationError = validateRule(rule);
    if (validationError) {
        showStatus(elements.ruleStatus, validationError);
        return;
    }

    if (state.editingRuleId) {
        const index = state.data.rules.findIndex((item) => item.id === state.editingRuleId);
        if (index !== -1) {
            state.data.rules[index] = rule;
        }
    } else {
        state.data.rules.push(rule);
    }

    await saveState();
    renderRuleList();
    updateGlobalStatus();
    resetRuleEditor();
}

async function handleSaveScript() {
    const script = {
        id: state.editingScriptId || getNextScriptId(),
        name: elements.scriptName.value.trim() || msg('script_name_label'),
        runAt: elements.scriptRunAt.value,
        enabled: elements.scriptEnabled.value === 'true',
        match: {
            type: elements.scriptMatchType.value,
            value: elements.scriptMatchValue.value.trim()
        },
        js: elements.scriptJs.value,
        css: elements.scriptCss.value
    };

    if (state.editingScriptId) {
        const index = state.data.scripts.findIndex((item) => item.id === state.editingScriptId);
        if (index !== -1) {
            state.data.scripts[index] = script;
        }
    } else {
        state.data.scripts.push(script);
    }

    await saveState();
    renderScriptList();
    updateGlobalStatus();
    resetScriptEditor();
}

async function handleExport() {
    const data = JSON.stringify(state.data, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'request-response-tool.json';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

async function handleImport(event) {
    const file = event.target.files[0];
    if (!file) {
        return;
    }
    try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        state.data = {
            enabled: parsed.enabled !== false,
            rules: Array.isArray(parsed.rules) ? parsed.rules : [],
            scripts: Array.isArray(parsed.scripts) ? parsed.scripts : []
        };
        await saveState();
        renderRuleList();
        renderScriptList();
        updateGlobalStatus();
        showStatus(elements.importStatus, msg('import_success'));
    } catch (error) {
        showStatus(elements.importStatus, msg('import_fail'));
    } finally {
        event.target.value = '';
        setTimeout(() => {
            showStatus(elements.importStatus, '');
        }, 2000);
    }
}

function parseCsv(text) {
    const rows = [];
    let current = '';
    let inQuotes = false;
    let row = [];

    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        const next = text[i + 1];

        if (char === '"') {
            if (inQuotes && next === '"') {
                current += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            row.push(current);
            current = '';
        } else if ((char === '\n' || char === '\r') && !inQuotes) {
            if (char === '\r' && next === '\n') {
                i += 1;
            }
            row.push(current);
            current = '';
            if (row.length > 1 || row[0]) {
                rows.push(row);
            }
            row = [];
        } else {
            current += char;
        }
    }
    if (current || row.length) {
        row.push(current);
        rows.push(row);
    }

    if (!rows.length) {
        return [];
    }

    const headers = rows.shift().map((header) => header.trim());
    return rows.map((values) => {
        const entry = {};
        headers.forEach((header, index) => {
            entry[header] = values[index] !== undefined ? values[index] : '';
        });
        return entry;
    });
}

async function parseBatchFile(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.csv')) {
        const text = await file.text();
        return parseCsv(text);
    }
    if (name.endsWith('.json')) {
        const text = await file.text();
        const parsed = JSON.parse(text);
        return Array.isArray(parsed) ? parsed : [];
    }
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        return XLSX.utils.sheet_to_json(sheet, { defval: '' });
    }
    return [];
}

function applyTemplate(text, row, index) {
    if (!text) {
        return '';
    }
    return String(text).replace(/\{\{(.*?)\}\}/g, (match, key) => {
        const trimmed = key.trim();
        if (trimmed === 'index') {
            return String(index + 1);
        }
        return row[trimmed] !== undefined ? String(row[trimmed]) : '';
    });
}

async function sendBatchRequest(row, index) {
    const url = applyTemplate(elements.batchUrl.value.trim(), row, index);
    if (!url) {
        throw new Error(msg('batch_missing_url'));
    }

    let headers = {};
    if (elements.batchHeaders.value.trim()) {
        const headerText = applyTemplate(elements.batchHeaders.value, row, index);
        headers = JSON.parse(headerText);
    }

    const method = elements.batchMethod.value;
    let body = applyTemplate(elements.batchBody.value, row, index);
    if (method === 'GET' || method === 'HEAD') {
        body = undefined;
    }

    const controller = new AbortController();
    const timeout = Number(elements.batchTimeout.value) || 15000;
    const timer = setTimeout(() => controller.abort(), timeout);
    const start = performance.now();

    try {
        const response = await fetch(url, {
            method,
            headers,
            body: body || undefined,
            signal: controller.signal
        });
        const text = await response.text();
        const duration = Math.round(performance.now() - start);
        return {
            ok: response.ok,
            status: response.status,
            duration,
            preview: text.slice(0, 200)
        };
    } finally {
        clearTimeout(timer);
    }
}
function renderBatchResults() {
    elements.batchResults.innerHTML = '';
    const recent = state.batch.results.slice(0, 20);
    recent.forEach((result) => {
        const card = document.createElement('div');
        card.className = 'batch-card';
        card.innerHTML = `
            <strong>#${result.index + 1} ${result.statusText}</strong>
            <span>${result.url}</span>
            <span>${result.duration}ms · ${result.status}</span>
            <span>${result.preview}</span>
        `;
        elements.batchResults.appendChild(card);
    });
}

function renderBatchMetrics(total, completed, success, failed) {
    elements.batchMetrics.textContent = msg('batch_metrics_template', {
        total,
        completed,
        success,
        failed
    });
}

function renderBatchMetricsSnapshot() {
    if (!state.batch.results.length) {
        elements.batchMetrics.textContent = '';
    }
}

async function runBatch() {
    if (state.batch.running) {
        return;
    }

    if (!state.batch.rows.length) {
        showStatus(elements.batchStatus, msg('batch_status_need_file'));
        return;
    }

    showStatus(elements.batchStatus, msg('batch_status_running'));
    state.batch.running = true;
    state.batch.abort = false;
    state.batch.results = [];

    const concurrency = Math.max(1, Number(elements.batchConcurrency.value) || 1);
    const total = state.batch.rows.length;
    let completed = 0;
    let success = 0;
    let failed = 0;
    let index = 0;

    renderBatchMetrics(total, completed, success, failed);
    renderBatchResults();

    const worker = async () => {
        while (!state.batch.abort) {
            const currentIndex = index;
            if (currentIndex >= total) {
                break;
            }
            index += 1;
            const row = state.batch.rows[currentIndex];
            try {
                const result = await sendBatchRequest(row, currentIndex);
                completed += 1;
                if (result.ok) {
                    success += 1;
                } else {
                    failed += 1;
                }
                state.batch.results.unshift({
                    index: currentIndex,
                    statusText: result.ok ? msg('batch_result_ok') : msg('batch_result_failed'),
                    url: applyTemplate(elements.batchUrl.value.trim(), row, currentIndex),
                    duration: result.duration,
                    status: result.status,
                    preview: result.preview
                });
            } catch (error) {
                completed += 1;
                failed += 1;
                state.batch.results.unshift({
                    index: currentIndex,
                    statusText: msg('batch_result_error'),
                    url: applyTemplate(elements.batchUrl.value.trim(), row, currentIndex),
                    duration: 0,
                    status: 'ERR',
                    preview: error.message || msg('batch_unknown_error')
                });
            }
            renderBatchMetrics(total, completed, success, failed);
            renderBatchResults();
        }
    };

    await Promise.all(Array.from({ length: concurrency }, worker));

    state.batch.running = false;
    showStatus(elements.batchStatus, state.batch.abort ? msg('batch_status_stopped') : msg('batch_status_completed'));
}

async function handleBatchFile(event) {
    const file = event.target.files[0];
    if (!file) {
        return;
    }
    try {
        state.batch.rows = await parseBatchFile(file);
        showStatus(elements.batchStatus, msg('batch_status_load_rows', { count: state.batch.rows.length }));
    } catch (error) {
        showStatus(elements.batchStatus, msg('batch_status_parse_fail'));
    }
}

function setActiveSection(sectionId) {
    document.querySelectorAll('.panel[data-section]').forEach((panel) => {
        panel.classList.toggle('active', panel.dataset.section === sectionId);
    });
    document.querySelectorAll('.nav-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.section === sectionId);
    });
}

async function initialize() {
    await loadState();
    messages = await loadMessages(currentLang);
    applyI18n();
    updateGlobalStatus();
    renderRuleList();
    renderScriptList();
    renderLogs();
    resetRuleEditor();
    resetScriptEditor();
    updateRulesForType();
    setActiveSection('rules');

    elements.ruleList.addEventListener('dragover', (event) => {
        event.preventDefault();
        const dragging = elements.ruleList.querySelector('.dragging');
        if (!dragging) {
            return;
        }
        const afterElement = getDragAfterElement(elements.ruleList, event.clientY);
        if (!afterElement) {
            elements.ruleList.appendChild(dragging);
        } else if (afterElement !== dragging) {
            elements.ruleList.insertBefore(dragging, afterElement);
        }
    });

    document.querySelectorAll('.nav-btn').forEach((btn) => {
        btn.addEventListener('click', () => setActiveSection(btn.dataset.section));
    });
}

document.addEventListener('DOMContentLoaded', initialize);

elements.globalEnabled.addEventListener('change', async () => {
    state.data.enabled = elements.globalEnabled.checked;
    await saveState();
    updateGlobalStatus();
});

elements.newRuleBtn.addEventListener('click', () => {
    resetRuleEditor();
    setActiveSection('editor');
});

elements.ruleType.addEventListener('change', updateRulesForType);

elements.addRequestHeader.addEventListener('click', () => createHeaderRow(elements.requestHeadersList));

elements.addResponseHeader.addEventListener('click', () => createHeaderRow(elements.responseHeadersList));

elements.resetRule.addEventListener('click', resetRuleEditor);

elements.saveRule.addEventListener('click', handleSaveRule);

elements.runTest.addEventListener('click', runRuleTest);

elements.newScriptBtn.addEventListener('click', () => {
    resetScriptEditor();
    setActiveSection('scripts');
});

elements.resetScript.addEventListener('click', resetScriptEditor);

elements.saveScript.addEventListener('click', handleSaveScript);

elements.batchFile.addEventListener('change', handleBatchFile);

elements.batchStart.addEventListener('click', runBatch);

elements.batchStop.addEventListener('click', () => {
    state.batch.abort = true;
    showStatus(elements.batchStatus, msg('batch_status_stopping'));
});

elements.clearLogs.addEventListener('click', async () => {
    state.logs = [];
    await saveLogs([]);
    renderLogs();
});

elements.exportBtn.addEventListener('click', handleExport);

elements.importInput.addEventListener('change', handleImport);

elements.langToggle.addEventListener('click', () => {
    const next = currentLang === 'zh_CN' ? 'en' : 'zh_CN';
    setLanguage(next);
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') {
        return;
    }
    if (changes[STATE_KEY]) {
        state.data = changes[STATE_KEY].newValue || DEFAULT_STATE;
        updateGlobalStatus();
        renderRuleList();
        renderScriptList();
    }
    if (changes[LOGS_KEY]) {
        state.logs = changes[LOGS_KEY].newValue || [];
        renderLogs();
    }
    if (changes[LANG_KEY]) {
        const nextLang = changes[LANG_KEY].newValue || 'zh_CN';
        if (nextLang !== currentLang) {
            setLanguage(nextLang);
        }
    }
});
