const { app, BrowserWindow, ipcMain, dialog, Menu, session } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const dns = require('dns');

// 忽略证书错误开关，必须在 app ready 之前调用，以防证书失效导致连接失败或卡死
app.commandLine.appendSwitch('ignore-certificate-errors', 'true');
app.commandLine.appendSwitch('allow-insecure-localhost', 'true');
app.commandLine.appendSwitch('disable-features', 'AsyncDns');

// 全局监听忽略证书验证错误，确保自签名证书或无效证书的 IP 链接能够顺利建立连接
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  event.preventDefault();
  callback(true);
});

let mainWindow;
let blockRules = [];
let bypassBlocking = false;
let activePreviewWindows = [];

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
  ses.webRequest.onResponseStarted(null);
  ses.webRequest.onErrorOccurred(null);

  // 忽略自定义 session 内的证书错误，确保自签名 IP 或域名能够访问
  ses.setCertificateVerifyProc((request, callback) => {
    callback(0); // 0 表示信任该证书并通过验证
  });

  // 1. 请求发起前：实施阻断拦截
  ses.webRequest.onBeforeRequest(filter, (details, callback) => {
    // 忽略渲染层本身的网络
    if (details.resourceType === 'mainFrame' && details.url.startsWith('file://')) {
      return callback({ cancel: false });
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
        timestamp: Date.now()
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
        timestamp: Date.now()
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
        timestamp: Date.now()
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
    title: 'Web Request Analysis Tool — 网页请求分析'
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
              detail: '版本 V1.2\n基于 Electron Native WebRequest 构建\n© YouQian Tech'
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

// 渲染层要求导出 JSON / CSV 数据
ipcMain.handle('export-data', async (event, { data, format }) => {
  try {
    const ext = format === 'csv' ? 'csv' : 'json';
    const filters = [{ name: format.toUpperCase() + ' Files', extensions: [ext] }];
    
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: `导出网络请求数据 (${format.toUpperCase()})`,
      defaultPath: path.join(app.getPath('downloads'), `network_requests_${Date.now()}.${ext}`),
      filters
    });

    if (canceled || !filePath) {
      return { success: false, error: '用户取消了导出' };
    }

    let content = '';
    if (format === 'json') {
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
    return { success: true };
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
