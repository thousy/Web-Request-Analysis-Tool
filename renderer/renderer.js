/* ═══════════════════════════════════════════════════════════
   Web Request Analysis Tool  |  前端交互逻辑
   ═══════════════════════════════════════════════════════════ */

'use strict';



// ─── 全局状态 ─────────────────────────────────────────────────────────────────
let allRequests      = [];  // 存放当前次抓取的所有请求
let activeFilter     = 'all';
let searchQuery      = '';
let blockRules       = [];  // 拦截阻断规则数组 (包含匹配关键字或正则)
let currentScreenshot = ''; // 存入当前完全加载后的 webview 截图 Base64
let isHistoryMode    = false;
let isCapturing      = false; // 标识是否处于捕获状态（仅在点击“分析网页”加载期间）

// 从本地加载阻断规则
try {
  const savedRules = localStorage.getItem('blockRules');
  blockRules = savedRules ? JSON.parse(savedRules) : [];
} catch (_) {
  blockRules = [];
}
// 将规则同步给主进程
window.electronAPI.updateBlockingState({ rules: blockRules, bypass: false });

// ─── DOM 节点声明 ─────────────────────────────────────────────────────────────
const urlInput        = document.getElementById('urlInput');
const analyzeBtn      = document.getElementById('analyzeBtn');
const btnText         = analyzeBtn.querySelector('.btn-text');
const btnSpinner      = analyzeBtn.querySelector('.btn-spinner');
const timeoutSelect   = document.getElementById('timeoutSelect');
const analysisStatus  = document.getElementById('analysisStatus');
const statusText      = document.getElementById('statusText');

const totalCount      = document.getElementById('totalCount');
const successCount    = document.getElementById('successCount');
const failedCount     = document.getElementById('failedCount');
const ipCount         = document.getElementById('ipCount');

const filterBtns      = document.querySelectorAll('.filter-btn');
const searchInput     = document.getElementById('searchInput');
const exportJson      = document.getElementById('exportJson');
const exportCsv       = document.getElementById('exportCsv');
const toggleScr       = document.getElementById('toggleScreenshot');

const requestList     = document.getElementById('requestList');
const emptyState      = document.getElementById('emptyState');

// 历史模块 DOM
const btnHistory      = document.getElementById('btnHistory');
const btnClearAllHistory = document.getElementById('btnClearAllHistory');
const historyDrawer   = document.getElementById('historyDrawer');
const historyBackdrop = document.getElementById('historyBackdrop');
const closeHistory    = document.getElementById('closeHistory');
const historyList     = document.getElementById('historyList');
const emptyHistory    = document.getElementById('emptyHistory');

// 实时预览视口 DOM
const previewTitle    = document.getElementById('previewTitle');
const btnWebviewBack  = document.getElementById('btnWebviewBack');
const btnWebviewForward = document.getElementById('btnWebviewForward');
const btnWebviewReload = document.getElementById('btnWebviewReload');
const btnExitHistory  = document.getElementById('btnExitHistory');
const btnWebviewExpand = document.getElementById('btnWebviewExpand');
let previewWebview    = document.getElementById('previewWebview');
const screenshotOverlay = document.getElementById('screenshotOverlay');
const screenshotImg   = document.getElementById('screenshotImg');

const panelResizer     = document.getElementById('panelResizer');
const previewPanel     = document.getElementById('previewPanel');

// 大图 Lightbox DOM
const imageLightbox   = document.getElementById('imageLightbox');
const lightboxBackdrop = document.getElementById('lightboxBackdrop');
const closeLightbox   = document.getElementById('closeLightbox');
const lightboxImg     = document.getElementById('lightboxImg');

// 详情弹窗 DOM
const detailModal     = document.getElementById('detailModal');
const modalBackdrop   = document.getElementById('modalBackdrop');
const closeModal      = document.getElementById('closeModal');
const detailContent   = document.getElementById('detailContent');

const toast           = document.getElementById('toast');

// 统计卡片 DOM 指针
const cardTotal       = document.getElementById('cardTotal');
const cardSuccess     = document.getElementById('cardSuccess');
const cardFailed      = document.getElementById('cardFailed');
const cardIp          = document.getElementById('cardIp');

// 唯一 IP 详情聚合弹窗 DOM 指针
const ipModal         = document.getElementById('ipModal');
const ipModalBackdrop = document.getElementById('ipModalBackdrop');
const closeIpModal    = document.getElementById('closeIpModal');
const ipContent       = document.getElementById('ipContent');

