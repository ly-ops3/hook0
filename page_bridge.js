(() => {
  if (window.__resourceSaverBridgeInstalled) {
    return;
  }
  window.__resourceSaverBridgeInstalled = true;

  const EVENT_NAME = "__resource_saver_payload__";
  const CONTROL_SOURCE = "resource-saver-extension";

  const applyActiveState = (active) => {
    window.postMessage(
      {
        source: CONTROL_SOURCE,
        type: "set-capture-active",
        active: Boolean(active)
      },
      "*"
    );
  };

  const syncActiveState = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: "page-ready" });
      applyActiveState(Boolean(response?.active));
    } catch {}
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "set-capture-active") {
      applyActiveState(message.active);
      sendResponse({ ok: true });
    }
    return true;
  });

  window.addEventListener(EVENT_NAME, (event) => {
    chrome.runtime.sendMessage({
      type: "capture-payload",
      payload: event.detail
    }).catch(() => {});
  });

  syncActiveState();
})();
