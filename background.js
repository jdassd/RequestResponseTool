const STATE_KEY = 'rrt_state';
const LOGS_KEY = 'rrt_logs';

const DEFAULT_STATE = {
  enabled: true,
  rules: [],
  scripts: []
};

function getState() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STATE_KEY], (result) => {
      resolve(result[STATE_KEY] || DEFAULT_STATE);
    });
  });
}

function setState(state) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STATE_KEY]: state }, resolve);
  });
}

function toUrlFilter(match) {
  if (!match || !match.value) {
    return null;
  }
  if (match.type === 'regex') {
    return { regexFilter: match.value };
  }
  return { urlFilter: match.value };
}

function buildDataUrl(mock) {
  const contentType = (mock && mock.contentType) ? mock.contentType : 'application/json';
  const body = (mock && mock.body) ? mock.body : '';
  const encoded = encodeURIComponent(body);
  return `data:${contentType};charset=utf-8,${encoded}`;
}

function getInterceptRules(state) {
  return (state.rules || [])
    .filter((rule) => rule.enabled && rule.type === 'intercept')
    .sort((a, b) => (a.priority || 1) - (b.priority || 1));
}

async function applyDynamicRules(state) {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map((rule) => rule.id);

  if (!state.enabled) {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: [] });
    return;
  }

  const addRules = [];
  for (const rule of state.rules || []) {
    if (!rule.enabled || rule.type === 'intercept') {
      continue;
    }

    const match = toUrlFilter(rule.match);
    if (!match) {
      continue;
    }

    const condition = {
      ...match,
      resourceTypes: [
        'main_frame',
        'sub_frame',
        'xmlhttprequest',
        'script',
        'stylesheet',
        'image',
        'font',
        'media',
        'object',
        'ping',
        'other'
      ]
    };

    let action = null;
    if (rule.type === 'redirect') {
      if (!rule.action || !rule.action.redirectUrl) {
        continue;
      }
      action = {
        type: 'redirect',
        redirect: { url: rule.action.redirectUrl }
      };
    } else if (rule.type === 'block') {
      action = { type: 'block' };
    } else if (rule.type === 'headers') {
      const requestHeaders = (rule.action?.requestHeaders || []).map((item) => ({
        header: item.header,
        operation: item.operation,
        value: item.value || undefined
      }));
      const responseHeaders = (rule.action?.responseHeaders || []).map((item) => ({
        header: item.header,
        operation: item.operation,
        value: item.value || undefined
      }));

      action = {
        type: 'modifyHeaders',
        requestHeaders,
        responseHeaders
      };
    } else if (rule.type === 'mock') {
      const dataUrl = buildDataUrl(rule.action?.mock || {});
      action = {
        type: 'redirect',
        redirect: { url: dataUrl }
      };
    }

    if (!action) {
      continue;
    }

    addRules.push({
      id: rule.id,
      priority: rule.priority || 1,
      action,
      condition
    });
  }

  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
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
    const escaped = match.value.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp('^' + escaped.replace(/\*/g, '.*') + '$');
    return regex.test(url);
  }
  return url.includes(match.value);
}

async function injectScriptsForTab(tabId, url, runAt) {
  const state = await getState();
  if (!state.enabled) {
    return;
  }

  const scripts = state.scripts || [];
  for (const script of scripts) {
    if (!script.enabled) {
      continue;
    }
    if (script.runAt !== runAt) {
      continue;
    }
    if (!matchesUrl(url, script.match)) {
      continue;
    }

    const jsCode = (script.js || '').trim();
    const cssCode = (script.css || '').trim();

    if (cssCode) {
      chrome.scripting.insertCSS({
        target: { tabId },
        css: cssCode
      });
    }

    if (jsCode) {
      chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: (source) => {
          const scriptEl = document.createElement('script');
          scriptEl.textContent = source;
          document.documentElement.appendChild(scriptEl);
          scriptEl.remove();
        },
        args: [jsCode]
      });
    }
  }
}

