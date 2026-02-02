const STATE_KEY = 'rrt_state';
const LOGS_KEY = 'rrt_logs';

const DEFAULT_STATE = {
  enabled: true,
  rules: [],
  groups: [],
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

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toNonCapturingGroups(pattern) {
  let result = '';
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '\\') {
      result += char;
      i += 1;
      if (i < pattern.length) {
        result += pattern[i];
      }
      continue;
    }
    if (char === '[') {
      inClass = true;
      result += char;
      continue;
    }
    if (char === ']' && inClass) {
      inClass = false;
      result += char;
      continue;
    }
    if (char === '(' && !inClass) {
      const nextChar = pattern[i + 1];
      if (nextChar !== '?') {
        result += '(?:';
        continue;
      }
    }
    result += char;
  }
  return result;
}

function matchToRegexFragment(match) {
  if (!match || !match.value) {
    return null;
  }

  if (match.type === 'regex') {
    let fragment = match.value;
    if (fragment.startsWith('^')) {
      fragment = fragment.slice(1);
    }
    if (fragment.endsWith('$')) {
      fragment = fragment.slice(0, -1);
    }
    return toNonCapturingGroups(fragment);
  }

  const escaped = escapeRegex(match.value);
  if (match.type === 'wildcard') {
    return escaped.replace(/\\\*/g, '.*');
  }
  return escaped;
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
  const groups = state.groups || [];
  const enabledGroupIds = new Set(groups.filter(g => g.enabled).map(g => g.id));

  return (state.rules || [])
    .filter((rule) => {
      if (!rule.enabled) return false;
      if (rule.groupId && !enabledGroupIds.has(rule.groupId)) return false;

      // Rules that must be handled by JS interceptor:
      // 1. Type is 'intercept'
      // 2. Type is 'mock' AND has a delay (DNR cannot delay)
      if (rule.type === 'intercept') return true;
      if (rule.type === 'mock' && rule.action?.mock?.delay > 0) return true;
      return false;
    })
    .sort((a, b) => (a.priority || 1) - (b.priority || 1));
}

