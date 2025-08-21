// 背景でブックマークを巡回してURLをチェック
// できるだけ HEAD を使いつつ、405系は GET にフォールバック
// タイムアウト・同時実行数・失敗の再試行を実装

const CONCURRENCY = 10;
const TIMEOUT_MS = 8000;
const RETRIES = 1;

async function getAllBookmarks() {
  const tree = await chrome.bookmarks.getTree();
  const flat = [];
  function walk(nodes, path = []) {
	for (const n of nodes) {
	  if (n.url) {
		flat.push({ id: n.id, title: n.title || "", url: n.url, path: path.join(" / ") });
	  } else if (n.children) {
		walk(n.children, [...path, n.title || ""]);
	  }
	}
  }
  walk(tree);
  return flat;
}

function timeoutFetch(input, init = {}, timeout = TIMEOUT_MS) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeout);
  const merged = { ...init, signal: controller.signal, redirect: "follow", cache: "no-store" };
  return fetch(input, merged).finally(() => clearTimeout(t));
}

async function checkOnce(url, method = "HEAD") {
  try {
	const res = await timeoutFetch(url, { method });
	// res.ok: 200-299
	return {
	  ok: res.ok,
	  status: res.status || 0,
	  finalUrl: res.url || url
	};
  } catch (e) {
	return { ok: false, status: 0, finalUrl: url, error: String(e && e.message || e) };
  }
}

async function checkUrl(url) {
  // 一部サイトは HEAD を拒否するのでフォールバック
  let result = await checkOnce(url, "HEAD");
  if (!result.ok && (result.status === 405 || result.status === 501 || result.status === 0)) {
	for (let i = 0; i <= RETRIES; i++) {
	  result = await checkOnce(url, "GET");
	  if (result.ok || i === RETRIES) break;
	}
  }
  return result;
}

async function checkAllBookmarks() {
  const items = await getAllBookmarks();

  // URLスキームが http/https のみに限定（chrome:// や file:// は除外）
  const targets = items.filter(b => /^https?:\/\//i.test(b.url));

  let done = 0;
  const results = [];
  const queue = [...targets];

  async function worker() {
	while (queue.length) {
	  const b = queue.shift();
	  const r = await checkUrl(b.url);
	  results.push({
		id: b.id,
		title: b.title,
		url: b.url,
		folder: b.path,
		status: r.status,
		ok: r.ok,
		finalUrl: r.finalUrl,
		error: r.error || null
	  });
	  done++;
	  chrome.runtime.sendMessage({ type: "progress", done, total: targets.length });
	}
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker);
  await Promise.all(workers);

  // 失敗(リンク切れ候補): ネットワーク失敗、タイムアウト、ステータス 400, 404, 410, 500+ など
  const broken = results.filter(r => !r.ok || r.status >= 400);
  return { results, broken, total: targets.length };
}

async function deleteBookmarks(ids) {
  for (const id of ids) {
	try { await chrome.bookmarks.remove(id); } catch (e) { /* フォルダ消し/権限エラー等は無視 */ }
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
	if (msg.type === "scan") {
	  const { results, broken, total } = await checkAllBookmarks();
	  sendResponse({ ok: true, results, broken, total });
	} else if (msg.type === "delete") {
	  await deleteBookmarks(msg.ids || []);
	  sendResponse({ ok: true });
	} else {
	  sendResponse({ ok: false, error: "Unknown message" });
	}
  })();
  // 非同期で sendResponse を使うため true を返す
  return true;
});