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

let lastScan = null;

(async () => {
  // 前回のスキャン結果があれば復元
  const { lastScan: saved } = await chrome.storage.local.get("lastScan");
  if (saved && saved.broken) {
    lastScan = saved;
    summary.textContent = `対象: ${saved.total} 件 / リンク切れ候補: ${saved.broken.length} 件`;
    renderBroken(saved.broken);
  }
})();

function resetUI() {
  progressWrap.style.display = "none";
  listWrap.style.display = "none";
  bulkActions.style.display = "none";
  summary.textContent = "";
  tbody.innerHTML = "";
  selectedCount.textContent = "0";
  selectAll.checked = false;
  selectHeader.checked = false;
}

function updateProgress(done, total) {
  progressWrap.style.display = "block";
  const pct = total ? Math.round((done / total) * 100) : 0;
  progress.value = pct;
  progressText.textContent = `${done} / ${total} チェック中…`;
}

function renderBroken(broken) {
  listWrap.style.display = broken.length ? "block" : "none";
  bulkActions.style.display = broken.length ? "flex" : "none";

  tbody.innerHTML = "";
  for (const b of broken) {
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
  if (b.status) return `NG ${b.status}`;
  return "接続失敗/タイムアウト";
}

function getCheckedIds() {
  return Array.from(document.querySelectorAll(".rowcheck:checked")).map(el => el.dataset.id);
}

function updateSelectedCount() {
  selectedCount.textContent = String(getCheckedIds().length);
}

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
  scanBtn.textContent = "スキャン中…";

  const res = await chrome.runtime.sendMessage({ type: "scan" }).catch(() => null);

  scanBtn.disabled = false;
  scanBtn.textContent = "リンク切れをスキャン";

  if (!res || !res.ok) {
        progressText.textContent = "エラーが発生しました。";
        return;
  }

  lastScan = res;
  // 結果を保存
  chrome.storage.local.set({ lastScan: res });
  progress.value = 100;
  progressText.textContent = "完了！";

  const broken = res.broken;
  summary.textContent =
	`対象: ${res.total} 件 / リンク切れ候補: ${broken.length} 件`;

  renderBroken(broken);
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

  if (!confirm(`${ids.length} 件のブックマークを削除します。よろしいですか？`)) return;

  deleteBtn.disabled = true;
  deleteBtn.textContent = "削除中…";

  const res = await chrome.runtime.sendMessage({ type: "delete", ids }).catch(() => null);

  deleteBtn.disabled = false;
  deleteBtn.textContent = "選択を削除";

  if (!res || !res.ok) {
	alert("削除中にエラーが発生しました。");
	return;
  }

  // UIから消す
  document.querySelectorAll(".rowcheck:checked").forEach(cb => cb.closest("tr").remove());
  updateSelectedCount();
  // 残数の再計算
  const remaining = document.querySelectorAll(".rowcheck").length;
  summary.textContent = summary.textContent.replace(/リンク切れ候補: \d+ 件/, `リンク切れ候補: ${remaining} 件`);

  // 保存されている結果も更新
  if (lastScan) {
        lastScan.broken = lastScan.broken.filter(b => !ids.includes(b.id));
        if (remaining === 0) {
          chrome.storage.local.remove("lastScan");
          lastScan = null;
        } else {
          chrome.storage.local.set({ lastScan });
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