// ─── DOMContentLoaded 初始化 ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // 主题初始化与切换
  const themeToggle = document.getElementById('themeToggle');
  const sunIcon = themeToggle.querySelector('.sun-icon');
  const moonIcon = themeToggle.querySelector('.moon-icon');
  const savedTheme = localStorage.getItem('theme') || 'light';
  applyTheme(savedTheme);

  themeToggle.addEventListener('click', () => {
    const currentTheme = document.body.getAttribute('data-theme') || 'dark';
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    applyTheme(newTheme);
  });

  function applyTheme(theme) {
    if (theme === 'light') {
      document.body.setAttribute('data-theme', 'light');
      sunIcon.classList.remove('hidden');
      moonIcon.classList.add('hidden');
    } else {
      document.body.removeAttribute('data-theme');
      sunIcon.classList.add('hidden');
      moonIcon.classList.remove('hidden');
    }
    localStorage.setItem('theme', theme);
  }

  // 开始加载网页分析
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startAnalysis();
  });
  analyzeBtn.addEventListener('click', startAnalysis);

  // 过滤控制
  filterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      filterBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      renderList();
    });
  });

  // 搜索框
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.trim().toLowerCase();
    renderList();
  });

  // 导出
  exportJson.addEventListener('click', () => doExport('json'));
  exportCsv.addEventListener('click', () => doExport('csv'));
  toggleScr.addEventListener('click', () => {
    if (!currentScreenshot) {
      showToast('暂无当前页面的截图快照，请等待分析加载完成', 'warning');
      return;
    }

    const isHidden = screenshotOverlay.classList.contains('hidden');
    if (isHidden) {
      // 隐藏 webview 并切换展示最新生成的 Base64 快照
      previewWebview.style.display = 'none';
      screenshotImg.src = currentScreenshot;
      screenshotOverlay.classList.remove('hidden');
      
      const badge = screenshotOverlay.querySelector('.overlay-badge');
      if (badge) badge.textContent = '当前快照 · 点击查看大图';
      showToast('已切换至静态网页快照', 'success');
    } else {
      // 恢复实时 webview 的展现
      screenshotOverlay.classList.add('hidden');
      if (!isHistoryMode) {
        previewWebview.style.display = 'block';
      }
      showToast('已切换回实时网页预览', 'info');
    }
  });

  // 大图查看 lightbox 开关
  screenshotOverlay.addEventListener('click', showBigImage);
  closeLightbox.addEventListener('click', hideBigImage);
  lightboxBackdrop.addEventListener('click', hideBigImage);

  // 弹窗关闭
  closeModal.addEventListener('click', () => detailModal.classList.add('hidden'));
  modalBackdrop.addEventListener('click', () => detailModal.classList.add('hidden'));

  // 统计卡片过滤联动与唯一 IP 详情弹窗
  cardTotal.addEventListener('click', () => triggerFilter('all'));
  cardSuccess.addEventListener('click', () => triggerFilter('success'));
  cardFailed.addEventListener('click', () => triggerFilter('failed'));
  cardIp.addEventListener('click', openIpAnalysisModal);

  closeIpModal.addEventListener('click', () => ipModal.classList.add('hidden'));
  ipModalBackdrop.addEventListener('click', () => ipModal.classList.add('hidden'));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      detailModal.classList.add('hidden');
      ipModal.classList.add('hidden');
      hideHistoryDrawer();
      hideBigImage();
    }
  });

  // 历史抽屉控制
  btnHistory.addEventListener('click', toggleHistoryDrawer);
  btnClearAllHistory.addEventListener('click', async () => {
    if (confirm('确定要永久清空所有历史分析快照吗？该操作无法恢复。')) {
      try {
        const res = await window.electronAPI.clearAllHistory();
        if (res.success) {
          showToast('历史记录已全部清空', 'success');
          loadHistoryList();
        } else {
          showToast('清空失败：' + res.error, 'error');
        }
      } catch (err) {
        showToast('清空时发生异常：' + err.message, 'error');
      }
    }
  });
  closeHistory.addEventListener('click', hideHistoryDrawer);
  historyBackdrop.addEventListener('click', hideHistoryDrawer);

  // 网页预览浏览器控制器
  btnWebviewBack.addEventListener('click', () => {
    isCapturing = false;
    setAnalyzingUI(false);
    updateStatusText();
    if (previewWebview.canGoBack()) previewWebview.goBack();
  });
  btnWebviewForward.addEventListener('click', () => {
    isCapturing = false;
    setAnalyzingUI(false);
    updateStatusText();
    if (previewWebview.canGoForward()) previewWebview.goForward();
  });
  btnWebviewReload.addEventListener('click', () => {
    isCapturing = false;
    setAnalyzingUI(false);
    updateStatusText();

    // 开启拦截模式并刷新内嵌 webview，但不清空捕获列表
    window.electronAPI.updateBlockingState({ rules: blockRules, bypass: false });

    // 强力刷新：优先读取当前 URL 强行导航，若读取不到或无效，回退读取输入框最新 URL 并强制加载
    // 彻底解决 webview.reload() 在卡在报错页时无效、或者相同 URL 赋值被 Chromium 忽略而不加载的问题
    let reloadUrl = '';
    try {
      reloadUrl = previewWebview.getURL();
    } catch (_) {}

    if (!reloadUrl || reloadUrl === 'about:blank') {
      reloadUrl = urlInput.value.trim();
      if (reloadUrl && !/^https?:\/\//i.test(reloadUrl)) {
        const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?::\d+)?$/;
        const isLocal = ipRegex.test(reloadUrl) || reloadUrl.toLowerCase().startsWith('localhost');
        reloadUrl = (isLocal ? 'http://' : 'https://') + reloadUrl;
      }
    }

    try {
      // 1. 优先使用原生的 reloadIgnoringCache 刷新当前页面（避开缓存且强制重载相同 URL）
      if (typeof previewWebview.reloadIgnoringCache === 'function') {
        previewWebview.reloadIgnoringCache();
      } else if (reloadUrl && typeof previewWebview.loadURL === 'function') {
        // 2. 回退使用 loadURL 进行强制重载
        previewWebview.loadURL(reloadUrl, {
          extraHeaders: 'pragma: no-cache\r\ncache-control: no-cache\r\n'
        });
      } else {
        // 3. 基础重载兜底
        previewWebview.reload();
      }
    } catch (err) {
      showToast('刷新失败，尝试强制重载: ' + err.message, 'warning');
      try {
        if (reloadUrl) {
          previewWebview.src = reloadUrl;
        } else {
          previewWebview.reload();
        }
      } catch (_) {}
    }

    // 同步重载所有打开的大预览窗口
    window.electronAPI.reloadPreviewWindows();
  });
  btnExitHistory.addEventListener('click', exitHistoryMode);
  btnWebviewExpand.addEventListener('click', () => {
    const url = previewWebview.getURL();
    if (url && url !== 'about:blank') {
      window.electronAPI.openPreviewWindow(url);
    } else {
      showToast('当前没有正在载入的网页，请先分析或输入网址', 'warning');
    }
  });

  // ── Webview 核心事件绑定 ───────────────────────────────────────────────────
  bindWebviewEvents();

  // ── 监听主进程 webRequest 推送的实时网络包 ────────────────────────────────────
  window.electronAPI.onRequestCaptured((record) => {
    if (isHistoryMode) return; // 历史查看下不追加新网络包

    // 按 requestId 查重，更新或追加
    const existingIndex = allRequests.findIndex(r => r.requestId === record.requestId);
    if (existingIndex !== -1) {
      // 避免 responseStarted 覆盖已阻断状态
      if (allRequests[existingIndex].isBlocked) {
        return;
      }
      allRequests[existingIndex] = { ...allRequests[existingIndex], ...record };
    } else {
      if (!isCapturing) return; // 如果当前不处于分析捕获阶段，忽略额外的新请求（例如预览刷新、二次点击等）
      allRequests.push(record);
    }

    updateStats();
    renderList();
    updateStatusText();
  });

  // ── 左右拖拽面板 resizer 逻辑 ──────────────────────────────────────────────
  let isResizing = false;

  panelResizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    panelResizer.classList.add('resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    previewWebview.style.pointerEvents = 'none'; // 屏蔽 webview，防卡死
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;

    const container = document.querySelector('.content-area');
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    let newWidth = containerRect.right - e.clientX - 4; // 扣除滑条偏移

    const minWidth = 250;
    const maxWidth = containerRect.width - 350; // 左侧列表最少保留 350px

    if (newWidth < minWidth) newWidth = minWidth;
    if (newWidth > maxWidth) newWidth = maxWidth;

    previewPanel.style.width = `${newWidth}px`;
  });

  document.addEventListener('mouseup', () => {
    if (!isResizing) return;
    isResizing = false;
    panelResizer.classList.remove('resizing');
    document.body.style.cursor = 'default';
    document.body.style.userSelect = 'auto';
    previewWebview.style.pointerEvents = 'auto'; // 恢复 webview 交互
  });
});

