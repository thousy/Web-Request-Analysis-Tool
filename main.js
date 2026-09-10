const { app, BrowserWindow, ipcMain, dialog, Menu, session } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const dns = require('dns');

// 忽略证书错误开关，必须在 app ready 之前调用，以防证书失效导致连接失败或卡死
app.commandLine.appendSwitch('ignore-certificate-errors', 'true');
app.commandLine.appendSwitch('allow-insecure-localhost', 'true');
app.commandLine.appendSwitch('disable-features', 'AsyncDns');
app.commandLine.appendSwitch('disable-http-cache'); // 禁用 Chromium 磁盘 HTTP 缓存，保障抓包纯净度

// 全局监听忽略证书验证错误，确保自签名证书或无效证书的 IP 链接能够顺利建立连接
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  event.preventDefault();
  callback(true);
});

let mainWindow;
let blockRules = [];
let bypassBlocking = false;
let activePreviewWindows = [];
let currentNavigationEpoch = 1; // 单调自增的页面导航代数序列号，消除跨进程时序竞态

const historyDir = path.join(__dirname, 'history_records');
const indexFile = path.join(historyDir, 'index.json');

// ─── 初始化历史目录 ────────────────────────────────────────────────────────────
function initHistory() {
  if (!fs.existsSync(historyDir)) {
    fs.mkdirSync(historyDir, { recursive: true });
  }
  if (!fs.existsSync(indexFile)) {
    fs.writeFileSync(indexFile, '[]', 'utf8');
  }
}

function getHistoryIndex() {
  initHistory();
  try {
    const data = fs.readFileSync(indexFile, 'utf8');
    return JSON.parse(data);
  } catch (_) {
    return [];
  }
}

function saveHistoryRecord(url, requests, screenshotBase64) {
  initHistory();
  const id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substring(2);
  const timestamp = Date.now();
  
  const total = requests.length;
  const success = requests.filter(r => r.success).length;
  const failed = total - success;
  const ipCount = new Set(requests.filter(r => r.ipAddress && r.ipAddress !== '缓存').map(r => r.ipAddress)).size;
  
  const detailData = {
    id,
    url,
    timestamp,
    stats: { total, success, failed, ipCount },
    requests,
    screenshot: screenshotBase64
  };
  
  fs.writeFileSync(path.join(historyDir, `${id}.json`), JSON.stringify(detailData, null, 2), 'utf8');
  
  const indexList = getHistoryIndex();
  indexList.unshift({
    id,
    url,
    timestamp,
    total,
    success,
    failed,
    ipCount
  });
  
  fs.writeFileSync(indexFile, JSON.stringify(indexList, null, 2), 'utf8');
}

// ─── 阻断规则匹配 ─────────────────────────────────────────────────────────────
function checkBlocked(url) {
  if (bypassBlocking) return false;
  return blockRules.includes(url);
}