function installInterceptors(rules) {
  const getRules = () => Array.isArray(window.__rrtInterceptors) ? window.__rrtInterceptors : [];

  const matchUrl = (url, match) => {
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
      const escaped = match.value.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp('^' + escaped.replace(/\*/g, '.*') + '$');
      return regex.test(url);
    }
    return url.includes(match.value);
  };

  const pickRule = (url) => {
    const candidates = getRules();
    for (const rule of candidates) {
      if (matchUrl(url, rule.match)) {
        return rule;
      }
    }
    return null;
  };

  const applyHeaders = (headers, updates) => {
    if (!updates || typeof updates !== 'object') {
      return headers;
    }
    const next = new Headers(headers || {});
    Object.keys(updates).forEach((key) => {
      const value = updates[key];
      if (value === null || value === undefined) {
        next.delete(key);
      } else {
        next.set(key, String(value));
      }
    });
    return next;
  };

  const applyBodyTemplate = (template, body) => {
    if (template === undefined || template === null) {
      return body;
    }
    const templateText = String(template);
    if (templateText.includes('{{body}}')) {
      return templateText.replace(/\{\{body\}\}/g, body || '');
    }
    return templateText;
  };

  if (window.__rrtInterceptorInstalled) {
    window.__rrtInterceptors = rules || [];
    return;
  }

  window.__rrtInterceptors = rules || [];
  window.__rrtInterceptorInstalled = true;

  const originalFetch = window.fetch;
  window.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init || {});
    const url = request.url;
    const rule = pickRule(url);
    if (!rule) {
      return originalFetch(input, init);
    }

    const requestAction = rule.action?.request || { mode: 'pass' };
    if (requestAction.mode === 'block') {
      return Promise.reject(new Error('Blocked by Request Response Tool'));
    }

    let nextUrl = url;
    let headers = new Headers(request.headers);
    let body = init && init.body !== undefined ? init.body : undefined;

    if (requestAction.mode === 'modify') {
      if (requestAction.url) {
        nextUrl = requestAction.url;
      }
      if (requestAction.headers) {
        headers = applyHeaders(headers, requestAction.headers);
      }
      if (requestAction.body !== undefined) {
        body = requestAction.body;
      }
    }

    const nextRequest = new Request(nextUrl, {
      method: request.method,
      headers,
      body,
      cache: request.cache,
      credentials: request.credentials,
      integrity: request.integrity,
      keepalive: request.keepalive,
      mode: request.mode,
      redirect: request.redirect,
      referrer: request.referrer,
      referrerPolicy: request.referrerPolicy,
      signal: request.signal
    });

    const response = await originalFetch(nextRequest);
    const responseAction = rule.action?.response || { mode: 'pass' };

    if (responseAction.mode === 'mock') {
      return new Response(responseAction.body || '', {
        status: Number(responseAction.statusCode) || 200,
        headers: responseAction.headers || {}
      });
    }

    if (responseAction.mode === 'modify') {
      const originalText = await response.text();
      const nextBody = applyBodyTemplate(responseAction.body, originalText);
      const nextHeaders = applyHeaders(response.headers, responseAction.headers);
      const status = Number(responseAction.statusCode) || response.status;
      return new Response(nextBody, { status, headers: nextHeaders });
    }

    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
    this.__rrt = { method, url, async, user, password };
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function(body) {
    const meta = this.__rrt || {};
    const rule = meta.url ? pickRule(meta.url) : null;

    if (!rule) {
      return originalSend.call(this, body);
    }

    const requestAction = rule.action?.request || { mode: 'pass' };
    if (requestAction.mode === 'block') {
      this.abort();
      this.dispatchEvent(new Event('error'));
      return undefined;
    }

    let nextUrl = meta.url;
    let nextBody = body;
    if (requestAction.mode === 'modify') {
      if (requestAction.url) {
        nextUrl = requestAction.url;
      }
      if (requestAction.body !== undefined) {
        nextBody = requestAction.body;
      }
      if (requestAction.headers && typeof requestAction.headers === 'object') {
        Object.keys(requestAction.headers).forEach((key) => {
          const value = requestAction.headers[key];
          if (value !== null && value !== undefined) {
            originalSetRequestHeader.call(this, key, String(value));
          }
        });
      }
    }

    if (nextUrl !== meta.url) {
      originalOpen.call(this, meta.method, nextUrl, meta.async, meta.user, meta.password);
    }

    const responseAction = rule.action?.response || { mode: 'pass' };
    if (responseAction.mode === 'mock' || responseAction.mode === 'modify') {
      this.addEventListener('readystatechange', () => {
        if (this.readyState !== 4) {
          return;
        }
        const originalText = this.responseText || '';
        const nextBody = responseAction.mode === 'mock'
          ? (responseAction.body || '')
          : applyBodyTemplate(responseAction.body, originalText);
        try {
          Object.defineProperty(this, 'responseText', { get: () => nextBody });
          Object.defineProperty(this, 'response', { get: () => nextBody });
          if (responseAction.statusCode) {
            Object.defineProperty(this, 'status', { get: () => Number(responseAction.statusCode) || 200 });
          }
        } catch (error) {
          return;
        }
      });
    }

    return originalSend.call(this, nextBody);
  };
}

async function injectInterceptorsForTab(tabId) {
  const state = await getState();
  const rules = state.enabled ? getInterceptRules(state) : [];

  chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: installInterceptors,
    args: [rules]
  });
}

async function refreshInterceptorsOnTabs() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id) {
      injectInterceptorsForTab(tab.id);
    }
  }
}

async function appendLog(entry) {
  const result = await chrome.storage.local.get([LOGS_KEY]);
  const logs = result[LOGS_KEY] || [];
  logs.unshift(entry);
  logs.splice(200);
  await chrome.storage.local.set({ [LOGS_KEY]: logs });
}

async function initialize() {
  const state = await getState();
  await setState(state);
  await applyDynamicRules(state);
  await refreshInterceptorsOnTabs();
}

chrome.runtime.onInstalled.addListener(() => {
  initialize();
});

chrome.runtime.onStartup.addListener(() => {
  initialize();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[STATE_KEY]) {
    return;
  }
  const nextState = changes[STATE_KEY].newValue || DEFAULT_STATE;
  applyDynamicRules(nextState);
  refreshInterceptorsOnTabs();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab || !tab.url) {
    return;
  }
  if (changeInfo.status === 'loading') {
    injectScriptsForTab(tabId, tab.url, 'document_start');
    injectInterceptorsForTab(tabId);
  }
  if (changeInfo.status === 'complete') {
    injectScriptsForTab(tabId, tab.url, 'document_end');
    injectScriptsForTab(tabId, tab.url, 'document_idle');
  }
});

chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(async (details) => {
  const state = await getState();
  const ruleId = details.rule?.ruleId;
  const matchedRule = (state.rules || []).find((rule) => rule.id === ruleId);
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    time: new Date().toISOString(),
    url: details.request?.url || '',
    tabId: details.request?.tabId,
    ruleId: ruleId,
    ruleName: matchedRule ? matchedRule.name : `Rule ${ruleId || ''}`,
    type: matchedRule ? matchedRule.type : 'unknown'
  };
  appendLog(entry);
});
