const { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, nativeImage, Menu, Tray } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const { uIOhook, UiohookKey } = require("uiohook-napi");

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");

const POLL_MS = 700;
const PASTE_ADVANCE_DELAY_MS = 180;
const MIN_HISTORY_LIMIT = 10;
const MAX_HISTORY_LIMIT = 1000;
const DEFAULT_SETTINGS = {
  minimizeToTray: true,
  closeToTray: true,
  startAtLogin: false,
  autoAdvanceAfterPaste: true,
  historyLimit: 20,
  openShortcut: ""
};

let mainWindow;
let tray;
let history = [];
let copyQueue = [];
let groupRecords = [];
let settings = { ...DEFAULT_SETTINGS };
let lastSignature = "";
let pollTimer;
let pasteAdvanceTimer;
let lastPasteHotkeyAt = 0;
let isQuitting = false;

function makeId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clampHistoryLimit(value) {
  const limit = Number(value);
  if (!Number.isInteger(limit)) return DEFAULT_SETTINGS.historyLimit;
  return Math.min(MAX_HISTORY_LIMIT, Math.max(MIN_HISTORY_LIMIT, limit));
}

function normalizeSettings(raw) {
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    minimizeToTray: Boolean(raw?.minimizeToTray ?? DEFAULT_SETTINGS.minimizeToTray),
    closeToTray: Boolean(raw?.closeToTray ?? DEFAULT_SETTINGS.closeToTray),
    startAtLogin: Boolean(raw?.startAtLogin ?? DEFAULT_SETTINGS.startAtLogin),
    autoAdvanceAfterPaste: Boolean(raw?.autoAdvanceAfterPaste ?? DEFAULT_SETTINGS.autoAdvanceAfterPaste),
    historyLimit: clampHistoryLimit(raw?.historyLimit ?? DEFAULT_SETTINGS.historyLimit),
    openShortcut: normalizeShortcut(raw?.openShortcut ?? DEFAULT_SETTINGS.openShortcut)
  };
}

function normalizeShortcut(value) {
  return String(value || "")
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("+");
}

function getSettingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function getGroupsPath() {
  return path.join(app.getPath("userData"), "group-records.json");
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function loadSettings() {
  settings = normalizeSettings(readJson(getSettingsPath(), DEFAULT_SETTINGS));
}

function saveSettings() {
  writeJson(getSettingsPath(), settings);
}

function loadGroupRecords() {
  const raw = readJson(getGroupsPath(), []);
  groupRecords = Array.isArray(raw)
    ? raw
        .map((record) => ({
          id: record.id || makeId(),
          name: String(record.name || "").trim(),
          items: Array.isArray(record.items) ? record.items.map((item) => String(item || "").trim()).filter(Boolean) : [],
          createdAt: record.createdAt || Date.now(),
          updatedAt: record.updatedAt || record.createdAt || Date.now()
        }))
        .filter((record) => record.name && record.items.length > 0)
    : [];
}

function saveGroupRecords() {
  writeJson(getGroupsPath(), groupRecords);
}

function getIconPath() {
  return path.join(__dirname, "assets", "icon.ico");
}

function getAppIcon() {
  const iconPath = getIconPath();
  if (fs.existsSync(iconPath)) return iconPath;
  return undefined;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 760,
    height: 820,
    minWidth: 640,
    minHeight: 640,
    backgroundColor: "#f7f3ee",
    title: "剪贴板助手",
    icon: getAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  mainWindow.on("minimize", (event) => {
    if (!settings.minimizeToTray) return;
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    if (!settings.closeToTray) {
      isQuitting = true;
      return;
    }
    event.preventDefault();
    mainWindow.hide();
  });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  mainWindow.show();
  mainWindow.focus();
}

function navigateTo(page) {
  showMainWindow();
  mainWindow.webContents.send("navigate-page", page);
}

function applyLoginSetting() {
  if (!app.isReady()) return;
  app.setLoginItemSettings({
    openAtLogin: Boolean(settings.startAtLogin),
    openAsHidden: true
  });
}

function createAppMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: "剪切板",
      click: () => navigateTo("clipboard")
    },
    {
      label: "设置",
      click: () => navigateTo("settings")
    },
    {
      label: "组记录",
      click: () => navigateTo("groups")
    },
    {
      label: "退出",
      click: () => {
        isQuitting = true;
        app.quit();
      }
    },
    {
      label: "帮助",
      submenu: [{ label: "暂空", enabled: false }]
    }
  ]);

  Menu.setApplicationMenu(menu);
}