// ─── 建立 Web 流量嗅探与拦截 ───────────────────────────────────────────────────
function setupWebRequestSniffer() {
  const filter = { urls: ['http://*/*', 'https://*/*'] };
  const ses = session.fromPartition('persist:preview');

  // 清除旧的拦截器
  ses.webRequest.onBeforeRequest(null);
  ses.webRequest.onBeforeSendHeaders(null);
  ses.webRequest.onResponseStarted(null);
  ses.webRequest.onErrorOccurred(null);
  ses.webRequest.onBeforeRedirect(null);

  // 忽略自定义 session 内的证书错误，确保自签名 IP 或域名能够访问
  ses.setCertificateVerifyProc((request, callback) => {
    callback(0); // 0 表示信任该证书并通过验证
  });

  // 0. 发送请求头前：注入无缓存控制头（DevTools Disable Cache 行为），彻底穿透强缓存保证全量抓取
  ses.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    const requestHeaders = details.requestHeaders || {};
    requestHeaders['Pragma'] = 'no-cache';
    requestHeaders['Cache-Control'] = 'no-cache';
    callback({ requestHeaders });
  });

  // 1. 请求发起前：实施阻断拦截与主框架导航会话代数侦测
  ses.webRequest.onBeforeRequest(filter, (details, callback) => {
    // 忽略渲染层本身的网络
    if (details.resourceType === 'mainFrame' && details.url.startsWith('file://')) {
      return callback({ cancel: false });
    }

    // 核心底层会话隔离：侦测到任何新的主框架页面文档加载请求，单调自增 Epoch 代数
    if (details.resourceType === 'mainFrame') {
      currentNavigationEpoch++;
      sendToRenderer('page-navigation-reset', {
        epoch: currentNavigationEpoch,
        sessionId: currentNavigationEpoch,
        url: details.url
      });
    }

    const isBlocked = checkBlocked(details.url);

    if (isBlocked) {
      // 实时向渲染进程推送被拦截记录
      sendToRenderer('request-captured', {
        requestId: details.id,
        url: details.url,
        method: details.method,
        status: null,
        statusText: null,
        ipAddress: null,
        port: null,
        resourceType: details.resourceType,
        success: false,
        error: '已阻断',
        isBlocked: true,
        timestamp: Date.now(),
        navigationEpoch: currentNavigationEpoch,
        navigationSessionId: currentNavigationEpoch
      });
      return callback({ cancel: true }); // 核心阻断
    }

    callback({ cancel: false });
  });

  const getFallbackIpAndPort = (urlStr) => {
    let ipAddress = null;
    let port = null;
    try {
      const parsed = new URL(urlStr);
      port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
      const hostname = parsed.hostname;
      const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$|^\[?[a-fA-F0-9:]+\]?$/;
      if (ipRegex.test(hostname)) {
        ipAddress = hostname.replace(/[\[\]]/g, '');
      }
    } catch (_) {}
    return { ipAddress, port };
  };

  // 2. 响应头开始接收：捕获成功响应、状态码及目标 IP
  ses.webRequest.onResponseStarted(filter, (details) => {
    let port = null;
    try {
      const parsed = new URL(details.url);
      port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    } catch (_) {}

    let ipAddress = details.ip || '缓存';
    if (!details.ip || details.ip === '') {
      const fallback = getFallbackIpAndPort(details.url);
      if (fallback.ipAddress) {
        ipAddress = fallback.ipAddress;
      }
    }

    const sendRecord = (ip) => {
      sendToRenderer('request-captured', {
        requestId: details.id,
        url: details.url,
        method: details.method,
        status: details.statusCode,
        statusText: details.statusCode === 200 ? 'OK' : '',
        ipAddress: ip,
        port: port,
        resourceType: details.resourceType,
        success: true,
        error: null,
        isBlocked: false,
        timestamp: Date.now(),
        navigationEpoch: currentNavigationEpoch,
        navigationSessionId: currentNavigationEpoch
      });
    };

    // 若 details.ip 确实不存在，并且当前未被标为“缓存”（或者是域名请求但解析不出 IP），用 dns.lookup 尝试解析
    if (!details.ip && ipAddress !== '缓存') {
      try {
        const parsed = new URL(details.url);
        dns.lookup(parsed.hostname, (err, address) => {
          sendRecord(err ? ipAddress : address);
        });
      } catch (_) {
        sendRecord(ipAddress);
      }
    } else {
      sendRecord(ipAddress);
    }
  });

  // 3. 网络连接出错：捕获失败请求
  ses.webRequest.onErrorOccurred(filter, (details) => {
    // 忽略我们主动触发的阻断报错
    if (details.error === 'net::ERR_BLOCKED_BY_CLIENT') {
      return;
    }

    const fallback = getFallbackIpAndPort(details.url);

    const sendRecord = (ip) => {
      sendToRenderer('request-captured', {
        requestId: details.id,
        url: details.url,
        method: details.method,
        status: null,
        statusText: null,
        ipAddress: ip,
        port: fallback.port,
        resourceType: details.resourceType,
        success: false,
        error: details.error || '连接失败',
        isBlocked: false,
        timestamp: Date.now(),
        navigationEpoch: currentNavigationEpoch,
        navigationSessionId: currentNavigationEpoch
      });
    };

    // 若不是 IP 格式导致 getFallbackIpAndPort 未能提取出 IP，通过 dns.lookup 异步查询
    if (!fallback.ipAddress) {
      try {
        const parsed = new URL(details.url);
        dns.lookup(parsed.hostname, (err, address) => {
          sendRecord(err ? null : address);
        });
      } catch (_) {
        sendRecord(null);
      }
    } else {
      sendRecord(fallback.ipAddress);
    }
  });

  // 4. 重定向发生时：捕获重定向源请求
  ses.webRequest.onBeforeRedirect(filter, (details) => {
    let port = null;
    try {
      const parsed = new URL(details.url);
      port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    } catch (_) {}

    let ipAddress = details.ip || '缓存';
    if (!details.ip || details.ip === '') {
      const fallback = getFallbackIpAndPort(details.url);
      if (fallback.ipAddress) {
        ipAddress = fallback.ipAddress;
      }
    }

    const sendRedirectRecord = (ip) => {
      // 附加重定向标记后缀，确保唯一性，避免在渲染层被重定向后的同名请求覆盖
      const uniqueId = `${details.id}_redirect_${Date.now()}`;
      
      let statusText = 'Redirect';
      if (details.statusCode === 301) statusText = 'Moved Permanently';
      else if (details.statusCode === 302) statusText = 'Found';
      else if (details.statusCode === 303) statusText = 'See Other';
      else if (details.statusCode === 307) statusText = 'Temporary Redirect';
      else if (details.statusCode === 308) statusText = 'Permanent Redirect';

      sendToRenderer('request-captured', {
        requestId: uniqueId,
        url: details.url,
        method: details.method,
        status: details.statusCode,
        statusText: statusText,
        ipAddress: ip,
        port: port,
        resourceType: details.resourceType,
        success: true,
        error: null,
        isBlocked: false,
        timestamp: Date.now(),
        navigationEpoch: currentNavigationEpoch,
        navigationSessionId: currentNavigationEpoch
      });
    };

    if (!details.ip && ipAddress !== '缓存') {
      try {
        const parsed = new URL(details.url);
        dns.lookup(parsed.hostname, (err, address) => {
          sendRedirectRecord(err ? ipAddress : address);
        });
      } catch (_) {
        sendRedirectRecord(ipAddress);
      }
    } else {
      sendRedirectRecord(ipAddress);
    }
  });
}

