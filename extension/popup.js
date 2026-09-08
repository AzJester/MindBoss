const elements = Object.fromEntries(
  [
    "setup",
    "capture",
    "endpoint",
    "token",
    "connect",
    "hostname",
    "pageTitle",
    "pageUrl",
    "selection",
    "note",
    "tags",
    "settings",
    "save",
    "status",
  ].map((id) => [id, document.getElementById(id)]),
);
let currentTab;

initialize().catch((error) => showStatus(error.message, "error"));

async function initialize() {
  const stored = await chrome.storage.local.get([
    "mindbossEndpoint",
    "mindbossToken",
  ]);
  elements.endpoint.value =
    stored.mindbossEndpoint || "https://mindboss.st-dba.com";
  if (!stored.mindbossToken) {
    showSetup();
    return;
  }
  await showCapture();
  chrome.runtime.sendMessage({ type: "flushQueue" });
}

function showSetup() {
  elements.setup.hidden = false;
  elements.capture.hidden = true;
  elements.status.textContent = "";
}

async function showCapture() {
  elements.setup.hidden = true;
  elements.capture.hidden = false;
  elements.status.textContent = "";
  [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!currentTab?.url || !/^https?:/i.test(currentTab.url)) {
    elements.save.disabled = true;
    showStatus(
      "Chrome does not allow clipping this protected page.",
      "warning",
    );
    return;
  }
  const url = new URL(currentTab.url);
  elements.hostname.textContent = url.hostname
    .replace(/^www\./, "")
    .toUpperCase();
  elements.pageTitle.textContent = currentTab.title || "Untitled page";
  elements.pageUrl.textContent = currentTab.url;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      func: () => window.getSelection()?.toString() || "",
    });
    elements.selection.value = result?.result || "";
  } catch {
    elements.selection.value = "";
  }
}

elements.connect.addEventListener("click", async () => {
  const endpoint = elements.endpoint.value.trim().replace(/\/$/, "");
  const token = elements.token.value.trim();
  if (!/^https:\/\//.test(endpoint) || !token.startsWith("mbc_")) {
    showStatus("Enter the HTTPS app address and a valid mbc_ token.", "error");
    return;
  }
  await chrome.storage.local.set({
    mindbossEndpoint: endpoint,
    mindbossToken: token,
  });
  elements.token.value = "";
  await showCapture();
});

elements.settings.addEventListener("click", showSetup);

elements.save.addEventListener("click", async () => {
  elements.save.disabled = true;
  elements.save.textContent = "Saving…";
  const selected = elements.selection.value.trim();
  const note = elements.note.value.trim();
  const body =
    [note, selected ? `Selected from the page:\n${selected}` : ""]
      .filter(Boolean)
      .join("\n\n") || "Saved from Chrome";
  const result = await chrome.runtime.sendMessage({
    type: "saveClip",
    payload: {
      id: crypto.randomUUID(),
      kind: "note",
      title: currentTab.title || "Web capture",
      body,
      sourceUrl: currentTab.url,
      sourceTitle: currentTab.title || "",
      tagNames: elements.tags.value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    },
  });
  if (result?.ok) {
    showStatus(
      result.queued ? result.message : "Saved to Mind Boss.",
      result.queued ? "warning" : "success",
    );
    elements.note.value = "";
    elements.tags.value = "";
    if (!result.queued) setTimeout(() => window.close(), 650);
  } else showStatus(result?.message || "Could not save this clip.", "error");
  elements.save.disabled = false;
  elements.save.textContent = "Save to Mind Boss";
});

function showStatus(message, kind) {
  elements.status.textContent = message;
  elements.status.className = kind;
}