// ─── 发起全新网页分析 ──────────────────────────────────────────────────────────
async function startAnalysis() {
  let url = urlInput.value.trim();
  if (!url) {
    showToast('请输入有效的网址', 'error');
    urlInput.focus();
    return;
  }

  if (!/^https?:\/\//i.test(url)) {
    const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?::\d+)?$/;
    const isLocal = ipRegex.test(url) || url.toLowerCase().startsWith('localhost');
    url = (isLocal ? 'http://' : 'https://') + url;
  }
  
  // 确保退出历史状态
  exitHistoryMode();

  // 全新网页分析：绕过所有阻断规则，按实际原样内容显示
  window.electronAPI.updateBlockingState({ rules: blockRules, bypass: true });

  // 1. 同步进行物理重置：立刻销毁并重建 Webview 元素，彻底杀死其渲染进程并强行释放所有 Storage/缓存读写锁
  let newWebview = null;
  const parentNode = previewWebview.parentElement;
  if (parentNode) {
    newWebview = document.createElement('webview');
    newWebview.id = 'previewWebview';
    newWebview.partition = 'persist:preview';
    newWebview.allowpopups = true;
    // 去掉 src="about:blank" 以防 did-stop-loading 提前把 captures 关掉
    newWebview.style.cssText = 'width:100%; height:100%; border:none; background:#fff;';
    
    parentNode.replaceChild(newWebview, previewWebview);
    previewWebview = newWebview; // 重新指向最新的 DOM 节点
    
    // 重新绑定核心事件监听器
    bindWebviewEvents();
  }

  // 2. 此时锁已安全释放，执行异步清缓存，绝不卡死
  try {
    await window.electronAPI.clearCache();
  } catch (_) {}

  // 3. 缓存清理完毕，重置列表、开启捕获
  clearListAndReset();
  isCapturing = true; 

  // 4. 轮询等待 Webview Custom Element 升级就绪并安全调用 loadURL
  const startWaitTime = Date.now();
  const checkAndLoad = () => {
    // 防御并发点击：如果全局 webview 实例已被新的重置替换，则终止旧的轮询
    if (previewWebview !== newWebview) return;

    if (typeof previewWebview.loadURL === 'function') {
      try {
        previewWebview.loadURL(url, {
          extraHeaders: 'pragma: no-cache\r\ncache-control: no-cache\r\n'
        });
      } catch (err) {
        console.error('loadURL execution error, falling back to src:', err);
        previewWebview.src = url;
      }
    } else if (Date.now() - startWaitTime < 2000) {
      // 尚未就绪且未超时，下一帧继续重试
      requestAnimationFrame(checkAndLoad);
    } else {
      // 超时兜底（通常不可能发生，仅作极其罕见的系统故障降级）
      console.warn('Webview upgrading timed out, falling back to src.');
      previewWebview.src = url;
    }
  };

  checkAndLoad();
}

