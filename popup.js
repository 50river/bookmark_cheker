const scanBtn = document.getElementById("scan");
const exportBtn = document.getElementById("export");
const progressWrap = document.getElementById("progressWrap");
const progress = document.getElementById("progress");
const progressText = document.getElementById("progressText");
const summary = document.getElementById("summary");
const listWrap = document.getElementById("list");
const tbody = document.getElementById("tbody");
const bulkActions = document.getElementById("bulkActions");
const selectAll = document.getElementById("selectAll");
const selectHeader = document.getElementById("selectHeader");
const deleteBtn = document.getElementById("delete");
const selectedCount = document.getElementById("selectedCount");
const filterRow = document.getElementById("filterRow"); // フィルタ行
const statusFilter = document.getElementById("statusFilter"); // ステータスフィルタ

let lastScan = null;

// Apply i18n messages to elements with data-i18n attributes
function applyI18nStatic() {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    const msg = chrome.i18n.getMessage(key);
    if (!msg) return;
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      if (el.hasAttribute("placeholder")) el.setAttribute("placeholder", msg);
      else el.value = msg;
    } else if (el.tagName === "TITLE") {
      document.title = msg;
    } else {
      el.textContent = msg;
    }
  });
  // Set document language to UI language
  try { document.documentElement.lang = (chrome.i18n.getUILanguage() || "").split("-")[0] || ""; } catch {}
}

function resetUI() {
  progressWrap.style.display = "none";
  listWrap.style.display = "none";
  bulkActions.style.display = "none";
  filterRow.style.display = "none";
  statusFilter.value = "";
  summary.textContent = "";
  tbody.innerHTML = "";
  selectedCount.textContent = "0";
  selectAll.checked = false;
  selectHeader.checked = false;
  // 保存済みの結果をクリア
  lastScan = null;
  chrome.storage.local.remove("lastScan");
}

function updateProgress(done, total) {
  progressWrap.style.display = "block";
  const pct = total ? Math.round((done / total) * 100) : 0;
  progress.value = pct;
  progressText.textContent = chrome.i18n.getMessage("progressRunning", [String(done), String(total)])
    || `${done} / ${total}`;
}

function renderBroken(broken) {
  filterRow.style.display = broken.length ? "flex" : "none";
  // 選択されたステータスで絞り込み
  const selected = statusFilter.value;
  const rows = selected
        ? broken.filter(b =>
            selected === "timeout" ? (!b.status && !b.ok) : String(b.status) === selected)
        : broken;
  listWrap.style.display = broken.length ? "block" : "none";
  bulkActions.style.display = rows.length ? "flex" : "none";

  tbody.innerHTML = "";
  for (const b of rows) {
        const tr = document.createElement("tr");
        // タイトルもリンクにして、クリックで対象サイトを開けるようにする
        tr.innerHTML = `
          <td><input type="checkbox" class="rowcheck" data-id="${b.id}"></td>
          <td><a class="link" href="${b.finalUrl || b.url}"
                 target="_blank" rel="noreferrer">${escapeHtml(b.title || "")}</a></td>
          <td><a class="link" href="${b.finalUrl || b.url}"
                 target="_blank" rel="noreferrer">${escapeHtml(b.url)}</a></td>
          <td class="${b.ok ? "status-ok" : "status-bad"}">${statusLabel(b)}</td>
          <td class="folder">${escapeHtml(b.folder || "")}</td>
        `;
        tbody.appendChild(tr);
  }
  updateSelectedCount();
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, s => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[s]));
}

function statusLabel(b) {
  if (b.ok) return `OK ${b.status || ""}`;
  if (b.status) return chrome.i18n.getMessage("statusNg", [String(b.status)]) || `NG ${b.status}`;
  return chrome.i18n.getMessage("statusTimeout") || "Timeout";
}

function getCheckedIds() {
  return Array.from(document.querySelectorAll(".rowcheck:checked")).map(el => el.dataset.id);
}

function updateSelectedCount() {
  selectedCount.textContent = String(getCheckedIds().length);
}

// 前回のスキャン結果があれば復元
chrome.storage.local.get("lastScan", ({ lastScan: saved }) => {
  if (saved) {
    lastScan = saved;
    const broken = saved.broken || [];
    summary.textContent = chrome.i18n.getMessage("summary", [String(saved.total), String(broken.length)])
      || `${saved.total} / ${broken.length}`;
    renderBroken(broken);
  }
});

