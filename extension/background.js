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
  flushQueue();
});

chrome.runtime.onStartup.addListener(flushQueue);

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
  setBadge(result.queued ? "…" : "✓", result.queued ? "#f9c76b" : "#41e2b7");
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

async function saveClip(payload) {
  try {
    await postClip(payload);
    return { ok: true, queued: false };
  } catch (error) {
    if (error.permanent)
      return { ok: false, queued: false, message: error.message };
    const stored = await chrome.storage.local.get("mindbossQueue");
    const queue = Array.isArray(stored.mindbossQueue)
      ? stored.mindbossQueue
      : [];
    if (!queue.some((item) => item.id === payload.id)) queue.push(payload);
    await chrome.storage.local.set({ mindbossQueue: queue.slice(-100) });
    return {
      ok: true,
      queued: true,
      message: "Saved offline. The clipper will retry next time Chrome starts.",
    };
  }
}

async function flushQueue() {
  const stored = await chrome.storage.local.get("mindbossQueue");
  const queue = Array.isArray(stored.mindbossQueue) ? stored.mindbossQueue : [];
  if (!queue.length) return { sent: 0, remaining: 0 };
  const remaining = [];
  let sent = 0;
  for (const payload of queue) {
    try {
      await postClip(payload);
      sent += 1;
    } catch (error) {
      if (!error.permanent) remaining.push(payload);
    }
  }
  await chrome.storage.local.set({ mindbossQueue: remaining });
  if (sent) setBadge("✓", "#41e2b7");
  return { sent, remaining: remaining.length };
}

function setBadge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 1800);
}