function createTrayIcon() {
  const iconPath = getAppIcon();
  tray = iconPath ? new Tray(iconPath) : new Tray(nativeImage.createEmpty());
  tray.setToolTip("剪贴板助手");
  tray.on("click", showMainWindow);
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;

  const menu = Menu.buildFromTemplate([
    { label: "打开剪贴板", click: () => navigateTo("clipboard") },
    { label: "打开设置", click: () => navigateTo("settings") },
    { label: "打开组记录", click: () => navigateTo("groups") },
    {
      label: "手动复制队列下一条",
      enabled: getQueueCount() > 0,
      click: () => copyNextQueueValue()
    },
    { type: "separator" },
    {
      label: settings.minimizeToTray ? "最小化到托盘：开" : "最小化到托盘：关",
      click: () => updateSettings({ minimizeToTray: !settings.minimizeToTray })
    },
    {
      label: settings.startAtLogin ? "开机自启：开" : "开机自启：关",
      click: () => updateSettings({ startAtLogin: !settings.startAtLogin })
    },
    {
      label: settings.autoAdvanceAfterPaste ? "粘贴后自动推进：开" : "粘贴后自动推进：关",
      click: () => updateSettings({ autoAdvanceAfterPaste: !settings.autoAdvanceAfterPaste })
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(menu);
}

function updateSettings(patch) {
  const previousShortcut = settings.openShortcut;
  const nextSettings = normalizeSettings({ ...settings, ...patch });
  settings = nextSettings;
  if (previousShortcut !== settings.openShortcut && !registerOpenShortcut()) {
    settings.openShortcut = previousShortcut;
    registerOpenShortcut();
    throw new Error("快捷键已被占用或不可用");
  }
  saveSettings();
  applyLoginSetting();
  enforceHistoryLimit();
  updateTrayMenu();
  broadcastState();
  return settings;
}

function registerOpenShortcut() {
  globalShortcut.unregisterAll();
  const shortcut = settings.openShortcut;
  if (!shortcut) return true;
  return globalShortcut.register(shortcut, () => {
    navigateTo("clipboard");
  });
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function itemSignature(item) {
  if (!item) return "";
  const payload = item.type === "image" ? item.imageDataUrl : item.content || item.importPath;
  return `${item.type}:${hash(payload || "")}`;
}

function toPreview(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 160);
}

function queuePreview(item) {
  if (!item) return "";
  if (item.type === "image") return "图片";
  return toPreview(item.content);
}

function addTextHistoryItem(content, sourceKind) {
  const text = String(content || "");
  if (!text.trim()) return null;
  return addHistoryItem({
    type: "text",
    content: text,
    preview: toPreview(text),
    sourceKind
  });
}

function addImportHistoryItem(filePath) {
  return addHistoryItem({
    type: "import",
    content: filePath,
    importPath: filePath,
    preview: filePath,
    sourceKind: "import"
  });
}

function cloneQueueItem(item, source) {
  return {
    id: makeId(),
    type: item.type,
    content: item.content,
    imageDataUrl: item.imageDataUrl,
    preview: item.type === "image" ? "图片" : toPreview(item.content),
    source,
    createdAt: Date.now()
  };
}

function textQueueItem(value, source) {
  const content = String(value ?? "").trim();
  if (!content) return null;
  return {
    id: makeId(),
    type: "text",
    content,
    preview: toPreview(content),
    source,
    createdAt: Date.now()
  };
}

function getClipboardSnapshot() {
  const formats = clipboard.availableFormats();
  const hasImage = formats.some((format) => format.toLowerCase().includes("image"));

  if (hasImage) {
    const image = clipboard.readImage();
    if (!image.isEmpty()) {
      return {
        id: makeId(),
        type: "image",
        imageDataUrl: image.toDataURL(),
        preview: "图片",
        fixedPosition: null,
        createdAt: Date.now()
      };
    }
  }

  const text = clipboard.readText();
  if (!text) return null;

  return {
    id: makeId(),
    type: "text",
    content: text,
    preview: toPreview(text),
    fixedPosition: null,
    createdAt: Date.now()
  };
}

function getFixedItemsByPosition() {
  return history
    .filter((item) => Number.isInteger(item.fixedPosition) && item.fixedPosition > 0)
    .sort((a, b) => a.fixedPosition - b.fixedPosition);
}

function composeHistory(items) {
  const fixed = getFixedItemsByPositionFrom(items);
  const fixedIds = new Set(fixed.map((item) => item.id));
  const loose = items.filter((item) => !fixedIds.has(item.id));
  const result = [];
  const maxPosition = Math.max(items.length, ...fixed.map((item) => item.fixedPosition), 0);

  for (let position = 1; position <= maxPosition; position += 1) {
    const fixedItem = fixed.find((item) => item.fixedPosition === position);
    if (fixedItem) {
      result.push(fixedItem);
    } else if (loose.length > 0) {
      result.push(loose.shift());
    }
  }

  return result.concat(loose);
}

function getFixedItemsByPositionFrom(items) {
  return items
    .filter((item) => Number.isInteger(item.fixedPosition) && item.fixedPosition > 0)
    .sort((a, b) => a.fixedPosition - b.fixedPosition);
}

function enforceHistoryLimit() {
  history = composeHistory(history);

  while (history.length > settings.historyLimit) {
    let removeIndex = -1;
    for (let index = history.length - 1; index >= 0; index -= 1) {
      if (!history[index].fixedPosition) {
        removeIndex = index;
        break;
      }
    }
    if (removeIndex === -1) break;
    history.splice(removeIndex, 1);
    history = composeHistory(history);
  }
}

function addHistoryItem(rawItem) {
  const nextItem = {
    ...rawItem,
    id: makeId(),
    fixedPosition: null,
    createdAt: Date.now()
  };

  const signature = itemSignature(nextItem);
  const existingIndex = history.findIndex((item) => itemSignature(item) === signature);

  if (existingIndex !== -1) {
    const existing = history[existingIndex];
    if (existing.fixedPosition) return existing;
    history.splice(existingIndex, 1);
  }

  history = composeHistory([nextItem, ...history]);
  enforceHistoryLimit();
  return nextItem;
}

function removeExactTextFromHistory(text) {
  const content = String(text || "");
  if (!content) return;
  history = history.filter((item) => item.type !== "text" || item.content !== content);
}

function buildSequenceWithFixedItems(normalItems) {
  const fixedByPosition = new Map(getFixedItemsByPosition().map((item) => [item.fixedPosition, cloneQueueItem(item, `固定位置 ${item.fixedPosition}`)]));
  const sequence = [];
  let normalIndex = 0;
  let position = 1;

  while (normalIndex < normalItems.length || fixedByPosition.has(position)) {
    if (fixedByPosition.has(position)) {
      sequence.push(fixedByPosition.get(position));
    } else if (normalIndex < normalItems.length) {
      sequence.push(normalItems[normalIndex]);
      normalIndex += 1;
    } else {
      break;
    }
    position += 1;
  }

  return sequence;
}

function createQueueGroup(items, source) {
  const cleanedItems = items.filter(Boolean);
  if (cleanedItems.length === 0) return null;

  return {
    id: makeId(),
    source,
    items: cleanedItems,
    createdAt: Date.now()
  };
}

function startQueueFromItems(items, source) {
  const group = createQueueGroup(items, source);
  if (!group) {
    updateTrayMenu();
    broadcastState();
    return { added: 0, copiedFirst: false };
  }

  copyQueue = copyQueue.concat(group);
  const copiedFirst = Boolean(copyFromQueueGroup(group));
  return { added: items.length, copiedFirst };
}

function queueOrdinaryCopyFixedTail() {
  const fixedPositionTwo = history.find((item) => item.fixedPosition === 2);
  copyQueue = copyQueue.filter((group) => group.source !== "普通复制固定位置");

  if (fixedPositionTwo) {
    copyQueue = copyQueue.concat(createQueueGroup([cloneQueueItem(fixedPositionTwo, "固定位置 2")], "普通复制固定位置"));
  }

  updateTrayMenu();
}

function getQueueCount() {
  return copyQueue.reduce((total, group) => total + group.items.length, 0);
}

function writeItemToClipboard(item) {
  if (item.type === "image") {
    const image = nativeImage.createFromDataURL(item.imageDataUrl);
    clipboard.writeImage(image);
  } else {
    clipboard.writeText(item.content || "");
  }
  lastSignature = itemSignature(item);
}

function copyFromQueueGroup(group) {
  if (!group || group.items.length === 0) return null;

  const item = group.items.shift();
  writeItemToClipboard(item);
  lastSignature = itemSignature(item);

  if (group.items.length === 0) {
    copyQueue = copyQueue.filter((entry) => entry.id !== group.id);
  }

  updateTrayMenu();
  broadcastState();
  return item;
}

function copyNextQueueValue() {
  const group = copyQueue.find((entry) => entry.items.length > 0);
  return copyFromQueueGroup(group);
}

function pollClipboard() {
  const snapshot = getClipboardSnapshot();
  const signature = itemSignature(snapshot);

  if (!snapshot || !signature || signature === lastSignature) return;

  lastSignature = signature;
  addHistoryItem(snapshot);
  queueOrdinaryCopyFixedTail();
  broadcastState();
}

function textValues(values) {
  return values.map((value) => String(value ?? "").trim()).filter(Boolean);
}

function parseTextFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  return [textValues(text.split(/\r?\n/))];
}

function parseWorkbookRows(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: false });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) return [];

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], {
    header: 1,
    defval: ""
  });

  return rows.map((row) => textValues(row)).filter((row) => row.length > 0);
}

function parseImportFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".txt") return parseTextFile(filePath);
  if ([".csv", ".xlsx", ".xls"].includes(ext)) return parseWorkbookRows(filePath);
  throw new Error("暂不支持该文件格式");
}

function rowsToQueueItems(rows, source) {
  return rows.flatMap((row) => {
    const normalItems = row.map((value) => textQueueItem(value, source)).filter(Boolean);
    return buildSequenceWithFixedItems(normalItems);
  });
}

function broadcastState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("state-updated", getState());
  }
}

function getState() {
  return {
    history,
    queue: copyQueue,
    queueCount: getQueueCount(),
    pasteAdvanceDelayMs: PASTE_ADVANCE_DELAY_MS,
    settings,
    minHistoryLimit: MIN_HISTORY_LIMIT,
    maxHistoryLimit: MAX_HISTORY_LIMIT,
    groupRecords
  };
}

function isPasteHotkeyEvent(event) {
  return Boolean(event && event.ctrlKey && !event.altKey && !event.metaKey && event.keycode === UiohookKey.V);
}

function shouldAutoAdvanceAfterPaste(event, now = Date.now()) {
  if (!settings.autoAdvanceAfterPaste) return false;
  if (getQueueCount() === 0) return false;
  if (!isPasteHotkeyEvent(event)) return false;
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) return false;
  if (now - lastPasteHotkeyAt < 250) return false;
  lastPasteHotkeyAt = now;
  return true;
}