function clearListAndReset() {
  allRequests = [];
  currentScreenshot = '';
  updateStats();
  
  requestList.innerHTML = '';
  requestList.appendChild(emptyState);
  emptyState.classList.remove('hidden');
}

// ─── UI 交互切换 ───────────────────────────────────────────────────────────────
function setAnalyzingUI(loading) {
  analyzeBtn.disabled = loading;
  if (loading) {
    analyzeBtn.classList.add('loading');
    btnText.textContent = '载入中...';
    analysisStatus.classList.remove('hidden');
    statusText.textContent = '正在实时加载网页，捕获数据链路...';
  } else {
    analyzeBtn.classList.remove('loading');
    btnText.textContent = '分析网页';
    analysisStatus.classList.add('hidden');
  }
}

function updateStatusText() {
  const s = allRequests.filter((r) => r.success && !r.isBlocked).length;
  const b = allRequests.filter((r) => r.isBlocked).length;
  const f = allRequests.length - s - b;
  statusText.textContent =
    `捕获 ${allRequests.length} 请求 · 成功 ${s} · 阻断 ${b} · 失败 ${f}`;
}

function updateStats() {
  const total   = allRequests.length;
  const success = allRequests.filter((r) => r.success && !r.isBlocked).length;
  const failed  = allRequests.filter((r) => !r.success && !r.isBlocked).length;
  const uniqueIPs = new Set(
    allRequests.filter((r) => r.ipAddress && r.ipAddress !== '缓存').map((r) => r.ipAddress)
  ).size;

  totalCount.textContent   = total;
  successCount.textContent = success;
  failedCount.textContent  = failed;
  ipCount.textContent      = uniqueIPs;
}

