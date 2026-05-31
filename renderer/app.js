const api = window.clipboardApp;

const state = {
  page: "clipboard",
  clipboardMode: "history",
  history: [],
  queue: [],
  queueViews: {
    ordinary: { groups: [], items: [], count: 0 },
    multiline: { groups: [], items: [], count: 0 },
    import: { groups: [], items: [], count: 0 }
  },
  queueCount: 0,
  settings: {
    minimizeToTray: true,
    closeToTray: true,
    startAtLogin: false,
    autoAdvanceAfterPaste: true,
    historyLimit: 20,
    openShortcut: ""
  },
  minHistoryLimit: 10,
  maxHistoryLimit: 1000,
  groupRecords: [],
  groupSearchTerm: "",
  openMenuId: null,
  fixedTargetId: null,
  editingGroupId: null
};

const pages = {
  clipboard: document.querySelector("#clipboardPage"),
  settings: document.querySelector("#settingsPage"),
  groups: document.querySelector("#groupsPage")
};

const historyMeta = document.querySelector("#historyMeta");
const historyCount = document.querySelector("#historyCount");
const historyList = document.querySelector("#historyList");
const historySection = document.querySelector("#historySection");
const queueSection = document.querySelector("#queueSection");
const queueMeta = document.querySelector("#queueMeta");
const queueList = document.querySelector("#queueList");
const clipboardTabs = document.querySelectorAll("[data-clipboard-mode]");
const clearButton = document.querySelector("#clearButton");
const copyNextButton = document.querySelector("#copyNextButton");
const multilineModal = document.querySelector("#multilineModal");
const multilineInput = document.querySelector("#multilineInput");
const cancelMultilineButton = document.querySelector("#cancelMultilineButton");
const submitMultilineButton = document.querySelector("#submitMultilineButton");
const positionModal = document.querySelector("#positionModal");
const positionInput = document.querySelector("#positionInput");
const cancelPositionButton = document.querySelector("#cancelPositionButton");
const submitPositionButton = document.querySelector("#submitPositionButton");
const minimizeToTrayInput = document.querySelector("#minimizeToTrayInput");
const closeToTrayInput = document.querySelector("#closeToTrayInput");
const startAtLoginInput = document.querySelector("#startAtLoginInput");
const autoAdvanceAfterPasteInput = document.querySelector("#autoAdvanceAfterPasteInput");
const historyLimitInput = document.querySelector("#historyLimitInput");
const openShortcutInput = document.querySelector("#openShortcutInput");
const saveSettingsButton = document.querySelector("#saveSettingsButton");
const groupSearchInput = document.querySelector("#groupSearchInput");
const groupSearchButton = document.querySelector("#groupSearchButton");
const newGroupButton = document.querySelector("#newGroupButton");
const groupList = document.querySelector("#groupList");
const groupModal = document.querySelector("#groupModal");
const groupModalTitle = document.querySelector("#groupModalTitle");
const groupNameInput = document.querySelector("#groupNameInput");
const groupItemsInput = document.querySelector("#groupItemsInput");
const cancelGroupButton = document.querySelector("#cancelGroupButton");
const submitGroupButton = document.querySelector("#submitGroupButton");
const toast = document.querySelector("#toast");

let toastTimer;

function applyState(nextState) {
  state.history = nextState.history || [];
  state.queue = nextState.queue || [];
  state.queueViews = nextState.queueViews || state.queueViews;
  state.queueCount = nextState.queueCount || 0;
  if (state.page === "clipboard" && nextState.activeQueueMode) {
    state.clipboardMode = nextState.activeQueueMode;
  }
  state.settings = nextState.settings || state.settings;
  state.minHistoryLimit = nextState.minHistoryLimit || 10;
  state.maxHistoryLimit = nextState.maxHistoryLimit || 1000;
  state.groupRecords = nextState.groupRecords || [];
  render();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.remove("hidden");
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 2200);
}

function showPage(page) {
  state.page = page;
  state.openMenuId = null;
  Object.entries(pages).forEach(([name, element]) => {
    element.classList.toggle("hidden", name !== page);
  });
  render();
}

