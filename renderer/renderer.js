/* ═══════════════════════════════════════════════════════════
   Web Request Analysis Tool  |  前端交互逻辑
   ═══════════════════════════════════════════════════════════ */

'use strict';



// ─── 全局状态 ─────────────────────────────────────────────────────────────────
let allRequests      = [];  // 存放当前会话抓取的所有请求
let activeFilter     = 'all';
let searchQuery      = '';
let blockRules       = [];  // 拦截阻断规则数组 (包含匹配关键字或正则)
let currentScreenshot = ''; // 存入当前完全加载后的 webview 截图 Base64
let isHistoryMode    = false;
let isCapturing      = false; // 标识当前会话是否处于捕获监听状态（在右侧操作时保持开启，支持实时联动）
let isAnalyzing      = false; // 标识是否处于网页主框架首次或全量加载中（控制顶部按钮加载状态）
let originalAnalysisUrl = ''; // 存放最初发起分析的原始 URL，用于防退化历史归档
let activeCaptureNavigationUrl = ''; // 当前捕获轮次对应的主框架导航地址，用于导航事件去重
let saveSnapshotDebounceTimer = null; // 用户在右侧操作后触发网络请求的防抖快照同步定时器
let activeNavigationSessionId = null; // 当前正在分析展示的页面导航会话 ID
let activeNavigationEpoch = 0; // 单调自增的导航代数，用于智能时序自适应对齐，消除丢包
let isHistoryNavigating = false; // 标记是否由后退/前进按钮触发的历史状态恢复（主动点击链接导航绝不触发历史覆盖）
let lastNewWindowRedirectUrl = ''; // 新窗口重定向防重 URL 记录
let lastNewWindowRedirectTime = 0; // 新窗口重定向防重时间戳
const pageSessionMap = new Map(); // 内存级页面会话快照记忆表 (标准化 URL -> { url, requests, screenshot, sessionId, timestamp })

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
const exportDomain    = document.getElementById('exportDomain');
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
  if (exportDomain) exportDomain.addEventListener('click', () => doExport('domain-report'));
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
          pageSessionMap.clear();
          activeNavigationEpoch = 0;
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
    if (previewWebview.canGoBack()) {
      saveCurrentPageSnapshot(); // 先将当前页面的全量网络数据记录入记忆档案
      isHistoryNavigating = true; // 标记这是后退历史导航，允许还原快照
      previewWebview.goBack();
    }
  });
  btnWebviewForward.addEventListener('click', () => {
    if (previewWebview.canGoForward()) {
      saveCurrentPageSnapshot(); // 先将当前页面的全量网络数据记录入记忆档案
      isHistoryNavigating = true; // 标记这是前进历史导航，允许还原快照
      previewWebview.goForward();
    }
  });
  btnWebviewReload.addEventListener('click', () => {
    // 强力刷新：优先读取当前 URL 强行导航，若读取不到或无效，回退读取输入框最新 URL 并强制加载
    let reloadUrl = '';
    try {
      reloadUrl = previewWebview.getURL();
    } catch (_) {}

    if (!reloadUrl || reloadUrl === 'about:blank') {
      reloadUrl = autoCompleteUrl(urlInput.value.trim());
    }

    // 用户主动点击刷新：清除该页面的历史记忆档案，确保无缓存全量重新抓取最新网络链路
    isHistoryNavigating = false;
    const norm = normalizePageUrl(reloadUrl);
    if (norm) {
      pageSessionMap.delete(norm);
    }

    clearListAndReset();
    beginPreviewCapture(reloadUrl, true);

    // 开启拦截模式并刷新内嵌 webview。
    window.electronAPI.updateBlockingState({ rules: blockRules, bypass: false });

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

    // 解析当前网络包的代数（单调自增 Epoch）
    const recordEpoch = typeof record.navigationEpoch === 'number'
      ? record.navigationEpoch
      : (typeof record.navigationSessionId === 'number' ? record.navigationSessionId : 0);

    // 核心智能代数时序对齐：
    // 1. 若请求代数小于当前活跃代数：说明确实是上一个页面的旧延迟包，果断丢弃（物理阻断防叠加）！
    if (recordEpoch > 0 && activeNavigationEpoch > 0 && recordEpoch < activeNavigationEpoch) {
      return;
    }

    // 2. 核心突破：若请求代数大于当前活跃代数！
    // 说明新页面的网络包已经率先以极速到达（比 IPC 的 page-navigation-reset 还快！前几十个 CSS/JS 就在这里！）
    // 绝不能丢弃！立即自动自适应对齐新代数，保存旧页面并切换开启新会话，100% 收录先行到达的新包！
    if (recordEpoch > activeNavigationEpoch) {
      activeNavigationEpoch = recordEpoch;
      activeNavigationSessionId = recordEpoch;
      saveCurrentPageSnapshot(); // 固化上一个页面数据
      clearListAndReset();       // 清空列表，以率先到达的新页面为主体展示
      isCapturing = true;
      setAnalyzingUI(true);
      updateStatusText();
    } else if (recordEpoch > 0 && activeNavigationEpoch === 0) {
      activeNavigationEpoch = recordEpoch;
      activeNavigationSessionId = recordEpoch;
    }

    if (!isCapturing) return;  // 未开启会话分析时不捕获

    // 按 requestId 查重，更新或追加
    const existingIndex = allRequests.findIndex(r => r.requestId === record.requestId);
    let isNewRecord = false;

    if (existingIndex !== -1) {
      // 避免 responseStarted 覆盖已阻断状态
      if (allRequests[existingIndex].isBlocked) {
        return;
      }
      // 保留原有序号
      const existingId = allRequests[existingIndex].id;
      allRequests[existingIndex] = { ...allRequests[existingIndex], ...record, id: existingId };
    } else {
      isNewRecord = true;
      // 分配清晰自增序号
      record.id = allRequests.length + 1;
      allRequests.push(record);
    }

    updateStats();
    updateStatusText();

    // 智能增量渲染与高亮联动：
    // 若为新记录，直接进行增量渲染并触发高亮微动效与平滑滚动；已有记录则就地更新状态
    if (isNewRecord) {
      handleNewRequestAppended(record);
      scheduleSnapshotUpdate();
    } else {
      updateExistingRow(record);
    }
  });

  // ── 集中单次注册全局 IPC 监听器（杜绝重建 Webview 时重复叠加挂载） ──────────────────
  // 1. 监听独立大预览窗口发起的跨页导航，同步切换为主界面显示新窗口的数据
  if (window.electronAPI && typeof window.electronAPI.onPreviewWindowNavigated === 'function') {
    window.electronAPI.onPreviewWindowNavigated(({ url: navUrl }) => {
      if (isHistoryMode || !navUrl || navUrl === 'about:blank') return;
      urlInput.value = navUrl;
      beginPreviewCapture(navUrl);
    });
  }

  // 2. 监听来自主进程网络底层的 mainFrame 导航重置（物理级开启新页面会话，彻底防跨页数据叠加）
  if (window.electronAPI && typeof window.electronAPI.onPageNavigationReset === 'function') {
    window.electronAPI.onPageNavigationReset(({ epoch, sessionId, url: navUrl }) => {
      if (isHistoryMode) return;
      const targetEpoch = typeof epoch === 'number'
        ? epoch
        : (typeof sessionId === 'number' ? sessionId : activeNavigationEpoch + 1);

      if (navUrl && navUrl !== 'about:blank') {
        urlInput.value = navUrl;
      }

      // 若先行网络包已经完成了代数自适应升级，则只需同步 URL，不再重复清空已收录的先行网络包！
      if (targetEpoch > activeNavigationEpoch) {
        activeNavigationEpoch = targetEpoch;
        activeNavigationSessionId = targetEpoch;
        beginPreviewCapture(navUrl);
      } else {
        // 先行包已成功对齐并收录首批请求，同步原始分析 URL 确保快照与历史归档一致
        if (navUrl && navUrl !== 'about:blank') {
          originalAnalysisUrl = navUrl;
        }
      }
    });
  }

  // 3. 监听来自主进程底层接管的网页弹出新窗口事件（target="_blank" 或 window.open）
  if (window.electronAPI && typeof window.electronAPI.onOpenUrlInPreview === 'function') {
    window.electronAPI.onOpenUrlInPreview(({ url: targetUrl }) => {
      if (isHistoryMode || !targetUrl || targetUrl === 'about:blank') return;
      if (lastNewWindowRedirectUrl === targetUrl && Date.now() - lastNewWindowRedirectTime < 350) return;
      lastNewWindowRedirectUrl = targetUrl;
      lastNewWindowRedirectTime = Date.now();
      isHistoryNavigating = false;

      urlInput.value = targetUrl;
      beginPreviewCapture(targetUrl);
      try {
        if (typeof previewWebview.loadURL === 'function') {
          previewWebview.loadURL(targetUrl);
        } else {
          previewWebview.src = targetUrl;
        }
      } catch (_) {
        try { previewWebview.src = targetUrl; } catch (_) {}
      }
    });
  }

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

  url = autoCompleteUrl(url);
  originalAnalysisUrl = url; // 记录原始 URL
  
  // 确保退出历史状态
  exitHistoryMode();

  // 核心前置无条件强制重置：彻底消除连续点击分析按钮导致的并发锁拦截与数据叠加
  isAnalyzing = false;
  isHistoryNavigating = false;
  activeCaptureNavigationUrl = '';
  activeNavigationEpoch = 0;
  activeNavigationSessionId = null;
  const norm = normalizePageUrl(url);
  if (norm) pageSessionMap.delete(norm);
  clearListAndReset(); // 无条件强制清空列表与统计指标，绝不受任何防并发锁拦截！

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

  // 3. 缓存清理完毕，重置列表、开启全新捕获
  activeNavigationEpoch = 0;
  if (norm) pageSessionMap.delete(norm);
  beginPreviewCapture(url, true);

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