// ─── 渲染网络列表 ─────────────────────────────────────────────────────────────
function renderList() {
  requestList.innerHTML = '';
  requestList.appendChild(emptyState);

  const filtered = allRequests.filter((r) => matchFilter(r) && matchSearch(r));

  if (filtered.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');
  const frag = document.createDocumentFragment();
  filtered.forEach((r) => frag.appendChild(buildRow(r)));
  requestList.appendChild(frag);
}

function buildRow(record) {
  const row = document.createElement('div');
  row.className = 'request-row';
  if (record.isBlocked) {
    row.classList.add('blocked-row');
  }
  row.title = '双击查看完整请求详情';

  // 状态徽章
  let badge;
  if (record.isBlocked) {
    badge = `<span class="badge badge-failed" style="background:rgba(244,63,94,0.15)">🚫</span>`;
  } else {
    badge = record.success
      ? `<span class="badge badge-success">✓</span>`
      : `<span class="badge badge-failed">✗</span>`;
  }

  const methodTag = `<span class="method-tag">${record.method || '-'}</span>`;

  const isIpValid = record.ipAddress && record.ipAddress !== '缓存' && record.ipAddress !== '—';
  const ipText = isIpValid
    ? `<a class="ip-link" href="#" style="color:var(--accent-light);text-decoration:underline;" title="点击尝试连接此 IP">${record.ipAddress}</a>`
    : `<span style="color:var(--text-muted)">—</span>`;

  const portText = record.port
    ? `<span style="color:var(--text-secondary);font-family:var(--font-mono)">${record.port}</span>`
    : `<span style="color:var(--text-muted)">—</span>`;

  const typeTag = `<span class="type-tag">${record.resourceType || '-'}</span>`;

  let codeHtml;
  if (record.isBlocked) {
    codeHtml = `<span class="code-err">已阻断</span>`;
  } else if (record.success && record.status) {
    const cls = record.status < 300 ? 'code-2xx'
              : record.status < 400 ? 'code-3xx'
              : record.status < 500 ? 'code-4xx'
              : 'code-5xx';
    codeHtml = `<span class="${cls}">${record.status} ${record.statusText || ''}</span>`;
  } else {
    const errShort = (record.error || '失败').substring(0, 18);
    codeHtml = `<span class="code-err" title="${record.error || ''}">${errShort}</span>`;
  }

  // 阻断与允许规则状态判断
  const ruleMatched = checkUrlBlockedByRules(record.url);
  const actionButton = ruleMatched
    ? `<button class="btn-control-allow" title="解封该 URL 的加载规则">允许</button>`
    : `<button class="btn-control-block" title="阻断并拦截此 URL 发起的请求">阻断</button>`;

  row.innerHTML = `
    <div class="col col-id" style="color:var(--text-muted);font-family:var(--font-mono)">${record.id || '-'}</div>
    <div class="col col-status">${badge}</div>
    <div class="col col-url"><span class="url-text" title="${escHtml(record.url)}">${escHtml(record.url)}</span></div>
    <div class="col col-method">${methodTag}</div>
    <div class="col col-ip">${ipText}</div>
    <div class="col col-port">${portText}</div>
    <div class="col col-type">${typeTag}</div>
    <div class="col col-code">${codeHtml}</div>
    <div class="col col-action">${actionButton}</div>
  `;

  // 行事件：双击看详情
  row.addEventListener('dblclick', () => showDetail(record));

  // 控制按钮绑定
  const btnAct = row.querySelector('.col-action button');
  btnAct.addEventListener('click', (e) => {
    e.stopPropagation();
    if (ruleMatched) {
      // 允许操作：从规则中移除
      removeBlockRule(record.url);
    } else {
      // 阻断操作：加入规则
      addBlockRule(record.url);
    }
  });

  // 绑定 IP 点击连接事件
  if (isIpValid) {
    const ipLink = row.querySelector('.ip-link');
    if (ipLink) {
      ipLink.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        try {
          const parsed = new URL(record.url);
          const protocol = parsed.protocol;
          const port = record.port ? `:${record.port}` : '';
          const path = parsed.pathname || '';
          const search = parsed.search || '';
          const ipUrl = `${protocol}//${record.ipAddress}${port}${path}${search}`;
          
          urlInput.value = ipUrl;
          startAnalysis();
        } catch (err) {
          showToast('无法生成有效的连接链接', 'error');
        }
      });
    }
  }

  return row;
}

// ─── 阻断拦截规则处理 ─────────────────────────────────────────────────────────
function checkUrlBlockedByRules(url) {
  return blockRules.includes(url);
}

function addBlockRule(url) {
  if (!blockRules.includes(url)) {
    blockRules.push(url);
    saveBlockRules();
    showToast('已阻断该特定请求', 'warning');
    renderList();
  }
}

function removeBlockRule(url) {
  if (blockRules.includes(url)) {
    blockRules = blockRules.filter(r => r !== url);
    saveBlockRules();
    showToast('已解除阻断', 'success');
    renderList();
  }
}