function render() {
  renderClipboard();
  renderSettings();
  renderGroups();
}

function renderClipboard() {
  historyMeta.textContent = `历史记录最多保存 ${state.settings.historyLimit} 条；固定位置记录会优先保留`;
  historyCount.textContent = `${state.history.length}/${state.settings.historyLimit}`;

  clipboardTabs.forEach((button) => {
    button.classList.toggle("active", button.dataset.clipboardMode === state.clipboardMode);
  });

  const isHistoryMode = state.clipboardMode === "history";
  historySection.classList.toggle("hidden", !isHistoryMode);
  queueSection.classList.toggle("hidden", isHistoryMode);

  if (!isHistoryMode) {
    const view = getCurrentQueueView();
    const queueItems = view.items || [];
    const deleteGroupId = view.groups && view.groups.length === 1 ? view.groups[0].deleteGroupId : null;
    queueSection.classList.remove("hidden");
    queueMeta.textContent = getQueueModeMeta(state.clipboardMode, view);
    queueList.innerHTML =
      queueItems.length === 0
        ? '<div class="empty">暂无递归复制队列</div>'
        : queueItems.map((item, index) => renderQueueItem(item, index, index === 0 ? deleteGroupId : null)).join("");
  }

  historyList.innerHTML =
    state.history.length === 0
      ? '<div class="empty">复制文本或图片后会出现在这里</div>'
      : state.history.map(renderHistoryItem).join("");
}

function getCurrentQueueView() {
  return state.queueViews[state.clipboardMode] || { groups: [], items: [], count: 0 };
}

function getQueueModeMeta(mode, view) {
  const names = {
    ordinary: "普通复制",
    multiline: "多行复制",
    import: "导入复制"
  };
  return `${names[mode] || "递归复制"}队列，剩余 ${view.count} 条；第一条就是下一次 Ctrl+V 会粘贴的内容`;
}

function renderHistoryItem(item, index) {
  const isMenuOpen = state.openMenuId === item.id;
  const fixedText = item.fixedPosition ? `固定位置 ${item.fixedPosition}` : "";
  const badges = [];
  const typeLabel = getHistoryTypeLabel(item);

  if (item.fixedPosition) badges.push(`<span class="badge pin">${fixedText}</span>`);
  badges.push(`<span class="badge">第 ${index + 1} 位</span>`);
  badges.push(`<span class="badge">${typeLabel}</span>`);

  const content = renderHistoryContent(item);

  const fixedAction =
    item.type === "import"
      ? ""
      : item.fixedPosition
        ? `<button type="button" data-action="clear-fixed-position" data-id="${item.id}">取消固定位置 ${item.fixedPosition}</button>`
        : `<button type="button" data-action="fixed-position" data-id="${item.id}">指定位置固定</button>`;

  return `
    <article class="item clickable" data-history-id="${item.id}">
      <div class="item-content">
        ${content}
        <div class="item-meta">${badges.join("")}</div>
      </div>
      <button class="more-button" type="button" aria-label="更多操作" data-menu-id="${item.id}">
        <span>...</span>
      </button>
      ${
        isMenuOpen
          ? `<div class="menu" data-menu="${item.id}">
              <button class="danger" type="button" data-action="delete" data-id="${item.id}" ${item.fixedPosition ? "disabled" : ""}>删除</button>
              ${fixedAction}
            </div>`
          : ""
      }
    </article>
  `;
}

function getHistoryTypeLabel(item) {
  if (item.type === "image") return "图片";
  if (item.type === "import") return "导入";
  if (item.sourceKind === "multiline") return "多行复制";
  return "文本";
}

function renderHistoryContent(item) {
  if (item.type === "image") {
    return `<img class="image-preview" src="${item.imageDataUrl}" alt="剪贴板图片" />`;
  }

  if (item.type === "import") {
    return `
      <div class="item-text">
        <strong>通过导入创建</strong><br />
        ${escapeHtml(item.importPath || item.content || "")}
      </div>
    `;
  }

  const content = item.content || item.preview || "";
  return `<div class="item-text">${escapeHtml(content)}</div>`;
}

