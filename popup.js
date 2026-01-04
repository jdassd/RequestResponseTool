const STATE_KEY = 'rrt_state';
const LANG_KEY = 'rrt_lang';

let currentLang = 'zh_CN';
let messages = {};

const elements = {
    enabled: document.getElementById('popupEnabled'),
    rules: document.getElementById('popupRules'),
    scripts: document.getElementById('popupScripts'),
    openDashboard: document.getElementById('openDashboard')
};

function msg(key) {
    const entry = messages[key];
    return entry ? entry.message : key;
}

async function loadMessages(lang) {
    const url = chrome.runtime.getURL(`_locales/${lang}/messages.json`);
    const response = await fetch(url);
    return response.json();
}

function applyI18n() {
    document.title = msg('app_name');
    document.documentElement.lang = currentLang === 'en' ? 'en' : 'zh-CN';
    document.querySelectorAll('[data-i18n]').forEach((el) => {
        el.textContent = msg(el.dataset.i18n);
    });
}

function loadState() {
    return new Promise((resolve) => {
        chrome.storage.local.get([STATE_KEY, LANG_KEY], (result) => {
            resolve({
                state: result[STATE_KEY] || { enabled: true, rules: [], scripts: [] },
                lang: result[LANG_KEY] || 'zh_CN'
            });
        });
    });
}

function saveState(state) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [STATE_KEY]: state }, resolve);
    });
}

async function refresh() {
    const { state, lang } = await loadState();
    if (lang !== currentLang) {
        currentLang = lang;
        messages = await loadMessages(currentLang);
        applyI18n();
    }
    elements.enabled.checked = !!state.enabled;
    elements.rules.textContent = String(state.rules?.length || 0);
    elements.scripts.textContent = String(state.scripts?.length || 0);
}

elements.enabled.addEventListener('change', async () => {
    const { state } = await loadState();
    state.enabled = elements.enabled.checked;
    await saveState(state);
});

elements.openDashboard.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('config.html') });
});

document.addEventListener('DOMContentLoaded', async () => {
    const { lang } = await loadState();
    currentLang = lang;
    messages = await loadMessages(currentLang);
    applyI18n();
    refresh();
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') {
        return;
    }
    if (changes[STATE_KEY] || changes[LANG_KEY]) {
        refresh();
    }
});