function scheduleAutoAdvanceAfterPaste(event) {
  if (!shouldAutoAdvanceAfterPaste(event)) return false;
  clearTimeout(pasteAdvanceTimer);
  pasteAdvanceTimer = setTimeout(() => copyNextQueueValue(), PASTE_ADVANCE_DELAY_MS);
  return true;
}

function startKeyboardHook() {
  uIOhook.on("keydown", scheduleAutoAdvanceAfterPaste);
  uIOhook.start();
}

function groupNameExists(name, ignoreId) {
  const normalized = String(name || "").trim().toLowerCase();
  return groupRecords.some((record) => record.id !== ignoreId && record.name.trim().toLowerCase() === normalized);
}

function normalizeGroupPayload(payload) {
  const name = String(payload?.name || "").trim();
  const items = textValues(String(payload?.text || "").split(/\r?\n/));

  if (!name) throw new Error("请输入组记录名称");
  if (items.length === 0) throw new Error("请至少输入一条内容");

  return { name, items };
}

ipcMain.handle("get-state", () => getState());

ipcMain.handle("copy-history-item", (_event, id) => {
  const item = history.find((entry) => entry.id === id);
  if (!item) return { ok: false };
  writeItemToClipboard(item);
  return { ok: true };
});

ipcMain.handle("delete-history-item", (_event, id) => {
  history = history.filter((item) => item.id !== id);
  broadcastState();
  return getState();
});

