(() => {
  if (window.__resourceSaverMainHookInstalled) {
    return;
  }
  window.__resourceSaverMainHookInstalled = true;

  const EVENT_NAME = "__resource_saver_payload__";
  const CONTROL_SOURCE = "resource-saver-extension";

  window.__resourceSaverState = window.__resourceSaverState || {
    active: false
  };

  const MAX_CAPTURE_CHARS = 2 * 1024 * 1024;
  const defer = (fn) => {
    window.setTimeout(fn, 0);
  };

  const dispatchPayload = (payload) => {
    if (!window.__resourceSaverState?.active) {
      return;
    }
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: payload }));
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window) {
      return;
    }
    if (event.data?.source !== CONTROL_SOURCE) {
      return;
    }
    if (event.data.type === "set-capture-active") {
      window.__resourceSaverState = window.__resourceSaverState || {};
      window.__resourceSaverState.active = Boolean(event.data.active);
    }
  });

  if (typeof window.fetch === "function") {
    const originalFetch = window.fetch;
    window.fetch = async function resourceSaverFetch(...args) {
      const response = await originalFetch.apply(this, args);
      defer(async () => {
        try {
          if (!window.__resourceSaverState?.active) {
            return;
          }
          const request = args[0];
          const url =
            typeof request === "string"
              ? request
              : request && typeof request.url === "string"
                ? request.url
                : response.url;
          const contentType = response.headers.get("content-type") || "";
          const body = await response.clone().text();
          if (body.length > MAX_CAPTURE_CHARS) {
            dispatchPayload({
              channel: "fetch",
              url,
              pageUrl: location.href,
              contentType,
              body: "",
              skippedReason: `body too large: ${body.length}`
            });
            return;
          }
          dispatchPayload({
            channel: "fetch",
            url,
            pageUrl: location.href,
            contentType,
            body
          });
        } catch {}
      });
      return response;
    };
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function resourceSaverOpen(method, url, ...rest) {
    this.__resourceSaverUrl = typeof url === "string" ? url : String(url || "");
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function resourceSaverSend(...args) {
    this.addEventListener(
      "load",
      function resourceSaverOnLoad() {
        defer(() => {
          try {
            if (!window.__resourceSaverState?.active) {
              return;
            }
            const contentType = this.getResponseHeader("content-type") || "";
            const body = typeof this.responseText === "string" ? this.responseText : "";
            if (body.length > MAX_CAPTURE_CHARS) {
              dispatchPayload({
                channel: "xhr",
                url: this.responseURL || this.__resourceSaverUrl || "",
                pageUrl: location.href,
                contentType,
                body: "",
                skippedReason: `body too large: ${body.length}`
              });
              return;
            }
            dispatchPayload({
              channel: "xhr",
              url: this.responseURL || this.__resourceSaverUrl || "",
              pageUrl: location.href,
              contentType,
              body
            });
          } catch {}
        });
      },
      { once: true }
    );

    return originalSend.apply(this, args);
  };
})();
