async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderDebugEvents(events = []) {
  const container = $("debugList");
  if (!events.length) {
    container.innerHTML = '<div class="debugItem">暫無事件。開始抓取後，這裡會顯示攔截和保存情況。</div>';
    return;
  }

  container.innerHTML = events.map((item) => {
    const detailParts = [];
    if (item.contentType) detailParts.push(`content-type: ${item.contentType}`);
    if (typeof item.bodyLength === "number") detailParts.push(`body: ${item.bodyLength} chars`);
    if (item.url) detailParts.push(`url: ${item.url}`);
    if (item.fileName) detailParts.push(`file: ${item.fileName}`);
    if (item.detail) detailParts.push(`detail: ${item.detail}`);

    return `
      <div class="debugItem ${escapeHtml(item.kind || "info")}">
        <div class="debugMeta">
          <span class="debugKind ${escapeHtml(item.kind || "info")}">${escapeHtml(item.kind || "info")}</span>
          <span>${escapeHtml(item.at || "")}</span>
        </div>
        <div>${escapeHtml(item.message || "")}</div>
        ${detailParts.length ? `<div class="debugDetail">${escapeHtml(detailParts.join(" | "))}</div>` : ""}
      </div>
    `;
  }).join("");
}

async function refreshStatus() {
  const tab = await getActiveTab();
  if (!tab?.id) {
    $("tabInfo").textContent = "無可用標籤頁";
    renderDebugEvents([]);
    return;
  }

  $("tabInfo").textContent = `${tab.title || "未命名"} (#${tab.id})`;

  const response = await chrome.runtime.sendMessage({
    type: "get-status",
    tabId: tab.id
  });

  const settings = response?.settings || {};
  const session = response?.session;

  $("rootFolder").value = session?.rootFolder || settings.rootFolder || "HanyuResourceSaver";
  $("statusText").textContent = session?.active ? "正在抓取" : "未啟用";
  $("savedCount").textContent = String(session?.savedCount || 0);
  $("lastError").textContent = session?.lastError || "無";
  renderDebugEvents(session?.debugEvents || []);
}

async function startCapture() {
  const tab = await getActiveTab();
  if (!tab?.id) {
    return;
  }

  await chrome.runtime.sendMessage({
    type: "start-capture",
    tabId: tab.id,
    rootFolder: $("rootFolder").value.trim()
  });

  await refreshStatus();
}

async function stopCapture() {
  const tab = await getActiveTab();
  if (!tab?.id) {
    return;
  }

  await chrome.runtime.sendMessage({
    type: "stop-capture",
    tabId: tab.id
  });

  await refreshStatus();
}

document.addEventListener("DOMContentLoaded", async () => {
  $("startButton").addEventListener("click", startCapture);
  $("stopButton").addEventListener("click", stopCapture);
  $("refreshButton").addEventListener("click", refreshStatus);

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "status-updated") {
      refreshStatus();
    }
  });

  await refreshStatus();
});