ipcMain.handle("set-fixed-position", (_event, payload) => {
  const id = payload && payload.id;
  const position = Number(payload && payload.position);
  const item = history.find((entry) => entry.id === id);

  if (!item) return { ok: false, message: "未找到该记录", state: getState() };
  if (!Number.isInteger(position) || position < 1) {
    return { ok: false, message: "固定位置必须大于 0", state: getState() };
  }

  const conflict = history.find((entry) => entry.id !== id && entry.fixedPosition === position);
  if (conflict) {
    return { ok: false, message: `固定位置 ${position} 已被占用，请先取消该固定位置`, state: getState() };
  }

  item.fixedPosition = position;
  history = composeHistory(history);
  enforceHistoryLimit();
  broadcastState();
  return { ok: true, state: getState() };
});

ipcMain.handle("clear-fixed-position", (_event, id) => {
  const item = history.find((entry) => entry.id === id);
  if (item) item.fixedPosition = null;
  history = composeHistory(history);
  enforceHistoryLimit();
  broadcastState();
  return getState();
});

ipcMain.handle("clear-unfixed", () => {
  history = history.filter((item) => item.fixedPosition);
  history = composeHistory(history);
  broadcastState();
  return getState();
});

ipcMain.handle("import-file", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "导入复制队列",
    properties: ["openFile"],
    filters: [
      { name: "支持的文件", extensions: ["txt", "csv", "xlsx", "xls"] },
      { name: "文本", extensions: ["txt"] },
      { name: "表格", extensions: ["csv", "xlsx", "xls"] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true, state: getState() };
  }

  const filePath = result.filePaths[0];
  const rows = parseImportFile(filePath);
  const source = `${path.basename(filePath)} 导入`;
  const items = rowsToQueueItems(rows, source);
  addImportHistoryItem(filePath);
  const queueResult = startQueueFromItems(items, source);

  return {
    canceled: false,
    added: queueResult.added,
    copiedFirst: queueResult.copiedFirst,
    state: getState()
  };
});

ipcMain.handle("submit-multiline", (_event, text) => {
  const rawText = String(text || "");
  removeExactTextFromHistory(rawText);
  const row = textValues(rawText.split(/\r?\n/));
  const items = rowsToQueueItems([row], "多行复制");
  addTextHistoryItem(rawText, "multiline");
  const result = startQueueFromItems(items, "多行复制");
  return { ...result, state: getState() };
});

ipcMain.handle("copy-queue-item", (_event, id) => {
  const group = copyQueue.find((item) => item.id === id);
  const item = copyFromQueueGroup(group);
  return { ok: Boolean(item), state: getState() };
});

ipcMain.handle("copy-next-queue-item", () => {
  const item = copyNextQueueValue();
  return { ok: Boolean(item), state: getState() };
});

ipcMain.handle("delete-queue-item", (_event, id) => {
  copyQueue = copyQueue.filter((item) => item.id !== id);
  updateTrayMenu();
  broadcastState();
  return getState();
});

ipcMain.handle("update-settings", (_event, patch) => updateSettings(patch || {}));

