// background.js

// 监听扩展图标的点击事件
chrome.action.onClicked.addListener((tab) => {
  // 打开配置页面 (config.html)
  chrome.tabs.create({
    url: chrome.runtime.getURL("config.html")
  });
});