// ─── 创建主窗口 ──────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1420,
    height: 900,
    minWidth: 1020,
    minHeight: 680,
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true // 开启 Webview 组件标签支持
    },
    backgroundColor: '#080b14',
    show: false,
    title: 'WebRequestAnalysisTool V1.2.5 — 网页请求分析'
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}

// ─── 自定义中文菜单 ──────────────────────────────────────────────────────────
function createMenu() {
  const template = [
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' },
        { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { label: '全选', role: 'selectAll' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', role: 'reload' },
        { label: '强制重新加载', role: 'forceReload' },
        { label: '开发者工具', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: '实际大小', role: 'resetZoom' },
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
        { type: 'separator' },
        { label: '切换全屏', role: 'togglefullscreen' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { label: '最小化', role: 'minimize' },
        { label: '关闭', role: 'close' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于 Web Request Analysis Tool',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '关于 Web Request Analysis Tool',
              message: 'Web Request Analysis Tool 网页请求分析工具',
              detail: '版本 V1.2.4\n基于 Electron Native WebRequest 构建\n© YouQian Tech'
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(async () => {
  await generateIcons();
  createWindow();
  createMenu();
  setupWebRequestSniffer(); // 开启网络分析嗅探

  // 全局底层接管所有 WebContents：CDP 彻底停用 Blink 内存缓存与拦截新窗口创建
  app.on('web-contents-created', (event, contents) => {
    if (mainWindow && contents === mainWindow.webContents) return;

    // 核心黄金标准：通过 Chrome DevTools Protocol 彻底禁用 Blink 渲染引擎内存缓存与网络缓存
    // 使得每一次普通点击跳转均穿透内存缓存，发起全量真实网络请求（彻底解决跳转只有7条而刷新52条的巨大落差）
    const attachNetworkCacheDisabled = async () => {
      try {
        if (!contents.isDestroyed() && !contents.debugger.isAttached()) {
          contents.debugger.attach('1.3');
          await contents.debugger.sendCommand('Network.enable');
          await contents.debugger.sendCommand('Network.setCacheDisabled', { cacheDisabled: true });
        }
      } catch (_) {}
    };

    contents.on('did-start-loading', attachNetworkCacheDisabled);
    attachNetworkCacheDisabled();

    contents.setWindowOpenHandler(({ url: targetUrl }) => {
      if (targetUrl && targetUrl !== 'about:blank') {
        sendToRenderer('open-url-in-preview', { url: targetUrl });
      }
      return { action: 'deny' }; // 阻止创建独立空白弹窗，统一由主视口在新会话中导航以新页面为主体
    });
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
    createMenu();
    setupWebRequestSniffer();
  }
});

// ─── IPC 监听 ─────────────────────────────────────────────────────────────────

// 渲染层同步阻断规则与绕过状态
ipcMain.on('update-blocking-state', (event, { rules, bypass }) => {
  blockRules = rules || [];
  bypassBlocking = !!bypass;
});
// 渲染层异步要求清除 session 的 HTTP 缓存与本地 Storage 数据，以保证重新载入分析时拉取完整的网络请求数据链路
ipcMain.handle('clear-cache', async () => {
  try {
    const ses = session.fromPartition('persist:preview');
    await ses.clearCache();
    await ses.clearStorageData(); // 彻底清除 Service Workers 和所有 Storage 缓存
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
// 渲染层发起在新窗口放大预览网页 (共享同一个拦截 session)
ipcMain.on('open-preview-window', (event, url) => {
  const previewWin = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, 'icon.ico'),
    title: `网页放大预览: ${url}`,
    parent: mainWindow,
    modal: false,
    autoHideMenuBar: true,
    webPreferences: {
      partition: 'persist:preview', // 共享网络 Session，以保证阻断规则全部继承生效
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  previewWin.loadURL(url);

  // 监听独立大窗口内的导航跳转与新窗口，跨进程通知主界面以新窗口数据显示
  previewWin.webContents.on('will-navigate', (e, navUrl) => {
    if (navUrl && navUrl !== 'about:blank') {
      sendToRenderer('preview-window-navigated', { url: navUrl });
    }
  });

  previewWin.webContents.on('did-start-navigation', (e, navUrl, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace && navUrl && navUrl !== 'about:blank') {
      sendToRenderer('preview-window-navigated', { url: navUrl });
    }
  });

  previewWin.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (targetUrl && targetUrl !== 'about:blank') {
      previewWin.loadURL(targetUrl);
      sendToRenderer('preview-window-navigated', { url: targetUrl });
    }
    return { action: 'deny' };
  });

  // 登记至活跃窗口数组中
  activePreviewWindows.push(previewWin);

  // 当窗口关闭时，从数组中移出
  previewWin.on('closed', () => {
    activePreviewWindows = activePreviewWindows.filter(w => w !== previewWin);
  });
});

// 渲染层触发对所有放大子窗口的同步刷新（忽略缓存重载，确保与预览区效果一致）
ipcMain.on('reload-preview-windows', () => {
  activePreviewWindows.forEach(win => {
    try {
      if (win && !win.isDestroyed()) {
        win.webContents.reloadIgnoringCache();
      }
    } catch (_) {}
  });
});

// 渲染层发起历史数据存盘
ipcMain.handle('save-history', async (event, { url, requests, screenshot }) => {
  try {
    saveHistoryRecord(url, requests, screenshot);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 渲染层要求导出 JSON / CSV / 域名与IP清单 数据
ipcMain.handle('export-data', async (event, { data, format }) => {
  try {
    let ext = 'json';
    let defaultFileName = `network_requests_${Date.now()}`;
    let title = '导出网络请求数据';
    let filters = [];

    if (format === 'domain-report') {
      ext = 'txt';
      defaultFileName = `domain_ip_report_${Date.now()}`;
      title = '导出域名与 IP 分析清单报告';
      filters = [
        { name: '域名与IP清单文本报告 (*.txt)', extensions: ['txt'] },
        { name: '域名与IP清单表格 (*.csv)', extensions: ['csv'] }
      ];
    } else if (format === 'csv') {
      ext = 'csv';
      title = '导出网络请求数据 (CSV)';
      filters = [{ name: 'CSV Files (*.csv)', extensions: ['csv'] }];
    } else {
      ext = 'json';
      title = '导出网络请求数据 (JSON)';
      filters = [{ name: 'JSON Files (*.json)', extensions: ['json'] }];
    }

    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title,
      defaultPath: path.join(app.getPath('downloads'), `${defaultFileName}.${ext}`),
      filters
    });

    if (canceled || !filePath) {
      return { success: false, error: '用户取消了导出' };
    }

    const chosenExt = path.extname(filePath).toLowerCase().replace('.', '') || ext;
    let content = '';

    if (format === 'domain-report') {
      // 聚合成功域名、IP以及失败链接数据
      const successDomains = new Map();
      const failedLinks = [];

      (data || []).forEach((r) => {
        let hostname = '';
        try {
          hostname = new URL(r.url).hostname;
        } catch (_) {
          hostname = r.url || '未知域名';
        }

        const isSuccess = r.success && !r.isBlocked;
        if (isSuccess) {
          if (!successDomains.has(hostname)) {
            successDomains.set(hostname, {
              domain: hostname,
              ips: new Set(),
              ports: new Set(),
              links: [],
              count: 0
            });
          }
          const item = successDomains.get(hostname);
          item.count++;
          if (r.ipAddress && r.ipAddress !== '缓存' && r.ipAddress !== '—') {
            item.ips.add(r.ipAddress);
          }
          if (r.port) {
            item.ports.add(r.port);
          }
          if (r.url && !item.links.includes(r.url)) {
            item.links.push(r.url);
          }
        } else {
          failedLinks.push({
            url: r.url || '',
            domain: hostname,
            error: r.isBlocked ? '🚫 已阻断 (规则拦截)' : (r.error || (r.status ? `HTTP ${r.status} ${r.statusText || ''}` : '连接失败')),
            status: r.status,
            isBlocked: r.isBlocked,
            time: r.timestamp ? new Date(r.timestamp).toLocaleString() : new Date().toLocaleString()
          });
        }
      });

      if (chosenExt === 'csv') {
        // CSV 格式导出
        const headers = ['分类', '域名/主机', '关联 IP 地址', '端口', '请求状态', '完整请求 URL', '错误原因/状态码', '记录时间'];
        const csvRows = [];

        successDomains.forEach((info) => {
          const ipStr = Array.from(info.ips).join('; ') || '缓存/未捕获';
          const portStr = Array.from(info.ports).join('; ') || '—';
          info.links.forEach((link) => {
            csvRows.push([
              '请求成功',
              info.domain,
              ipStr,
              portStr,
              '成功',
              link,
              '—',
              new Date().toLocaleString()
            ]);
          });
        });

        failedLinks.forEach((item) => {
          csvRows.push([
            '请求失败/阻断',
            item.domain,
            '—',
            '—',
            item.isBlocked ? '已阻断' : '失败',
            item.url,
            item.error,
            item.time
          ]);
        });

        const formattedRows = csvRows.map(row =>
          row.map(val => {
            const str = String(val);
            return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
          }).join(',')
        );

        content = '\ufeff' + [headers.join(','), ...formattedRows].join('\r\n');
      } else {
        // 结构化 TXT 格式报告导出
        const lines = [];
        lines.push('================================================================================');
        lines.push('  Web Request Analysis Tool — 域名与 IP 分析清单报告');
        lines.push('================================================================================');
        lines.push(`导出时间: ${new Date().toLocaleString()}`);
        lines.push(`请求总数: ${(data || []).length} 项`);
        const totalSuccessCount = Array.from(successDomains.values()).reduce((acc, cur) => acc + cur.count, 0);
        lines.push(`  * 成功请求: ${totalSuccessCount} 次 (涉及 ${successDomains.size} 个独立域名)`);
        lines.push(`  * 失败/阻断: ${failedLinks.length} 次 (涉及 ${new Set(failedLinks.map(f => f.domain)).size} 个独立域名)`);
        lines.push('');

        lines.push('================================================================================');
        lines.push('【一、请求成功的域名与关联 IP 清单】');
        lines.push('================================================================================');

        if (successDomains.size === 0) {
          lines.push('(暂无请求成功的域名记录)');
        } else {
          let idx = 1;
          successDomains.forEach((info) => {
            const ipStr = Array.from(info.ips).join(', ') || '缓存 / 未捕获物理IP';
            const portStr = Array.from(info.ports).join(', ') || '—';
            lines.push(`[${idx++}] 域名: ${info.domain}`);
            lines.push(`    * 关联 IP 地址: ${ipStr}`);
            lines.push(`    * 关联通信端口: ${portStr}`);
            lines.push(`    * 请求成功次数: ${info.count} 次`);
            lines.push(`    * 成功链接清单 (共 ${info.links.length} 条独立链接):`);
            info.links.forEach((link, lIdx) => {
              lines.push(`      ${lIdx + 1}. ${link}`);
            });
            lines.push('');
          });
        }

        lines.push('================================================================================');
        lines.push('【二、请求失败 / 被阻断的链接清单】');
        lines.push('================================================================================');

        if (failedLinks.length === 0) {
          lines.push('(暂无请求失败或被阻断的链接，全量通信正常)');
        } else {
          failedLinks.forEach((item, fIdx) => {
            lines.push(`[${fIdx + 1}] 链接: ${item.url}`);
            lines.push(`    * 所属域名: ${item.domain}`);
            lines.push(`    * 状态/原因: ${item.error}`);
            lines.push(`    * 发生时间: ${item.time}`);
            lines.push('');
          });
        }

        lines.push('================================================================================');
        lines.push('  报告结束 · Generated by Web Request Analysis Tool');
        lines.push('================================================================================');

        content = lines.join('\r\n');
      }
    } else if (format === 'json') {
      content = JSON.stringify(data, null, 2);
    } else {
      // CSV 格式化输出
      const headers = ['#', '状态', '请求 URL', '方法', 'IP 地址', '端口', '资源类型', 'HTTP 状态', '错误信息', '时间'];
      const rows = data.map((r, idx) => {
        const timeStr = new Date(r.timestamp).toLocaleString();
        const statusStr = r.isBlocked ? '已阻断' : (r.success ? '成功' : '失败');
        const codeStr = r.isBlocked ? '已阻断' : (r.status ? `${r.status} ${r.statusText || ''}` : '—');
        
        return [
          r.id || idx + 1,
          statusStr,
          r.url || '',
          r.method || '',
          r.ipAddress || '',
          r.port || '',
          r.resourceType || '',
          codeStr,
          r.error || '',
          timeStr
        ].map(val => {
          const str = String(val);
          if (/[",\r\n]/.test(str)) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        }).join(',');
      });
      // CSV 写入 UTF-8 BOM 头部防乱码
      content = '\ufeff' + [headers.join(','), ...rows].join('\r\n');
    }

    fs.writeFileSync(filePath, content, 'utf8');
    return { success: true, filePath, format: chosenExt };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-history-list', async () => {
  return getHistoryIndex();
});

ipcMain.handle('load-history-detail', async (event, id) => {
  try {
    const detailPath = path.join(historyDir, `${id}.json`);
    if (fs.existsSync(detailPath)) {
      const content = fs.readFileSync(detailPath, 'utf8');
      return { success: true, data: JSON.parse(content) };
    }
    return { success: false, error: '未找到该历史详情文件' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('delete-history', async (event, id) => {
  try {
    const detailPath = path.join(historyDir, `${id}.json`);
    if (fs.existsSync(detailPath)) {
      fs.unlinkSync(detailPath);
    }
    
    const indexList = getHistoryIndex();
    const updated = indexList.filter(item => item.id !== id);
    fs.writeFileSync(indexFile, JSON.stringify(updated, null, 2), 'utf8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 渲染层要求清空所有历史分析记录
ipcMain.handle('clear-all-history', async () => {
  try {
    const files = fs.readdirSync(historyDir);
    files.forEach(file => {
      if (file.endsWith('.json') && file !== 'index.json') {
        fs.unlinkSync(path.join(historyDir, file));
      }
    });
    fs.writeFileSync(indexFile, '[]', 'utf8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── 工具函数 ─────────────────────────────────────────────────────────────────
function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

// 自举转换雷达 SVG 图标为 icon.png 和 icon.ico
function generateIcons() {
  return new Promise((resolve) => {
    const icoPath = path.join(__dirname, 'icon.ico');
    const pngPath = path.join(__dirname, 'icon.png');
    
    if (fs.existsSync(icoPath) && fs.existsSync(pngPath)) {
      return resolve();
    }

    const tempWin = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false
      }
    });

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <body>
        <canvas id="canvas" width="256" height="256"></canvas>
        <script>
          const svgStr = \`<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="14" stroke="url(#g1)" stroke-width="2"/><circle cx="16" cy="16" r="6" fill="url(#g1)" opacity="0.8"/><line x1="2" y1="16" x2="30" y2="16" stroke="url(#g1)" stroke-width="1.5" stroke-dasharray="2 2"/><line x1="16" y1="2" x2="16" y2="30" stroke="url(#g1)" stroke-width="1.5" stroke-dasharray="2 2"/><defs><linearGradient id="g1" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse"><stop stop-color="#818cf8"/><stop offset="1" stop-color="#a78bfa"/></linearGradient></defs></svg>\`;
          const canvas = document.getElementById('canvas');
          const ctx = canvas.getContext('2d');
          const img = new Image();
          img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);
          img.onload = () => {
            ctx.drawImage(img, 0, 0, 256, 256);
            const dataUrl = canvas.toDataURL('image/png');
            try {
              const { ipcRenderer } = require('electron');
              ipcRenderer.send('generate-icon-response', dataUrl);
            } catch(e) {
              console.error(e);
            }
          };
        </script>
      </body>
      </html>
    `;

    ipcMain.once('generate-icon-response', (event, dataUrl) => {
      try {
        const base64Data = dataUrl.replace('data:image/png;base64,', '');
        const pngBuffer = Buffer.from(base64Data, 'base64');
        
        fs.writeFileSync(pngPath, pngBuffer);
        
        const header = Buffer.alloc(6);
        header.writeUInt16LE(0, 0);
        header.writeUInt16LE(1, 2);
        header.writeUInt16LE(1, 4);

        const dir = Buffer.alloc(16);
        dir.writeUInt8(0, 0);
        dir.writeUInt8(0, 1);
        dir.writeUInt8(0, 2);
        dir.writeUInt8(0, 3);
        dir.writeUInt16LE(1, 4);
        dir.writeUInt16LE(32, 6);
        dir.writeUInt32LE(pngBuffer.length, 8);
        dir.writeUInt32LE(22, 12);

        const icoBuffer = Buffer.concat([header, dir, pngBuffer]);
        fs.writeFileSync(icoPath, icoBuffer);
      } catch (err) {
        console.error('生成图标失败：', err);
      } finally {
        tempWin.destroy();
        resolve();
      }
    });

    tempWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent));
  });
}
