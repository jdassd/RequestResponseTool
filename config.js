// config.js

document.addEventListener('DOMContentLoaded', () => {
    const apiUrlInput = document.getElementById('apiUrl');
    const enableLogsCheckbox = document.getElementById('enableLogs');
    const saveBtn = document.getElementById('saveBtn');
    const statusDiv = document.getElementById('status');

    // 加载保存的设置
    chrome.storage.local.get(['apiUrl', 'enableLogs'], (result) => {
        if (result.apiUrl) {
            apiUrlInput.value = result.apiUrl;
        }
        if (result.enableLogs !== undefined) {
            enableLogsCheckbox.checked = result.enableLogs;
        }
    });

    // 保存设置
    saveBtn.addEventListener('click', () => {
        const apiUrl = apiUrlInput.value;
        const enableLogs = enableLogsCheckbox.checked;

        chrome.storage.local.set({
            apiUrl: apiUrl,
            enableLogs: enableLogs
        }, () => {
            // 显示保存成功消息
            statusDiv.textContent = 'Options saved.';
            statusDiv.className = 'success';
            
            setTimeout(() => {
                statusDiv.textContent = '';
                statusDiv.className = '';
            }, 2000);
        });
    });
});
