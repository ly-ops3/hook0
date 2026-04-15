const DEFAULT_ROOT = "HanyuResourceSaver";
const MAX_DEBUG_EVENTS = 40;

const sessions = new Map();

function sanitizeName(value, fallback = "unknown") {
  let text = String(value ?? "").trim();
  try {
    text = decodeURIComponent(text);
  } catch {
    text = text.trim();
  }
  text = text.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/g, "");
  return text || fallback;
}

function guessExtension(contentType, pathname) {
  const pathPart = pathname || "";
  const matched = pathPart.match(/\.([a-z0-9]{1,8})$/i);
  if (matched) {
    return `.${matched[1]}`;
  }

  const mimeMap = {
    "application/json": ".json",
    "text/json": ".json",
    "application/javascript": ".js",
    "text/javascript": ".js",
    "text/plain": ".txt",
    "text/html": ".html"
  };
  return mimeMap[contentType] || ".json";
}

function hashText(text) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 33 + text.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function buildJsonPath(url, contentType, rootFolder) {
  const parsed = new URL(url);
  const dictionaryCode = sanitizeName(parsed.searchParams.get("dictionaryCode"), "unknown");
  const entryName = sanitizeName(parsed.searchParams.get("entryName"), "");

  if (entryName) {
    return `${rootFolder}/json/${dictionaryCode}_${entryName}${guessExtension(contentType, parsed.pathname)}`;
  }

  const host = sanitizeName(parsed.host, "unknown-host");
  const base = sanitizeName(parsed.pathname.split("/").filter(Boolean).pop() || "response");
  const extension = guessExtension(contentType, parsed.pathname);
  const suffix = parsed.search ? `_${hashText(parsed.search)}` : "";
  return `${rootFolder}/json/${host}_${base}${suffix}${extension}`;
}

function toBase64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function makeDownloadUrl(payload) {
  const mime = payload.contentType || "application/json";
  const base64 = toBase64Utf8(payload.body);
  return `data:${mime};base64,${base64}`;
}

function pushDebugEvent(session, kind, message, extra = {}) {
  const item = {
    at: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
    kind,
    message,
    ...extra
  };
  session.debugEvents.unshift(item);
  if (session.debugEvents.length > MAX_DEBUG_EVENTS) {
    session.debugEvents.length = MAX_DEBUG_EVENTS;
  }
}

function createSession(rootFolder) {
  return {
    active: true,
    savedCount: 0,
    rootFolder,
    seenKeys: new Set(),
    lastError: "",
    debugEvents: []
  };
}

async function loadSettings() {
  const stored = await chrome.storage.local.get({
    rootFolder: DEFAULT_ROOT
  });
  return {
    rootFolder: stored.rootFolder || DEFAULT_ROOT
  };
}

async function saveSettings(patch) {
  await chrome.storage.local.set(patch);
}

async function notifyPopup() {
  const snapshot = {};
  for (const [tabId, session] of sessions.entries()) {
    snapshot[tabId] = {
      active: session.active,
      savedCount: session.savedCount,
      rootFolder: session.rootFolder,
      lastError: session.lastError || "",
      debugEvents: session.debugEvents
    };
  }
  await chrome.runtime.sendMessage({ type: "status-updated", snapshot }).catch(() => {});
}

async function ensureScriptsInjected(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    files: ["page_hook_main.js"]
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["page_bridge.js"]
  });
}

async function setCaptureActive(tabId, active) {
  await chrome.tabs.sendMessage(tabId, {
    type: "set-capture-active",
    active
  });
}

async function startCapture(tabId, rootFolder) {
  const session = sessions.get(tabId) || createSession(rootFolder);
  session.active = true;
  session.rootFolder = rootFolder;
  session.lastError = "";
  session.seenKeys.clear();
  if (!sessions.has(tabId)) {
    sessions.set(tabId, session);
  }

  pushDebugEvent(session, "info", "開始抓取，準備注入頁面腳本");

  try {
    await ensureScriptsInjected(tabId);
    await setCaptureActive(tabId, true);
    pushDebugEvent(session, "ok", "頁面 hook 已啟用");
  } catch (error) {
    session.lastError = error?.message || String(error);
    pushDebugEvent(session, "error", "啟用 hook 失敗", { detail: session.lastError });
  }

  await notifyPopup();
}

async function stopCapture(tabId) {
  const session = sessions.get(tabId);
  if (!session) {
    return;
  }

  try {
    await ensureScriptsInjected(tabId);
    await setCaptureActive(tabId, false);
    pushDebugEvent(session, "info", "已停止抓取");
  } catch (error) {
    session.lastError = error?.message || String(error);
    pushDebugEvent(session, "error", "停止抓取時通知頁面失敗", { detail: session.lastError });
  }

  sessions.delete(tabId);
  await notifyPopup();
}