scanBtn.addEventListener("click", async () => {
  resetUI();
  updateProgress(0, 0);

  // 進捗受け取り
  chrome.runtime.onMessage.addListener(function listener(msg) {
	if (msg.type === "progress") {
	  updateProgress(msg.done, msg.total);
	}
  });

  scanBtn.disabled = true;
  scanBtn.textContent = chrome.i18n.getMessage("scanning") || scanBtn.textContent;

  const res = await chrome.runtime.sendMessage({ type: "scan" }).catch(() => null);

  scanBtn.disabled = false;
  scanBtn.textContent = chrome.i18n.getMessage("scan") || scanBtn.textContent;

  if (!res || !res.ok) {
        progressText.textContent = chrome.i18n.getMessage("errorOccurred") || "Error";
        return;
  }

  lastScan = res;
  // 結果を保存
  chrome.storage.local.set({ lastScan: res });
  progress.value = 100;
  progressText.textContent = chrome.i18n.getMessage("done") || "Done";

  const broken = res.broken;
  summary.textContent = chrome.i18n.getMessage("summary", [String(res.total), String(broken.length)])
    || `${res.total} / ${broken.length}`;

  renderBroken(broken);
});

// ステータスフィルタ変更時に再描画
statusFilter.addEventListener("change", () => {
  if (lastScan) renderBroken(lastScan.broken);
});

document.addEventListener("change", (e) => {
  if (e.target.classList.contains("rowcheck")) updateSelectedCount();

  if (e.target === selectAll) {
	document.querySelectorAll(".rowcheck").forEach(cb => cb.checked = selectAll.checked);
	selectHeader.checked = selectAll.checked;
	updateSelectedCount();
  }
  if (e.target === selectHeader) {
	document.querySelectorAll(".rowcheck").forEach(cb => cb.checked = selectHeader.checked);
	selectAll.checked = selectHeader.checked;
	updateSelectedCount();
  }
});

deleteBtn.addEventListener("click", async () => {
  const ids = getCheckedIds();
  if (!ids.length) return;

  if (!confirm(chrome.i18n.getMessage("confirmDelete", [String(ids.length)]) || "Delete?")) return;

  deleteBtn.disabled = true;
  deleteBtn.textContent = chrome.i18n.getMessage("deleting") || deleteBtn.textContent;

  const res = await chrome.runtime.sendMessage({ type: "delete", ids }).catch(() => null);

  deleteBtn.disabled = false;
  deleteBtn.textContent = chrome.i18n.getMessage("deleteSelected") || deleteBtn.textContent;

  if (!res || !res.ok) {
	alert(chrome.i18n.getMessage("deleteError") || "Delete error");
	return;
  }

  // UIから消す
  document.querySelectorAll(".rowcheck:checked").forEach(cb => cb.closest("tr").remove());
  updateSelectedCount();
  // 残数の再計算
  const remaining = document.querySelectorAll(".rowcheck").length;
  // Rebuild summary with remaining count
  const totalMatch = /\d+/.exec(summary.textContent);
  const total = lastScan?.total || (totalMatch ? Number(totalMatch[0]) : 0);
  summary.textContent = chrome.i18n.getMessage("summary", [String(total), String(remaining)])
    || `${total} / ${remaining}`;

  // 保存内容の更新
  if (lastScan) {
        lastScan.broken = lastScan.broken.filter(b => !ids.includes(b.id));
        if (lastScan.broken.length) {
          chrome.storage.local.set({ lastScan });
        } else {
          chrome.storage.local.remove("lastScan");
          lastScan = null;
        }
  }

  if (remaining === 0) {
        bulkActions.style.display = "none";
        listWrap.style.display = "none";
  }
});

exportBtn.addEventListener("click", () => {
  if (!lastScan) return;
  const rows = [["id","title","url","finalUrl","status","ok","folder","error"]];
  for (const r of lastScan.broken) {
	rows.push([
	  r.id, r.title || "", r.url || "", r.finalUrl || "",
	  String(r.status || ""), String(!!r.ok), r.folder || "", r.error || ""
	]);
  }
  const csv = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "broken_bookmarks.csv";
  a.click();
  URL.revokeObjectURL(url);
});

// Apply i18n after DOM built
document.addEventListener("DOMContentLoaded", applyI18nStatic);