// ─── 页面会话记忆与智能状态恢复 ─────────────────────────────────────────────────
function normalizePageUrl(urlStr) {
  if (!urlStr || urlStr === 'about:blank') return '';
  try {
    const u = new URL(urlStr);
    let pathname = u.pathname;
    if (pathname.endsWith('/') && pathname.length > 1) {
      pathname = pathname.slice(0, -1);
    }
    // 常见默认首页归一化 (如 /index.html, /index.htm, /index.php 归一到根路径)
    if (/^\/index\.(?:html?|php|jsp|asp|aspx)$/i.test(pathname)) {
      pathname = '';
    }
    return `${u.protocol}//${u.host}${pathname}${u.search}`;
  } catch (_) {
    return urlStr.trim().replace(/\/+$/, '');
  }
}

// 保存当前页面的全量网络数据和快照至记忆档案表
function saveCurrentPageSnapshot() {
  if (isHistoryMode || allRequests.length === 0) return;
  const url = originalAnalysisUrl || (previewWebview && typeof previewWebview.getURL === 'function' ? previewWebview.getURL() : '') || urlInput.value.trim();
  const normUrl = normalizePageUrl(url);
  if (!normUrl) return;

  pageSessionMap.set(normUrl, {
    url: url,
    requests: allRequests.map(r => ({ ...r })), // 深克隆数组保证快照独立
    screenshot: currentScreenshot,
    sessionId: activeNavigationSessionId,
    timestamp: Date.now()
  });
}