function renderQueueItem(item, index, deleteGroupId) {
  const preview =
    item && item.type === "image"
      ? `<img class="image-preview" src="${item.imageDataUrl}" alt="队列图片" />`
      : `<div class="item-text">${escapeHtml(item ? item.content || item.preview || "" : "")}</div>`;

  return `
    <article class="item queue-item">
      <div class="item-content">
        ${preview}
        <div class="item-meta">
          <span class="badge queue">${index === 0 ? "下一次粘贴" : `第 ${index + 1} 次粘贴`}</span>
          <span class="badge">${escapeHtml(item.source || "递归复制")}</span>
        </div>
      </div>
      <div class="queue-side">
        ${
          deleteGroupId
            ? `<button class="queue-delete" type="button" aria-label="删除队列项" data-delete-queue-id="${deleteGroupId}">×</button>`
            : ""
        }
      </div>
    </article>
  `;
}

function renderSettings() {
  minimizeToTrayInput.checked = Boolean(state.settings.minimizeToTray);
  closeToTrayInput.checked = Boolean(state.settings.closeToTray);
  startAtLoginInput.checked = Boolean(state.settings.startAtLogin);
  autoAdvanceAfterPasteInput.checked = Boolean(state.settings.autoAdvanceAfterPaste);
  historyLimitInput.value = String(state.settings.historyLimit);
  historyLimitInput.min = String(state.minHistoryLimit);
  historyLimitInput.max = String(state.maxHistoryLimit);
  openShortcutInput.value = state.settings.openShortcut || "";
}

function renderGroups() {
  const keyword = state.groupSearchTerm.trim().toLowerCase();
  const records = keyword
    ? state.groupRecords.filter((record) => record.name.toLowerCase().includes(keyword))
    : state.groupRecords;

  if (records.length === 0) {
    groupList.innerHTML = '<div class="empty">暂无组记录</div>';
    return;
  }

  groupList.innerHTML = records
    .map(
      (record) => `
        <article class="group-card">
          <div class="group-info">
            <h2>${escapeHtml(record.name)}</h2>
            <p>${escapeHtml(record.items.slice(0, 4).join(" / "))}${record.items.length > 4 ? " ..." : ""}</p>
            <div class="item-meta">
              <span class="badge">${record.items.length} 条</span>
            </div>
          </div>
          <div class="group-actions">
            <button type="button" data-group-action="apply" data-id="${record.id}">应用</button>
            <button type="button" data-group-action="edit" data-id="${record.id}">编辑</button>
            <button class="danger-button" type="button" data-group-action="delete" data-id="${record.id}">删除</button>
          </div>
        </article>
      `
    )
    .join("");
}

function openMultilineModal() {
  multilineInput.value = "";
  multilineModal.classList.remove("hidden");
  multilineInput.focus();
}

function closeMultilineModal() {
  multilineModal.classList.add("hidden");
}

function openPositionModal(id) {
  state.fixedTargetId = id;
  const currentItem = state.history.find((item) => item.id === id);
  positionInput.value = String(currentItem && currentItem.fixedPosition ? currentItem.fixedPosition : 2);
  positionModal.classList.remove("hidden");
  positionInput.focus();
  positionInput.select();
}

function closePositionModal() {
  state.fixedTargetId = null;
  positionModal.classList.add("hidden");
}

function openGroupModal(record) {
  state.editingGroupId = record ? record.id : null;
  groupModalTitle.textContent = record ? "编辑组记录" : "新增组记录";
  submitGroupButton.textContent = record ? "保存" : "添加";
  groupNameInput.value = record ? record.name : "";
  groupItemsInput.value = record ? record.items.join("\n") : "";
  groupModal.classList.remove("hidden");
  groupNameInput.focus();
}

function closeGroupModal() {
  state.editingGroupId = null;
  groupModal.classList.add("hidden");
}

clearButton.addEventListener("click", async () => {
  await api.clearUnfixed();
  state.openMenuId = null;
  showToast("已删除未固定位置的记录");
});