ipcMain.handle("create-group-record", (_event, payload) => {
  const data = normalizeGroupPayload(payload);
  if (groupNameExists(data.name)) throw new Error("组记录名称不能重复");

  groupRecords.unshift({
    id: makeId(),
    name: data.name,
    items: data.items,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
  saveGroupRecords();
  broadcastState();
  return getState();
});

ipcMain.handle("update-group-record", (_event, payload) => {
  const id = payload?.id;
  const record = groupRecords.find((entry) => entry.id === id);
  if (!record) throw new Error("未找到该组记录");

  const data = normalizeGroupPayload(payload);
  if (groupNameExists(data.name, id)) throw new Error("组记录名称不能重复");

  record.name = data.name;
  record.items = data.items;
  record.updatedAt = Date.now();
  saveGroupRecords();
  broadcastState();
  return getState();
});

ipcMain.handle("delete-group-record", (_event, id) => {
  groupRecords = groupRecords.filter((record) => record.id !== id);
  saveGroupRecords();
  broadcastState();
  return getState();
});

ipcMain.handle("apply-group-record", (_event, id) => {
  const record = groupRecords.find((entry) => entry.id === id);
  if (!record) return { ok: false, message: "未找到该组记录", state: getState() };

  const items = rowsToQueueItems([record.items], `组记录：${record.name}`);
  const result = startQueueFromItems(items, `组记录：${record.name}`);
  return { ok: true, ...result, state: getState() };
});

ipcMain.handle("quit-app", () => {
  isQuitting = true;
  app.quit();
});

async function runClipboardSmokeTest() {
  const failures = [];
  history = [];
  copyQueue = [];
  lastSignature = "";

  const fixed2 = addHistoryItem({ type: "text", content: "固定2", preview: "固定2" });
  fixed2.fixedPosition = 2;
  const fixed4 = addHistoryItem({ type: "text", content: "固定4", preview: "固定4" });
  fixed4.fixedPosition = 4;
  const fixed5 = addHistoryItem({ type: "text", content: "固定5", preview: "固定5" });
  fixed5.fixedPosition = 5;
  const fixed10 = addHistoryItem({ type: "text", content: "固定10", preview: "固定10" });
  fixed10.fixedPosition = 10;

  const items = rowsToQueueItems([["A", "B", "C", "D"]], "多行复制");
  const expected = ["A", "固定2", "B", "固定4", "固定5", "C", "D"];
  const actual = items.map((item) => item.content);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(`固定位置插入顺序错误：${actual.join(" -> ")}`);
  }

  const shortItems = rowsToQueueItems([["A"]], "多行复制").map((item) => item.content);
  if (JSON.stringify(shortItems) !== JSON.stringify(["A", "固定2"])) {
    failures.push(`单项队列固定位置 2 插入错误：${shortItems.join(" -> ")}`);
  }

  startQueueFromItems(items, "多行复制");
  for (const expectedValue of expected) {
    if (clipboard.readText() !== expectedValue) {
      failures.push(`剪贴板应为“${expectedValue}”，实际为“${clipboard.readText()}”`);
      break;
    }
    copyNextQueueValue();
  }

  if (failures.length > 0) {
    console.error(failures.join("\n"));
    app.exit(1);
    return;
  }

  console.log("剪贴板递归复制烟测通过：固定位置按最终规则插入，并逐条销毁。");
  app.exit(0);
}

async function runPasteHookSmokeTest() {
  const failures = [];
  history = [];
  copyQueue = [];
  lastSignature = "";
  settings.autoAdvanceAfterPaste = true;

  const items = rowsToQueueItems([["第一行", "第二行", "第三行"]], "多行复制");
  startQueueFromItems(items, "多行复制");

  if (clipboard.readText() !== "第一行") {
    failures.push(`初始剪贴板应为“第一行”，实际为“${clipboard.readText()}”`);
  }

  scheduleAutoAdvanceAfterPaste({ ctrlKey: true, altKey: false, metaKey: false, keycode: UiohookKey.V });
  await new Promise((resolve) => setTimeout(resolve, PASTE_ADVANCE_DELAY_MS + 80));

  if (clipboard.readText() !== "第二行") {
    failures.push(`检测 Ctrl+V 后应自动推进到“第二行”，实际为“${clipboard.readText()}”`);
  }

  if (failures.length > 0) {
    console.error(failures.join("\n"));
    app.exit(1);
    return;
  }

  console.log("Ctrl+V 粘贴后自动推进烟测通过：检测粘贴快捷键后，剪贴板自动切到下一条。");
  app.exit(0);
}

app.whenReady().then(() => {
  app.setAppUserModelId("com.local.clipboard-helper");
  loadSettings();
  loadGroupRecords();
  applyLoginSetting();
  registerOpenShortcut();
  createAppMenu();

  if (process.argv.includes("--smoke-test-clipboard")) {
    runClipboardSmokeTest();
    return;
  }

  if (process.argv.includes("--smoke-test-paste-hook")) {
    runPasteHookSmokeTest();
    return;
  }

  createWindow();
  createTrayIcon();
  startKeyboardHook();
  lastSignature = itemSignature(getClipboardSnapshot());
  pollTimer = setInterval(pollClipboard, POLL_MS);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && isQuitting) app.quit();
});

app.on("before-quit", () => {
  isQuitting = true;
  clearTimeout(pasteAdvanceTimer);
  globalShortcut.unregisterAll();
  try {
    uIOhook.stop();
  } catch {
    // The hook may not have been started in smoke-test mode.
  }
  if (pollTimer) clearInterval(pollTimer);
});