// 尝试从记忆档案表中恢复目标页面的全量网络数据与看板状态
function tryRestorePageSession(targetUrl) {
  if (isHistoryMode) return false;
  const normUrl = normalizePageUrl(targetUrl);
  if (!normUrl || !pageSessionMap.has(normUrl)) {
    return false;
  }

  const sessionData = pageSessionMap.get(normUrl);
  if (!sessionData || !Array.isArray(sessionData.requests) || sessionData.requests.length === 0) {
    return false;
  }

  // 成功命中已访问页面的历史记忆档案！
  allRequests = sessionData.requests.map(r => ({ ...r }));
  currentScreenshot = sessionData.screenshot || '';
  activeNavigationSessionId = sessionData.sessionId || null;
  originalAnalysisUrl = sessionData.url || targetUrl;
  urlInput.value = sessionData.url || targetUrl;

  // 完整还原左侧分析看板！
  updateStats();
  renderList();
  setAnalyzingUI(false);
  updateStatusText();

  showToast(`已为您智能还原该页面的全量网络数据 (${allRequests.length} 条)`, 'info');
  return true;
}

function clearListAndReset() {
  allRequests = [];
  currentScreenshot = '';
  if (saveSnapshotDebounceTimer) {
    clearTimeout(saveSnapshotDebounceTimer);
    saveSnapshotDebounceTimer = null;
  }
  updateStats();
  
  requestList.innerHTML = '';
  requestList.appendChild(emptyState);
  emptyState.classList.remove('hidden');
}