async function openImportDialog() {
  try {
    const result = await api.importFile();
    if (!result.canceled) {
      applyState(result.state);
      showToast(result.copiedFirst ? `已导入并复制第一项，剩余 ${state.queueCount} 条` : `已导入 ${result.added} 条`);
    }
  } catch (error) {
    showToast(error.message || "导入失败");
  }
}

cancelMultilineButton.addEventListener("click", closeMultilineModal);

submitMultilineButton.addEventListener("click", async () => {
  const result = await api.submitMultiline(multilineInput.value);
  applyState(result.state);
  closeMultilineModal();
  showToast(result.copiedFirst ? `已复制第一项，剩余 ${state.queueCount} 条` : `已加入 ${result.added} 条队列`);
});

copyNextButton.addEventListener("click", async () => {
  const result = await api.copyNextQueueItem(state.clipboardMode);
  applyState(result.state);
  if (result.ok) showToast("已复制并销毁队列首项");
});

clipboardTabs.forEach((button) => {
  button.addEventListener("click", async () => {
    const mode = button.dataset.clipboardMode;
    state.clipboardMode = mode;
    renderClipboard();
    if (mode === "multiline") {
      openMultilineModal();
    }
    if (mode === "import") {
      await openImportDialog();
    }
  });
});

cancelPositionButton.addEventListener("click", closePositionModal);

submitPositionButton.addEventListener("click", async () => {
  const position = Number(positionInput.value);
  if (!Number.isInteger(position) || position < 1) {
    showToast("固定位置必须大于 0");
    return;
  }

  const result = await api.setFixedPosition(state.fixedTargetId, position);
  applyState(result.state);
  if (!result.ok) {
    showToast(result.message || "固定失败");
    return;
  }

  state.openMenuId = null;
  closePositionModal();
  showToast(`已固定到位置 ${position}`);
});

saveSettingsButton.addEventListener("click", async () => {
  const historyLimit = Number(historyLimitInput.value);
  if (!Number.isInteger(historyLimit) || historyLimit < state.minHistoryLimit || historyLimit > state.maxHistoryLimit) {
    showToast(`历史记录数量请输入 ${state.minHistoryLimit}-${state.maxHistoryLimit}`);
    return;
  }

  try {
    const nextSettings = await api.updateSettings({
      minimizeToTray: minimizeToTrayInput.checked,
      closeToTray: closeToTrayInput.checked,
      startAtLogin: startAtLoginInput.checked,
      autoAdvanceAfterPaste: autoAdvanceAfterPasteInput.checked,
      historyLimit,
      openShortcut: openShortcutInput.value.trim()
    });

    state.settings = nextSettings;
    render();
    showToast("设置已保存");
  } catch (error) {
    showToast(error.message || "设置保存失败");
    openShortcutInput.value = state.settings.openShortcut || "";
  }
});

openShortcutInput.addEventListener("focus", () => {
  openShortcutInput.classList.add("capturing");
  openShortcutInput.placeholder = "请按下快捷键";
});

openShortcutInput.addEventListener("blur", () => {
  openShortcutInput.classList.remove("capturing");
  openShortcutInput.placeholder = "未设置";
});

openShortcutInput.addEventListener("keydown", (event) => {
  event.preventDefault();
  event.stopPropagation();

  if (["Escape", "Backspace", "Delete"].includes(event.key)) {
    openShortcutInput.value = "";
    showToast("快捷键已清空");
    return;
  }

  const shortcut = buildShortcutFromEvent(event);
  if (!shortcut) return;

  openShortcutInput.value = shortcut;
});

function buildShortcutFromEvent(event) {
  const key = normalizeShortcutKey(event.key);
  if (!key) return "";

  const parts = [];
  if (event.ctrlKey) parts.push("Control");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Super");

  const isFunctionKey = /^F([1-9]|1[0-9]|2[0-4])$/.test(key);
  if (parts.length === 0 && !isFunctionKey) {
    showToast("请至少包含 Ctrl、Alt、Shift 或使用功能键");
    return "";
  }

  parts.push(key);
  return parts.join("+");
}

