const STATE_KEY = 'rrt_state';

const elements = {
    enabled: document.getElementById('popupEnabled'),
    rules: document.getElementById('popupRules'),
    scripts: document.getElementById('popupScripts'),
    openDashboard: document.getElementById('openDashboard')
};

function loadState() {
    return new Promise((resolve) => {
        chrome.storage.local.get([STATE_KEY], (result) => {
            resolve(result[STATE_KEY] || { enabled: true, rules: [], scripts: [] });
        });
    });
}

function saveState(state) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [STATE_KEY]: state }, resolve);
    });
}

async function refresh() {
    const state = await loadState();
    elements.enabled.checked = !!state.enabled;
    elements.rules.textContent = String(state.rules?.length || 0);
    elements.scripts.textContent = String(state.scripts?.length || 0);
}

elements.enabled.addEventListener('change', async () => {
    const state = await loadState();
    state.enabled = elements.enabled.checked;
    await saveState(state);
});

elements.openDashboard.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('config.html') });
});

document.addEventListener('DOMContentLoaded', refresh);