async function applyDynamicRules(state) {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map((rule) => rule.id);

  if (!state.enabled) {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: [] });
    return;
  }

  const groups = state.groups || [];
  const enabledGroupIds = new Set(groups.filter(g => g.enabled).map(g => g.id));
  const addRules = [];

  for (const rule of state.rules || []) {
    if (!rule.enabled) continue;
    if (rule.groupId && !enabledGroupIds.has(rule.groupId)) continue;
    
    // Skip rules handled by JS interceptor
    if (rule.type === 'intercept') continue;
    if (rule.type === 'mock' && rule.action?.mock?.delay > 0) continue;

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

    if (rule.method && rule.method !== '*') {
      condition.requestMethods = [rule.method.toUpperCase()];
    }

    let action = null;
    if (rule.type === 'redirect') {
      if (!rule.action) continue;

      if (rule.action.redirectMode === 'replace') {
         // String replacement mode
         // We must use regexFilter to support this via DNR
         // Transform "substring" match to regex: .*substring.*
         // And substitution to: \1newstring\2
         const find = rule.action.redirectFind || '';
         const replace = rule.action.redirectReplace || '';
         
         if (!find) continue;

         // We need to capture the part before and after the 'find' string
         // Regex: ^(.*)(find)(.*)$
         const escapedFind = escapeRegex(find);
         const matchFragment = matchToRegexFragment(rule.match);
         if (matchFragment) {
           condition.regexFilter = `^((?:.|\\n)*?(?:${matchFragment})(?:.|\\n)*?)${escapedFind}((?:.|\\n)*)$`;
         } else {
           condition.regexFilter = `^((?:.|\\n)*?)${escapedFind}((?:.|\\n)*)$`;
         }
         delete condition.urlFilter; // regexFilter takes precedence/exclusive

         action = {
            type: 'redirect',
            redirect: { regexSubstitution: `\\1${replace}\\2` }
         };

      } else if (rule.action.redirectUrl) {
         action = {
           type: 'redirect',
           redirect: { url: rule.action.redirectUrl }
         };
      }
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
    const escaped = match.value.replace(/[.+^${}()|[\]\\?]/g, '\\$&');
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
      const escaped = match.value.replace(/[.+^${}()|[\]\\?]/g, '\\$&');
      const regex = new RegExp('^' + escaped.replace(/\*/g, '.*') + '$');
      return regex.test(url);
    }
    return url.includes(match.value);
  };

  const matchMethod = (method, ruleMethod) => {
    if (!ruleMethod || ruleMethod === '*') {
      return true;
    }
    return (method || 'GET').toUpperCase() === ruleMethod.toUpperCase();
  };

  const pickRule = (url, method) => {
    const candidates = getRules();
    for (const rule of candidates) {
      if (matchUrl(url, rule.match) && matchMethod(method, rule.method)) {
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

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    const method = request.method;
    const rule = pickRule(url, method);
    
    if (!rule) {
      return originalFetch(input, init);
    }

    const requestAction = rule.action?.request || { mode: 'pass' };
    if (requestAction.mode === 'block') {
      return Promise.reject(new Error('Blocked by Request Response Tool'));
    }

    // Determine Delay
    let delay = 0;
    if (rule.type === 'mock') {
        delay = rule.action?.mock?.delay || 0;
    } else if (rule.type === 'intercept') {
        delay = rule.action?.response?.delay || 0;
    }

    if (delay > 0) {
        await sleep(delay);
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

    // Prepare Request
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

    // Check for Mock Rule (Intercept type or Mock type)
    if (rule.type === 'mock') {
         // This is a delayed mock rule handled by JS
         const mockData = rule.action?.mock || {};
         return new Response(mockData.body || '', {
            status: Number(mockData.statusCode) || 200,
            headers: { 'Content-Type': mockData.contentType || 'application/json' }
         });
    }

    const responseAction = rule.action?.response || { mode: 'pass' };

    if (responseAction.mode === 'mock') {
      return new Response(responseAction.body || '', {
        status: Number(responseAction.statusCode) || 200,
        headers: responseAction.headers || {}
      });
    }

    const response = await originalFetch(nextRequest);

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
    this.__rrt = { method, url, async, user, password, headers: {} };
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
    if (this.__rrt && this.__rrt.headers) {
      this.__rrt.headers[header] = value;
    }
    return originalSetRequestHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function(body) {
    const meta = this.__rrt || {};
    const rule = meta.url ? pickRule(meta.url, meta.method) : null;

    if (!rule) {
      return originalSend.call(this, body);
    }

    const requestAction = rule.action?.request || { mode: 'pass' };
    if (requestAction.mode === 'block') {
      this.abort();
      this.dispatchEvent(new Event('error'));
      return undefined;
    }

    // Delay Logic for XHR
    let delay = 0;
    if (rule.type === 'mock') {
        delay = rule.action?.mock?.delay || 0;
    } else if (rule.type === 'intercept') {
        delay = rule.action?.response?.delay || 0;
    }

    const proceed = () => {
        let nextUrl = meta.url;
        let nextBody = body;
        if (requestAction.mode === 'modify') {
          if (requestAction.url) {
            nextUrl = requestAction.url;
          }
          if (requestAction.body !== undefined) {
            nextBody = requestAction.body;
          }
        }
    
        if (nextUrl !== meta.url) {
          originalOpen.call(this, meta.method, nextUrl, meta.async, meta.user, meta.password);
          if (meta.headers) {
            Object.keys(meta.headers).forEach((key) => {
              originalSetRequestHeader.call(this, key, meta.headers[key]);
            });
          }
        }
    
        if (requestAction.mode === 'modify' && requestAction.headers && typeof requestAction.headers === 'object') {
          Object.keys(requestAction.headers).forEach((key) => {
            const value = requestAction.headers[key];
            if (value !== null && value !== undefined) {
              originalSetRequestHeader.call(this, key, String(value));
            }
          });
        }
        
        // Mock Handling
        if (rule.type === 'mock') {
          const mockData = rule.action?.mock || {};
          const mockBody = mockData.body || '';
          const mockStatus = Number(mockData.statusCode) || 200;
          const mockContentType = mockData.contentType || 'application/json';
          try {
            Object.defineProperty(this, 'readyState', { get: () => 4 });
            Object.defineProperty(this, 'status', { get: () => mockStatus });
            Object.defineProperty(this, 'responseText', { get: () => mockBody });
            Object.defineProperty(this, 'response', { get: () => mockBody });
            Object.defineProperty(this, 'getResponseHeader', {
              value: (name) => (name && name.toLowerCase() === 'content-type' ? mockContentType : null)
            });
          } catch (error) {
            return originalSend.call(this, nextBody);
          }

          setTimeout(() => {
            this.dispatchEvent(new Event('readystatechange'));
            this.dispatchEvent(new Event('load'));
          }, 10);
          return;
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

    if (delay > 0) {
        sleep(delay).then(proceed);
    } else {
        proceed();
    }
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