function normalizeShortcutKey(key) {
  if (["Control", "Shift", "Alt", "Meta"].includes(key)) return "";
  if (/^[a-z]$/i.test(key)) return key.toUpperCase();
  if (/^[0-9]$/.test(key)) return key;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) return key.toUpperCase();

  const keyMap = {
    " ": "Space",
    Spacebar: "Space",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Insert: "Insert",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    Tab: "Tab",
    Enter: "Enter"
  };

  return keyMap[key] || "";
}

groupSearchButton.addEventListener("click", () => {
  state.groupSearchTerm = groupSearchInput.value;
  renderGroups();
});

groupSearchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    state.groupSearchTerm = groupSearchInput.value;
    renderGroups();
  }
});

newGroupButton.addEventListener("click", () => openGroupModal(null));
cancelGroupButton.addEventListener("click", closeGroupModal);

submitGroupButton.addEventListener("click", async () => {
  try {
    const wasEditing = Boolean(state.editingGroupId);
    const payload = {
      id: state.editingGroupId,
      name: groupNameInput.value,
      text: groupItemsInput.value
    };
    const nextState = wasEditing ? await api.updateGroupRecord(payload) : await api.createGroupRecord(payload);
    applyState(nextState);
    closeGroupModal();
    showToast(wasEditing ? "组记录已保存" : "组记录已添加");
  } catch (error) {
    showToast(error.message || "保存失败");
  }
});

historyList.addEventListener("click", async (event) => {
  const menuButton = event.target.closest("[data-menu-id]");
  const menuAction = event.target.closest("[data-action]");
  const historyItem = event.target.closest("[data-history-id]");

  if (menuButton) {
    event.stopPropagation();
    const id = menuButton.dataset.menuId;
    state.openMenuId = state.openMenuId === id ? null : id;
    renderClipboard();
    return;
  }

  if (menuAction) {
    event.stopPropagation();
    const id = menuAction.dataset.id;
    const action = menuAction.dataset.action;

    if (action === "delete") {
      const result = await api.deleteHistoryItem(id);
      applyState(result.state);
      if (!result.ok) {
        showToast(result.message || "删除失败");
        return;
      }
      state.openMenuId = null;
      showToast("已删除");
    }

    if (action === "fixed-position") {
      openPositionModal(id);
    }

    if (action === "clear-fixed-position") {
      await api.clearFixedPosition(id);
      state.openMenuId = null;
      showToast("已取消固定位置");
    }

    return;
  }

  if (historyItem) {
    const result = await api.copyHistoryItem(historyItem.dataset.historyId);
    if (result.ok) showToast("已复制到系统剪贴板");
  }
});

queueList.addEventListener("click", async (event) => {
  const deleteButton = event.target.closest("[data-delete-queue-id]");

  if (deleteButton) {
    event.stopPropagation();
    await api.deleteQueueItem(deleteButton.dataset.deleteQueueId);
    showToast("已删除队列项");
    return;
  }
});

groupList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-group-action]");
  if (!button) return;

  const id = button.dataset.id;
  const action = button.dataset.groupAction;
  const record = state.groupRecords.find((entry) => entry.id === id);

  try {
    if (action === "apply") {
      const result = await api.applyGroupRecord(id);
      applyState(result.state);
      showPage("clipboard");
      showToast(result.copiedFirst ? `已应用组记录，剩余 ${state.queueCount} 条` : "已应用组记录");
    }

    if (action === "edit") {
      openGroupModal(record);
    }

    if (action === "delete") {
      if (!record) return;
      if (!confirm(`确定删除组记录“${record.name}”吗？`)) return;
      const nextState = await api.deleteGroupRecord(id);
      applyState(nextState);
      showToast("组记录已删除");
    }
  } catch (error) {
    showToast(error.message || "操作失败");
  }
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".menu") && !event.target.closest("[data-menu-id]")) {
    if (state.openMenuId) {
      state.openMenuId = null;
      renderClipboard();
    }
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeMultilineModal();
    closePositionModal();
    closeGroupModal();
    state.openMenuId = null;
    render();
  }
});

api.onStateUpdated(applyState);
api.onNavigatePage(showPage);
api.getState().then(applyState);