function saveBlockRules() {
  localStorage.setItem('blockRules', JSON.stringify(blockRules));
  // 同步到主进程
  window.electronAPI.updateBlockingState({ rules: blockRules, bypass: false });
}

// ─── 过滤器匹配 ───────────────────────────────────────────────────────────────
function matchFilter(record) {
  if (activeFilter === 'success') return record.success && !record.isBlocked;
  if (activeFilter === 'failed')  return !record.success || record.isBlocked;
  return true;
}

function matchSearch(record) {
  if (!searchQuery) return true;
  return (
    record.url.toLowerCase().includes(searchQuery) ||
    (record.ipAddress && record.ipAddress.includes(searchQuery)) ||
    (record.resourceType && record.resourceType.includes(searchQuery))
  );
}

// ─── 历史查看模式切换 ──────────────────────────────────────────────────────────
function exitHistoryMode() {
  if (!isHistoryMode) return;
  isHistoryMode = false;
  
  previewTitle.textContent = '网页实时预览';
  btnExitHistory.classList.add('hidden');
  
  // 恢复 Webview 显示，隐藏历史图片层
  previewWebview.style.display = 'block';
  screenshotOverlay.classList.add('hidden');
}

// ─── 详情与大图弹窗 ───────────────────────────────────────────────────────────
function showDetail(record) {
  const isIpValid = record.ipAddress && record.ipAddress !== '缓存' && record.ipAddress !== '—';
  const ipValueHtml = isIpValid
    ? `<a class="detail-ip-link" href="#" style="color:var(--accent-light);text-decoration:underline;" title="点击尝试连接此 IP">${record.ipAddress}</a>`
    : (record.ipAddress ? `<span style="color:var(--ip-color)">${record.ipAddress}</span>` : '—');

  const rows = [
    ['URL',      `<a style="color:var(--accent-light);word-break:break-all">${escHtml(record.url)}</a>`],
    ['请求方法', record.method || '—'],
    ['连接状态', record.isBlocked ? '<span style="color:var(--error)">🚫 已阻断</span>' : (record.success ? '<span style="color:var(--success)">✓ 成功</span>' : '<span style="color:var(--error)">✗ 失败</span>')],
    ['HTTP 状态', record.status ? `${record.status} ${record.statusText || ''}` : '—'],
    ['IP 地址',  ipValueHtml],
    ['端口',     record.port ? String(record.port) : '—'],
    ['资源类型', record.resourceType || '—'],
    record.error ? ['错误信息', `<span style="color:var(--error)">${escHtml(record.error)}</span>`] : null,
    ['捕获时间', new Date(record.timestamp).toLocaleString()],
  ].filter(Boolean);

  detailContent.innerHTML = rows
    .map(([label, value]) => `
      <div class="detail-row">
        <span class="detail-label">${label}</span>
        <span class="detail-value">${value}</span>
      </div>`)
    .join('');

  detailModal.classList.remove('hidden');

  // 绑定 IP 点击连接事件
  if (isIpValid) {
    const detailIpLink = detailContent.querySelector('.detail-ip-link');
    if (detailIpLink) {
      detailIpLink.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        try {
          const parsed = new URL(record.url);
          const protocol = parsed.protocol;
          const port = record.port ? `:${record.port}` : '';
          const path = parsed.pathname || '';
          const search = parsed.search || '';
          const ipUrl = `${protocol}//${record.ipAddress}${port}${path}${search}`;
          
          detailModal.classList.add('hidden'); // 关闭详情弹窗
          urlInput.value = ipUrl;
          startAnalysis();
        } catch (err) {
          showToast('无法生成有效的连接链接', 'error');
        }
      });
    }
  }
}

function showBigImage() {
  if (screenshotImg.src && screenshotImg.src !== window.location.href) {
    lightboxImg.src = screenshotImg.src;
    imageLightbox.classList.remove('hidden');
  }
}

function hideBigImage() {
  imageLightbox.classList.add('hidden');
}

// ─── 历史列表拉取 ─────────────────────────────────────────────────────────────
async function toggleHistoryDrawer() {
  const isHidden = historyDrawer.classList.contains('hidden');
  if (isHidden) {
    await loadHistoryList();
    historyDrawer.classList.remove('hidden');
    historyBackdrop.classList.remove('hidden');
  } else {
    hideHistoryDrawer();
  }
}

function hideHistoryDrawer() {
  historyDrawer.classList.add('hidden');
  historyBackdrop.classList.add('hidden');
}

async function loadHistoryList() {
  try {
    const list = await window.electronAPI.getHistoryList();
    renderHistoryList(list);
  } catch (err) {
    showToast('获取历史列表失败：' + err.message, 'error');
  }
}