async function savePayload(tabId, payload) {
  const session = sessions.get(tabId);
  if (!session || !session.active) {
    return;
  }

  const urlText = String(payload.url || "");
  const pageUrl = String(payload.pageUrl || "");
  const body = String(payload.body || "");
  const skippedReason = String(payload.skippedReason || "");
  const contentType = String(payload.contentType || "").split(";", 1)[0].trim().toLowerCase();
  const channel = String(payload.channel || "unknown");

  pushDebugEvent(session, "seen", `${channel} ${urlText || "(empty url)"}`, {
    contentType: contentType || "(empty)",
    bodyLength: body.length
  });

  if (!urlText) {
    pushDebugEvent(session, "skip", "跳過：空 URL");
    await notifyPopup();
    return;
  }

  if (skippedReason) {
    pushDebugEvent(session, "skip", "跳過：頁面端主動略過", {
      detail: skippedReason,
      url: urlText
    });
    await notifyPopup();
    return;
  }

  if (!contentType.includes("json") && !urlText.includes("entryName=")) {
    pushDebugEvent(session, "skip", "跳過：不是 JSON，也沒有 entryName", {
      contentType
    });
    await notifyPopup();
    return;
  }

  if (!body) {
    pushDebugEvent(session, "skip", "跳過：body 為空");
    await notifyPopup();
    return;
  }

  const dedupeKey = `${channel}|${urlText}|${body.length}`;
  if (session.seenKeys.has(dedupeKey)) {
    pushDebugEvent(session, "skip", "跳過：疑似重複響應", { url: urlText });
    await notifyPopup();
    return;
  }
  session.seenKeys.add(dedupeKey);

  let parsedUrl;
  try {
    parsedUrl = new URL(urlText, pageUrl || "https://placeholder.local/");
  } catch (error) {
    session.lastError = error?.message || String(error);
    pushDebugEvent(session, "error", "URL 解析失敗", {
      detail: session.lastError,
      url: urlText
    });
    await notifyPopup();
    return;
  }

  const normalizedUrl =
    urlText.startsWith("http://") || urlText.startsWith("https://")
      ? parsedUrl.toString()
      : parsedUrl.toString();

  const normalizedPayload = {
    url: normalizedUrl,
    contentType: contentType || "application/json",
    body
  };

  let fileName;
  try {
    fileName = buildJsonPath(normalizedPayload.url, normalizedPayload.contentType, session.rootFolder);
  } catch (error) {
    session.lastError = error?.message || String(error);
    pushDebugEvent(session, "error", "生成文件名失敗", {
      detail: session.lastError,
      url: normalizedPayload.url
    });
    await notifyPopup();
    return;
  }

  try {
    const downloadUrl = makeDownloadUrl(normalizedPayload);
    await chrome.downloads.download({
      url: downloadUrl,
      filename: fileName,
      conflictAction: "uniquify",
      saveAs: false
    });
    session.savedCount += 1;
    session.lastError = "";
    pushDebugEvent(session, "save", `已保存 ${fileName}`, {
      url: normalizedPayload.url,
      fileName
    });
  } catch (error) {
    session.lastError = error?.message || String(error);
    pushDebugEvent(session, "error", "保存失敗", {
      detail: session.lastError,
      fileName
    });
  }

  await notifyPopup();
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!sessions.has(tabId) || changeInfo.status !== "loading") {
    return;
  }

  const session = sessions.get(tabId);
  if (!session) {
    return;
  }

  pushDebugEvent(session, "info", "頁面進入 loading，等待新文檔接管 hook");
  try {
    await ensureScriptsInjected(tabId);
    await setCaptureActive(tabId, true);
    pushDebugEvent(session, "ok", "新文檔已重新啟用 hook");
  } catch (error) {
    pushDebugEvent(session, "skip", "loading 階段尚未可通信，等待 page-ready 同步", {
      detail: error?.message || String(error)
    });
  }
  await notifyPopup();
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (sessions.has(tabId)) {
    sessions.delete(tabId);
    await notifyPopup();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === "start-capture") {
      const tabId = message.tabId;
      const rootFolder = message.rootFolder || DEFAULT_ROOT;
      await saveSettings({ rootFolder });
      await startCapture(tabId, rootFolder);
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "stop-capture") {
      await stopCapture(message.tabId);
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "capture-payload") {
      const tabId = sender.tab?.id;
      if (typeof tabId === "number") {
        await savePayload(tabId, message.payload || {});
      }
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "page-ready") {
      const tabId = sender.tab?.id;
      const session = typeof tabId === "number" ? sessions.get(tabId) : null;
      if (session) {
        pushDebugEvent(session, "info", "頁面 bridge 已就緒");
        await notifyPopup();
      }
      sendResponse({
        ok: true,
        active: Boolean(session?.active)
      });
      return;
    }

    if (message?.type === "get-status") {
      const settings = await loadSettings();
      const session = sessions.get(message.tabId);
      sendResponse({
        ok: true,
        session: session
          ? {
              active: session.active,
              savedCount: session.savedCount,
              rootFolder: session.rootFolder,
              lastError: session.lastError || "",
              debugEvents: session.debugEvents
            }
          : null,
        settings
      });
    }
  })();

  return true;
});
