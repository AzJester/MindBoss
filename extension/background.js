const DEFAULT_ENDPOINT = "https://mindboss.st-dba.com";
const MENU_ID = "mindboss-save";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Save to Mind Boss",
      contexts: ["page", "selection", "link", "image"],
    });
  });
  chrome.alarms.create("mindboss-retry", { periodInMinutes: 1 });
  flushQueue();
});

chrome.runtime.onStartup.addListener(flushQueue);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "mindboss-retry") void flushQueue();
});
let queueOperation = Promise.resolve();
function serialized(action) {
  const next = queueOperation.then(action, action);
  queueOperation = next.catch(() => undefined);
  return next;
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.url) return;
  const selection = info.selectionText || "";
  const sourceUrl = info.linkUrl || info.srcUrl || tab.url;
  const body =
    selection ||
    (info.linkUrl
      ? "Saved link"
      : info.srcUrl
        ? "Saved image reference"
        : "Saved from Chrome");
  const result = await saveClip({
    id: crypto.randomUUID(),
    kind: "note",
    title: tab.title || "Web capture",
    body,
    sourceUrl,
    sourceTitle: tab.title || "",
    tagNames: [],
  });
  setBadge(
    !result.ok ? "!" : result.queued ? "…" : "✓",
    !result.ok || result.queued ? "#f9c76b" : "#41e2b7",
  );
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "saveClip") {
    saveClip(message.payload)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, message: error.message }));
    return true;
  }
  if (message?.type === "flushQueue") {
    flushQueue().then(sendResponse);
    return true;
  }
});

async function getConfig() {
  const values = await chrome.storage.local.get([
    "mindbossEndpoint",
    "mindbossToken",
  ]);
  return {
    endpoint: String(values.mindbossEndpoint || DEFAULT_ENDPOINT).replace(
      /\/$/,
      "",
    ),
    token: String(values.mindbossToken || ""),
  };
}

async function postClip(payload) {
  const { endpoint, token } = await getConfig();
  if (endpoint !== DEFAULT_ENDPOINT)
    throw new Error("Only the Mind Boss app address is supported.");
  if (!token)
    throw new Error("Open the clipper and connect it to Mind Boss first.");
  const response = await fetch(`${endpoint}/api/v1/clips`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": payload.id,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(
      body?.error?.message || `Mind Boss returned ${response.status}.`,
    );
    error.permanent =
      response.status === 401 ||
      response.status === 403 ||
      response.status === 400;
    throw error;
  }
  return response.json();
}

function saveClip(payload) {
  return serialized(async () => {
    const stored = await chrome.storage.local.get("mindbossQueue");
    const queue = Array.isArray(stored.mindbossQueue)
      ? stored.mindbossQueue
      : [];
    if (queue.length >= 500)
      return {
        ok: false,
        queued: false,
        message:
          "The clip queue is full. Open the clipper and retry existing captures first. Nothing was discarded.",
      };
    if (!queue.some((item) => item.id === payload.id)) queue.push(payload);
    await chrome.storage.local.set({ mindbossQueue: queue });
    try {
      await postClip(payload);
      await chrome.storage.local.set({
        mindbossQueue: queue.filter((item) => item.id !== payload.id),
      });
      return { ok: true, queued: false };
    } catch (error) {
      payload.queueError = error.message;
      await chrome.storage.local.set({ mindbossQueue: queue });
      return {
        ok: true,
        queued: true,
        message:
          "Saved on this device, not yet in your account. " +
          error.message +
          " Retry from the clipper after reconnecting.",
      };
    }
  });
}

function flushQueue() {
  return serialized(async () => {
    const stored = await chrome.storage.local.get("mindbossQueue");
    const queue = Array.isArray(stored.mindbossQueue)
      ? stored.mindbossQueue
      : [];
    let sent = 0;
    const remaining = [];
    for (const payload of queue) {
      try {
        await postClip(payload);
        sent++;
      } catch (error) {
        remaining.push({ ...payload, queueError: error.message });
      }
    }
    await chrome.storage.local.set({ mindbossQueue: remaining });
    setBadge(
      remaining.length ? String(remaining.length) : sent ? "✓" : "",
      remaining.length ? "#f9c76b" : "#41e2b7",
    );
    return {
      sent,
      remaining: remaining.length,
      message: remaining[0]?.queueError,
    };
  });
}

function setBadge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  if (text === "✓")
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 1800);
}