function renderHistoryList(list) {
  const items = historyList.querySelectorAll('.history-item');
  items.forEach(el => el.remove());

  if (!list || list.length === 0) {
    btnClearAllHistory.classList.add('hidden');
    emptyHistory.classList.remove('hidden');
    return;
  }

  btnClearAllHistory.classList.remove('hidden');
  emptyHistory.classList.add('hidden');
  const frag = document.createDocumentFragment();

  list.forEach(item => {
    const div = document.createElement('div');
    div.className = 'history-item';
    
    const dateStr = new Date(item.timestamp).toLocaleString(undefined, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

    div.innerHTML = `
      <div class="history-item-info">
        <div class="history-item-url" title="${escHtml(item.url)}">${escHtml(item.url)}</div>
        <div class="history-item-meta">
          <span class="history-item-time">${dateStr}</span>
          <span class="history-item-stats">
            共 ${item.total} 项 · 
            <span class="history-item-success">${item.success}✓</span> · 
            <span class="history-item-failed">${item.failed}✗</span>
          </span>
        </div>
      </div>
      <button class="btn-delete-history" title="删除记录">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
      </button>
    `;

    div.addEventListener('click', (e) => {
      if (e.target.closest('.btn-delete-history')) return;
      loadHistoryItem(item.id);
    });

    const btnDel = div.querySelector('.btn-delete-history');
    btnDel.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`确定要永久删除 ${item.url} 的这次分析记录吗？`)) {
        try {
          const res = await window.electronAPI.deleteHistory(item.id);
          if (res.success) {
            showToast('已删除历史记录', 'success');
            loadHistoryList();
          } else {
            showToast('删除失败：' + res.error, 'error');
          }
        } catch (err) {
          showToast('删除异常：' + err.message, 'error');
        }
      }
    });

    frag.appendChild(div);
  });

  historyList.appendChild(frag);
}

// 载入指定的历史快照
async function loadHistoryItem(id) {
  try {
    const res = await window.electronAPI.loadHistoryDetail(id);
    if (res.success && res.data) {
      const detail = res.data;
      
      isHistoryMode = true;
      
      // 更新全局列表并渲染
      allRequests = detail.requests;
      updateStats();
      renderList();
      
      // 切换预览栏为静态图片查看状态
      previewTitle.textContent = '历史分析快照（只读）';
      btnExitHistory.classList.remove('hidden');
      
      previewWebview.style.display = 'none'; // 隐藏 webview
      screenshotOverlay.classList.remove('hidden'); // 显示图片覆盖层
      
      if (detail.screenshot) {
        screenshotImg.src = detail.screenshot;
      } else {
        screenshotImg.src = '';
      }

      urlInput.value = detail.url;

      showToast(`已成功载入历史快照记录 (${allRequests.length} 项)`, 'success');
      hideHistoryDrawer();
    } else {
      showToast('加载历史失败：' + (res.error || '数据不存在'), 'error');
    }
  } catch (err) {
    showToast('加载历史发生异常：' + err.message, 'error');
  }
}

// ─── 数据导出 ─────────────────────────────────────────────────────────────────
async function doExport(format) {
  if (allRequests.length === 0) {
    showToast('暂无数据可导出', 'warning');
    return;
  }
  const result = await window.electronAPI.exportData({ data: allRequests, format });
  if (result.success) {
    showToast(`已导出 ${format.toUpperCase()} 文件`, 'success');
  } else if (result && !result.success && result.error) {
    showToast('导出失败：' + result.error, 'error');
  }
}

// ─── Toast 提示 ───────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = 'info') {
  toast.textContent = msg;
  toast.className   = `toast ${type} show`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

// ─── 逃逸 HTML ────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── 统计指标联动与唯一 IP 聚合分析 ──────────────────────────────────────────────
function triggerFilter(filterType) {
  activeFilter = filterType;
  
  filterBtns.forEach((b) => {
    if (b.dataset.filter === filterType) {
      b.classList.add('active');
    } else {
      b.classList.remove('active');
    }
  });
  
  renderList();
  showToast(`已筛选: ${filterType === 'all' ? '全部请求' : filterType === 'success' ? '连接成功' : '连接失败'}`, 'info');
}