// 开始捕获预览区当前页面的一轮新请求。用于手动刷新、前进/后退、新窗口弹出以及网页内部跳转。
function beginPreviewCapture(navigationUrl = '', forceReset = false) {
  if (isHistoryMode) return;

  const captureUrl = navigationUrl && navigationUrl !== 'about:blank' ? navigationUrl : '';
  // 在同一次正在加载的主框架跳转中（isAnalyzing === true 时），will-navigate 与 did-start-navigation
  // 会为同一次跳转连续触发；此时只初始化一次，避免在首批网络请求已经进入时再次清空列表。
  if (isAnalyzing && captureUrl && activeCaptureNavigationUrl === captureUrl) {
    return;
  }

  // 1. 在离开当前页面前，先保存当前页面的全量网络快照入记忆表
  saveCurrentPageSnapshot();

  if (captureUrl) {
    originalAnalysisUrl = captureUrl;
  }
  activeCaptureNavigationUrl = captureUrl;

  // 2. 只有在明确的前进/后退历史导航下且非强制重置时，才从记忆表中还原快照；主动点击链接导航一律彻底清空开启全新捕获！
  if (!forceReset && isHistoryNavigating && captureUrl && tryRestorePageSession(captureUrl)) {
    isHistoryNavigating = false;
    isCapturing = true;
    return;
  }

  // 3. 主动导航（包含点击 Logo、同页重载、内页跳转等）：无条件清空列表，序号从 1 重新开始，绝不翻倍叠加
  clearListAndReset();
  isCapturing = true; // 开启持续捕获大网，支持新窗口及右侧操作实时联动
  setAnalyzingUI(true);
  updateStatusText();
}

// ─── UI 交互切换 ───────────────────────────────────────────────────────────────
function setAnalyzingUI(loading) {
  isAnalyzing = loading;
  analyzeBtn.disabled = loading;
  const statusDot = analysisStatus ? analysisStatus.querySelector('.status-dot') : null;

  if (loading) {
    analyzeBtn.classList.add('loading');
    btnText.textContent = '载入中...';
    analysisStatus.classList.remove('hidden');
    if (statusDot) statusDot.classList.remove('live');
    statusText.textContent = '正在实时加载网页，捕获数据链路...';
  } else {
    analyzeBtn.classList.remove('loading');
    btnText.textContent = '分析网页';
    // 网页加载完成后，只要处于捕获状态且不是历史模式，保持状态栏并激活绿色实时联动呼吸灯
    if (isCapturing && !isHistoryMode) {
      analysisStatus.classList.remove('hidden');
      if (statusDot) statusDot.classList.add('live');
      updateStatusText();
    } else {
      analysisStatus.classList.add('hidden');
      if (statusDot) statusDot.classList.remove('live');
    }
  }
}

function updateStatusText() {
  const s = allRequests.filter((r) => r.success && !r.isBlocked).length;
  const b = allRequests.filter((r) => r.isBlocked).length;
  const f = allRequests.length - s - b;

  if (isAnalyzing) {
    statusText.textContent =
      `正在实时加载网页... 捕获 ${allRequests.length} 请求 · 成功 ${s} · 阻断 ${b} · 失败 ${f}`;
  } else if (isCapturing && !isHistoryMode) {
    statusText.textContent =
      `实时联动中 · 捕获 ${allRequests.length} 请求 · 成功 ${s} · 阻断 ${b} · 失败 ${f}`;
  } else {
    statusText.textContent =
      `捕获 ${allRequests.length} 请求 · 成功 ${s} · 阻断 ${b} · 失败 ${f}`;
  }
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
  filtered.forEach((r) => {
    const row = buildRow(r);
    row.dataset.requestId = String(r.requestId);
    frag.appendChild(row);
  });
  requestList.appendChild(frag);
}