function openIpAnalysisModal() {
  const ipMap = new Map();
  
  allRequests.forEach(r => {
    const ip = r.ipAddress;
    if (!ip || ip === '缓存' || ip === '—') return;
    
    let domain = '';
    try {
      domain = new URL(r.url).hostname;
    } catch (_) {
      domain = r.url;
    }

    if (ipMap.has(ip)) {
      const data = ipMap.get(ip);
      data.count++;
      if (domain) data.domains.add(domain);
    } else {
      ipMap.set(ip, {
        count: 1,
        domains: new Set(domain ? [domain] : [])
      });
    }
  });

  if (ipMap.size === 0) {
    ipContent.innerHTML = `
      <div class="empty-ips">
        <span>当前分析中暂无可用物理连接 IP 地址</span>
      </div>
    `;
  } else {
    let tableHtml = `
      <div class="ip-table-container">
        <table class="ip-table">
          <thead>
            <tr>
              <th>IP 地址</th>
              <th style="width: 80px; text-align: center;">请求次数</th>
              <th>承载域名</th>
            </tr>
          </thead>
          <tbody>
    `;

    ipMap.forEach((data, ip) => {
      const domainsArray = Array.from(data.domains);
      const badges = domainsArray.map(d => `<span class="ip-domain-badge" title="${d}">${d}</span>`).join('');
      
      tableHtml += `
        <tr class="ip-row" data-ip="${ip}" title="点击该行以过滤查看此 IP">
          <td class="ip-addr-col">${ip}</td>
          <td class="ip-count-col" style="text-align: center;">${data.count}</td>
          <td class="ip-domains-col">${badges}</td>
        </tr>
      `;
    });

    tableHtml += `
          </tbody>
        </table>
      </div>
      <div style="margin-top: 12px; font-size: 11px; color: var(--text-muted); text-align: center;">
        * 提示：点击表格中任意 IP，即可自动关闭并过滤显示该 IP 发生的所有通信
      </div>
    `;
    
    ipContent.innerHTML = tableHtml;

    const rows = ipContent.querySelectorAll('.ip-row');
    rows.forEach(row => {
      row.addEventListener('click', () => {
        const ip = row.dataset.ip;
        searchInput.value = ip;
        searchQuery = ip.toLowerCase();
        
        triggerFilter('all'); // 重置为显示全部以触发多维筛选
        
        ipModal.classList.add('hidden');
        showToast(`已为您筛选 IP: ${ip}`, 'success');
      });
    });
  }

  ipModal.classList.remove('hidden');
}

// ─── 集中绑定 Webview 事件监听器 ────────────────────────────────────────────────
function bindWebviewEvents() {
  if (!previewWebview) return;

  previewWebview.addEventListener('did-start-loading', () => {
    if (isCapturing) {
      setAnalyzingUI(true);
      updateStatusText();
    }
  });

  previewWebview.addEventListener('did-fail-load', (e) => {
    // 过滤掉非主框架的加载失败，以及因为跳转、重定向或用户手动停止导致的加载取消（-3 ERR_ABORTED）
    if (!e.isMainFrame || e.errorCode === -3) {
      return;
    }

    if (isCapturing) {
      setAnalyzingUI(false);
      isCapturing = false;
      updateStatusText();
      showToast(`网页加载失败，请检查网址或网络连接 (${e.errorDescription || e.errorCode})`, 'error');
    }
  });

  previewWebview.addEventListener('did-stop-loading', async () => {
    if (isCapturing) {
      setAnalyzingUI(false);
      updateStatusText();
      
      // 如果不是历史查看模式，实时对预览区截图，作为快照保存
      if (!isHistoryMode) {
        try {
          const image = await previewWebview.capturePage();
          currentScreenshot = image.toDataURL('image/jpeg', 0.7);
          
          // 自动调用 IPC 写入历史记录归档
          let url = urlInput.value.trim() || previewWebview.getURL();
          if (url && url !== 'about:blank') {
            window.electronAPI.saveHistory({
              url: url,
              requests: allRequests,
              screenshot: currentScreenshot
            });
          }
        } catch (_) {}
      }
      isCapturing = false; // 分析完成，关闭捕获
    }
    
    // 页面完全载入后恢复阻断状态，确保用户在网页上进行点击等操作时，拦截依然有效
    window.electronAPI.updateBlockingState({ rules: blockRules, bypass: false });
  });

  // 拦截并接管 webview 中由于 target="_blank" 或 window.open 发起的新窗口打开事件
  // 将其强制在当前预览 webview 中直接导航，解决跳转无反应的问题
  const handleNewWindowRedirect = (e) => {
    e.preventDefault();
    const targetUrl = e.url || (e.detail && e.detail.url);
    if (targetUrl && targetUrl !== 'about:blank') {
      try {
        previewWebview.loadURL(targetUrl);
      } catch (err) {
        console.error('Failed to load redirect URL from new-window:', err);
        previewWebview.src = targetUrl;
      }
    }
  };

  previewWebview.addEventListener('new-window', handleNewWindowRedirect);
  previewWebview.addEventListener('create-window', handleNewWindowRedirect);
}