// 增量追加新捕获请求行并应用微动效与智能平滑滚动
function handleNewRequestAppended(record) {
  if (!matchFilter(record) || !matchSearch(record)) {
    return;
  }

  emptyState.classList.add('hidden');

  // 判断是否处于列表底部附近（距离底部小于 150px 则自动平滑跟随最新操作）
  const isNearBottom = requestList.scrollHeight - requestList.scrollTop - requestList.clientHeight < 150;

  const row = buildRow(record);
  row.dataset.requestId = String(record.requestId);
  row.classList.add('new-captured-highlight');

  requestList.appendChild(row);

  if (isNearBottom && typeof row.scrollIntoView === 'function') {
    row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// 增量更新已存在的请求行状态（如响应状态码或最终 IP 解析就绪）
function updateExistingRow(record) {
  const row = requestList.querySelector(`[data-request-id="${record.requestId}"]`);
  if (row) {
    const newRow = buildRow(record);
    newRow.dataset.requestId = String(record.requestId);
    if (row.classList.contains('new-captured-highlight')) {
      newRow.classList.add('new-captured-highlight');
    }
    requestList.replaceChild(newRow, row);
  }
}

// 当用户在右侧预览区进行交互产生新网络请求后，防抖更新快照与历史归档
function scheduleSnapshotUpdate() {
  if (isHistoryMode || isAnalyzing) return;
  if (saveSnapshotDebounceTimer) {
    clearTimeout(saveSnapshotDebounceTimer);
  }
  saveSnapshotDebounceTimer = setTimeout(async () => {
    try {
      if (previewWebview && typeof previewWebview.capturePage === 'function') {
        const image = await previewWebview.capturePage();
        currentScreenshot = image.toDataURL('image/jpeg', 0.7);

        let url = originalAnalysisUrl || urlInput.value.trim() || previewWebview.getURL();
        if (url && url !== 'about:blank') {
          saveCurrentPageSnapshot(); // 同步更新内存记忆档案
          window.electronAPI.saveHistory({
            url: url,
            requests: allRequests,
            screenshot: currentScreenshot
          });
        }
      }
    } catch (_) {}
  }, 1500);
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

  // 恢复实时会话的统计与状态栏指示
  updateStats();
  if (isCapturing) {
    setAnalyzingUI(false);
  } else {
    analysisStatus.classList.add('hidden');
  }
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

      // 载入历史记录时，状态栏同步更新为历史只读归档提示
      const statusDot = analysisStatus ? analysisStatus.querySelector('.status-dot') : null;
      if (statusDot) statusDot.classList.remove('live');
      analysisStatus.classList.remove('hidden');
      const timeStr = detail.timestamp ? new Date(detail.timestamp).toLocaleString() : '';
      statusText.textContent = `历史分析快照 · 归档 ${allRequests.length} 请求 · 记录时间 ${timeStr}`;

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
    showToast('暂无数据可导出，请先分析网页', 'warning');
    return;
  }
  const result = await window.electronAPI.exportData({ data: allRequests, format });
  if (result && result.success) {
    const label = format === 'domain-report' ? '域名与 IP 清单报告' : format.toUpperCase();
    showToast(`已成功导出 ${label} 文件`, 'success');
  } else if (result && !result.success && result.error && result.error !== '用户取消了导出') {
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

  // 实时同步 Webview 的真实导航地址到顶部地址栏
  previewWebview.addEventListener('did-navigate', (e) => {
    if (e.url && e.url !== 'about:blank') {
      urlInput.value = e.url;
      // 智能检测：仅在用户点击后退、前进触发的历史导航中，才优先从记忆档案中还原数据；普通链接导航绝不覆盖
      if (isHistoryNavigating) {
        const restored = tryRestorePageSession(e.url);
        isHistoryNavigating = false;
        if (!restored) {
          originalAnalysisUrl = e.url;
        }
      } else {
        originalAnalysisUrl = e.url;
      }
    }
  });
  previewWebview.addEventListener('did-navigate-in-page', (e) => {
    if (e.url && e.url !== 'about:blank') {
      urlInput.value = e.url;
      if (isHistoryNavigating) {
        tryRestorePageSession(e.url);
        isHistoryNavigating = false;
      }
    }
  });

  // 对用户点击链接和页面脚本跳转，will-navigate 在网络请求前触发。
  // 这是重新开始捕获的主入口，避免错过目标页的首批请求。
  previewWebview.addEventListener('will-navigate', (e) => {
    if (!isHistoryMode) {
      const targetUrl = e.url;
      if (targetUrl && targetUrl !== 'about:blank') {
        urlInput.value = targetUrl;
      }
      beginPreviewCapture(targetUrl);
    }
  });

  // 用户在预览页点击链接、脚本跳转或浏览器自身发生页面导航时，
  // 用作 will-navigate 未触发场景的兜底；同页锚点跳转不需要重新抓取。
  previewWebview.addEventListener('did-start-navigation', (e) => {
    if (!e.isMainFrame || e.isInPlace || isHistoryMode) return;
    beginPreviewCapture(e.url);
  });

  // 捕获并输出内嵌 Webview 的控制台错误，帮助排查无法跳转或白屏的根源
  previewWebview.addEventListener('console-message', (e) => {
    // level: 0 = info, 1 = warning, 2 = error
    if (e.level === 2) {
      console.error(`[Webview Console Error] ${e.message} (Line: ${e.line}, Source: ${e.sourceId})`);
    } else {
      console.log(`[Webview Console] ${e.message}`);
    }
  });

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

    activeCaptureNavigationUrl = '';
    isHistoryNavigating = false;

    if (isCapturing) {
      setAnalyzingUI(false);
      isCapturing = false;
      updateStatusText();
      showToast(`网页加载失败，请检查网址或网络连接 (${e.errorDescription || e.errorCode})`, 'error');
    }
  });

  previewWebview.addEventListener('did-stop-loading', async () => {
    activeCaptureNavigationUrl = ''; // 网页加载完毕，重置当前导航锁，允许下一次跳转/弹出新窗口无障碍清空开启新轮次
    if (isCapturing) {
      setAnalyzingUI(false);
      updateStatusText();
      saveCurrentPageSnapshot(); // 核心同步记录：页面加载完毕立即固化当前页面至记忆档案表
      
      // 如果不是历史查看模式，实时对预览区截图，作为快照保存
      if (!isHistoryMode) {
        try {
          const image = await previewWebview.capturePage();
          currentScreenshot = image.toDataURL('image/jpeg', 0.7);
          saveCurrentPageSnapshot(); // 截图就绪后补全截图快照
          
          // 自动调用 IPC 写入历史记录归档
          let url = originalAnalysisUrl || urlInput.value.trim() || previewWebview.getURL();
          if (url && url !== 'about:blank') {
            window.electronAPI.saveHistory({
              url: url,
              requests: allRequests,
              screenshot: currentScreenshot
            });
          }
        } catch (_) {}
      }
      // 保持 isCapturing = true 持续捕获，用户在右侧预览中进行操作时，左侧分析看板实时联动
    }
    
    // 页面完全载入后恢复阻断状态，确保用户在网页上进行点击等操作时，拦截依然有效
    window.electronAPI.updateBlockingState({ rules: blockRules, bypass: false });
  });

  // 拦截并接管 webview 中由于 target="_blank" 或 window.open 发起的新窗口打开事件
  // 将其在当前视口直接导航，并立即清空旧数据、100% 以新窗口的数据显示
  const handleNewWindowRedirect = (e) => {
    e.preventDefault();
    const targetUrl = e.url || (e.detail && e.detail.url);
    if (targetUrl && targetUrl !== 'about:blank') {
      if (lastNewWindowRedirectUrl === targetUrl && Date.now() - lastNewWindowRedirectTime < 350) return;
      lastNewWindowRedirectUrl = targetUrl;
      lastNewWindowRedirectTime = Date.now();
      isHistoryNavigating = false;

      urlInput.value = targetUrl;
      // 关键核心：由 beginPreviewCapture 先将当前页保存入记忆档案，再切换为新页面并清空/还原展示！
      beginPreviewCapture(targetUrl);

      // 在预览视口中导航到新窗口目标地址
      try {
        if (typeof previewWebview.loadURL === 'function') {
          previewWebview.loadURL(targetUrl);
        } else {
          previewWebview.src = targetUrl;
        }
      } catch (err) {
        console.error('Failed to load redirect URL from new-window:', err);
        try {
          previewWebview.src = targetUrl;
        } catch (_) {}
      }
    }
  };

  previewWebview.addEventListener('new-window', handleNewWindowRedirect);
  previewWebview.addEventListener('create-window', handleNewWindowRedirect);
}

/**
 * 自动补全 URL 协议头
 * 对于局域网 IP (IPv4) 或 localhost 默认使用 http:// 协议，其余域名默认使用 https:// 协议
 * @param {string} inputUrl 输入的网址
 * @returns {string} 补全协议后的网址
 */
function autoCompleteUrl(inputUrl) {
  let url = inputUrl.trim();
  if (!url) return url;

  if (!/^https?:\/\//i.test(url)) {
    // 提取主机名部分（截取第一个斜杠之前的字符，若无斜杠则为全部字符）
    const slashIdx = url.indexOf('/');
    const hostPart = slashIdx === -1 ? url : url.substring(0, slashIdx);
    
    // 提取不带端口的主机名
    const colonIdx = hostPart.indexOf(':');
    const hostName = colonIdx === -1 ? hostPart : hostPart.substring(0, colonIdx);

    const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
    const isLocal = ipRegex.test(hostName) || hostName.toLowerCase() === 'localhost';
    
    url = (isLocal ? 'http://' : 'https://') + url;
  }
  return url;
}
