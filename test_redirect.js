const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;

// 精美的 CSS 样式系统 (共用)
const commonStyle = `
  :root {
    --bg-dark: #080b14;
    --card-bg: rgba(255, 255, 255, 0.03);
    --card-border: rgba(255, 255, 255, 0.08);
    --text-primary: #f8fafc;
    --text-secondary: #94a3b8;
    --accent: #818cf8;
    --accent-glow: rgba(129, 140, 248, 0.15);
    --success: #34d399;
    --success-glow: rgba(52, 211, 153, 0.15);
    --font-sans: 'Outfit', 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }
  body {
    background-color: var(--bg-dark);
    color: var(--text-primary);
    font-family: var(--font-sans);
    min-height: 100vh;
    display: flex;
    justify-content: center;
    align-items: center;
    overflow-x: hidden;
    background-image: 
      radial-gradient(circle at 10% 20%, rgba(129, 140, 248, 0.05) 0%, transparent 40%),
      radial-gradient(circle at 90% 80%, rgba(167, 139, 250, 0.05) 0%, transparent 40%);
  }
  .container {
    width: 100%;
    max-width: 600px;
    padding: 24px;
  }
  .card {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 20px;
    padding: 40px;
    backdrop-filter: blur(16px);
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
    text-align: center;
    position: relative;
    overflow: hidden;
  }
  .card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 4px;
    background: linear-gradient(90deg, #818cf8, #a78bfa);
  }
  h1 {
    font-size: 28px;
    font-weight: 700;
    margin-bottom: 12px;
    letter-spacing: -0.02em;
    background: linear-gradient(135deg, #f8fafc 0%, #cbd5e1 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  p {
    font-size: 15px;
    color: var(--text-secondary);
    line-height: 1.6;
    margin-bottom: 24px;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #818cf8 0%, #6366f1 100%);
    color: #ffffff;
    font-size: 14px;
    font-weight: 600;
    padding: 12px 28px;
    border-radius: 10px;
    text-decoration: none;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 4px 15px var(--accent-glow);
    cursor: pointer;
    border: none;
  }
  .btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 25px rgba(129, 140, 248, 0.35);
  }
  .btn:active {
    transform: translateY(0);
  }
`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost:3000'}`);
  const pathname = url.pathname;

  // ─── 1. 引导控制首页 ───────────────────────────────────────────────────────
  if (pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html lang="zh-CN">
      <head>
        <meta charset="UTF-8">
        <title>Web Request Analysis Tool 跳转测试控制台</title>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&display=swap" rel="stylesheet">
        <style>
          ${commonStyle}
          body {
            align-items: flex-start;
            padding: 60px 0;
          }
          .container {
            max-width: 720px;
          }
          .card {
            text-align: left;
            padding: 36px;
          }
          .card::before {
            background: linear-gradient(90deg, #818cf8, #34d399);
          }
          .header-badge {
            display: inline-block;
            background: rgba(129, 140, 248, 0.1);
            color: var(--accent);
            font-size: 12px;
            font-weight: 600;
            padding: 4px 12px;
            border-radius: 20px;
            margin-bottom: 16px;
            border: 1px solid rgba(129, 140, 248, 0.15);
          }
          .test-item {
            background: rgba(255, 255, 255, 0.015);
            border: 1px solid var(--card-border);
            border-radius: 12px;
            padding: 20px;
            margin-top: 18px;
            transition: all 0.25s ease;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .test-item:hover {
            border-color: rgba(129, 140, 248, 0.3);
            background: rgba(129, 140, 248, 0.01);
          }
          .test-info {
            flex: 1;
            padding-right: 16px;
          }
          .test-title {
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 4px;
            color: var(--text-primary);
          }
          .test-desc {
            font-size: 13px;
            color: var(--text-secondary);
            margin-bottom: 8px;
          }
          .url-box {
            display: flex;
            align-items: center;
            background: rgba(0, 0, 0, 0.2);
            border: 1px solid var(--card-border);
            border-radius: 6px;
            padding: 6px 12px;
            font-family: monospace;
            font-size: 12px;
            color: var(--accent);
            word-break: break-all;
          }
          .btn-copy {
            background: transparent;
            border: none;
            color: var(--text-secondary);
            cursor: pointer;
            margin-left: 8px;
            font-size: 11px;
            text-decoration: underline;
          }
          .btn-copy:hover {
            color: var(--text-primary);
          }
          .action-area {
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          .btn-test {
            padding: 8px 16px;
            font-size: 12px;
            border-radius: 6px;
          }
          .btn-test.outline {
            background: transparent;
            border: 1px solid var(--card-border);
            color: var(--text-secondary);
            box-shadow: none;
          }
          .btn-test.outline:hover {
            border-color: var(--accent);
            color: var(--text-primary);
            box-shadow: 0 4px 12px var(--accent-glow);
          }
          .toast-container {
            position: fixed;
            bottom: 24px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(52, 211, 153, 0.95);
            color: #080b14;
            padding: 10px 20px;
            border-radius: 30px;
            font-size: 13px;
            font-weight: 600;
            opacity: 0;
            transition: opacity 0.3s ease;
            pointer-events: none;
            z-index: 1000;
            box-shadow: 0 8px 20px rgba(52, 211, 153, 0.3);
          }
          .toast-container.show {
            opacity: 1;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="card">
            <span class="header-badge">跳转测试服务器已就绪</span>
                      <!-- 测试项 1 -->
            <div class="test-item">
              <div class="test-info">
                <div class="test-title">① HTTP 302 临时重定向</div>
                <div class="test-desc">服务器端直接返回 302 状态码，并在 Header 中设置 Location 指向目标页面 B。最为经典的网络级跳转。</div>
                <div class="url-box">
                  <span id="url-302">http://localhost:3000/a1</span>
                  <button class="btn-copy" onclick="copyUrl('url-302')">复制</button>
                </div>
              </div>
              <div class="action-area">
                <a href="/a1" target="_blank" class="btn btn-test outline">浏览器打开</a>
              </div>
            </div>

            <!-- 测试项 2 -->
            <div class="test-item">
              <div class="test-info">
                <div class="test-title">② HTML Meta 刷新跳转</div>
                <div class="test-desc">服务器返回包含 &lt;meta http-equiv="refresh" ...&gt; 标签的网页 A2，浏览器接收解析后自动刷新跳转至目标页面 B。</div>
                <div class="url-box">
                  <span id="url-meta">http://localhost:3000/a2</span>
                  <button class="btn-copy" onclick="copyUrl('url-meta')">复制</button>
                </div>
              </div>
              <div class="action-area">
                <a href="/a2" target="_blank" class="btn btn-test outline">浏览器打开</a>
              </div>
            </div>

            <!-- 测试项 3 -->
            <div class="test-item">
              <div class="test-info">
                <div class="test-title">③ JavaScript window.location 跳转</div>
                <div class="test-desc">服务器返回包含 JavaScript 重定向脚本的网页 A3，脚本加载执行后触发 location.href 重置导航至页面 B。</div>
                <div class="url-box">
                  <span id="url-js">http://localhost:3000/a3</span>
                  <button class="btn-copy" onclick="copyUrl('url-js')">复制</button>
                </div>
              </div>
              <div class="action-area">
                <a href="/a3" target="_blank" class="btn btn-test outline">浏览器打开</a>
              </div>
            </div>

            <!-- 跨域测试项 4 -->
            <div class="test-item">
              <div class="test-info">
                <div class="test-title">④ 跨域 HTTP 302 重定向 (127.0.0.1 -> 127.0.0.2)</div>
                <div class="test-desc">测试从 127.0.0.1 重定向到 127.0.0.2。这属于完全跨域的物理 IP 跳转。</div>
                <div class="url-box">
                  <span id="url-cross-302">http://127.0.0.1:3000/cross-302</span>
                  <button class="btn-copy" onclick="copyUrl('url-cross-302')">复制</button>
                </div>
              </div>
              <div class="action-area">
                <a href="http://127.0.0.1:3000/cross-302" target="_blank" class="btn btn-test outline">浏览器打开</a>
              </div>
            </div>

            <!-- 跨域测试项 5 -->
            <div class="test-item">
              <div class="test-info">
                <div class="test-title">⑤ 跨域 HTML Meta 刷新跳转 (127.0.0.1 -> 127.0.0.2)</div>
                <div class="test-desc">使用 &lt;meta http-equiv="refresh" content="0;url=http://127.0.0.2:3000/b"&gt; 进行跨域跳转。</div>
                <div class="url-box">
                  <span id="url-cross-meta">http://127.0.0.1:3000/cross-meta</span>
                  <button class="btn-copy" onclick="copyUrl('url-cross-meta')">复制</button>
                </div>
              </div>
              <div class="action-area">
                <a href="http://127.0.0.1:3000/cross-meta" target="_blank" class="btn btn-test outline">浏览器打开</a>
              </div>
            </div>

            <!-- 跨域测试项 6 -->
            <div class="test-item">
              <div class="test-info">
                <div class="test-title">⑥ 跨域 JS location.href 跳转 (127.0.0.1 -> 127.0.0.2)</div>
                <div class="test-desc">使用 JS 代码修改 window.location.href 实现跨 IP 跳转。</div>
                <div class="url-box">
                  <span id="url-cross-js">http://127.0.0.1:3000/cross-js</span>
                  <button class="btn-copy" onclick="copyUrl('url-cross-js')">复制</button>
                </div>
              </div>
              <div class="action-area">
                <a href="http://127.0.0.1:3000/cross-js" target="_blank" class="btn btn-test outline">浏览器打开</a>
              </div>
            </div>

            <!-- 跨域测试项 7 -->
            <div class="test-item">
              <div class="test-info">
                <div class="test-title">⑦ 跨域 target="_blank" 点击跳转 (127.0.0.1 -> 127.0.0.2)</div>
                <div class="test-desc">使用 target="_blank" 属性的新窗口点击链接。测试 Webview 新窗口/弹出窗口拦截与重定向。</div>
                <div class="url-box">
                  <span id="url-cross-blank">http://127.0.0.1:3000/cross-blank</span>
                  <button class="btn-copy" onclick="copyUrl('url-cross-blank')">复制</button>
                </div>
              </div>
              <div class="action-area">
                <a href="http://127.0.0.1:3000/cross-blank" target="_blank" class="btn btn-test outline">浏览器打开</a>
              </div>
            </div>

          </div>
        </div>

        <div id="toast" class="toast-container">链接已成功复制到剪贴板！</div>

        <script>
          function copyUrl(elementId) {
            const urlText = document.getElementById(elementId).innerText;
            navigator.clipboard.writeText(urlText).then(() => {
              const toast = document.getElementById('toast');
              toast.classList.add('show');
              setTimeout(() => {
                toast.classList.remove('show');
              }, 2000);
            });
          }
        </script>
      </body>
      </html>
    `);
  }

  // ─── 2. HTTP 302 重定向 ─────────────────────────────────────────────────────
  else if (pathname === '/a1') {
    res.writeHead(302, { 'Location': '/b' });
    res.end();
  }

  // ─── 2.1 跨域 HTTP 302 重定向 ─────────────────────────────────────────────────────
  else if (pathname === '/cross-302') {
    res.writeHead(302, { 'Location': 'http://127.0.0.2:3000/b' });
    res.end();
  }

  // ─── 3. HTML Meta 刷新跳转 ──────────────────────────────────────────────────
  else if (pathname === '/a2') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="refresh" content="0;url=/b">
        <title>页面 A (HTML Meta 刷新)...</title>
        <style>
          \${commonStyle}
          .spinner {
            width: 50px;
            height: 50px;
            border: 3px solid rgba(129, 140, 248, 0.1);
            border-radius: 50%;
            border-top-color: var(--accent);
            animation: spin 1s ease-in-out infinite;
            margin: 20px auto 0 auto;
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="card">
            <h1>正在重定向 (Meta)</h1>
            <p>正在重定向到目标页面 B (HTML Meta 刷新方式)...</p>
            <div class="spinner"></div>
          </div>
        </div>
      </body>
      </html>
    `);
  }

  // ─── 3.1 跨域 HTML Meta 刷新跳转 ──────────────────────────────────────────────────
  else if (pathname === '/cross-meta') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="refresh" content="0;url=http://127.0.0.2:3000/b">
        <title>页面 A (HTML Meta 跨域刷新)...</title>
        <style>
          \${commonStyle}
          .spinner {
            width: 50px;
            height: 50px;
            border: 3px solid rgba(129, 140, 248, 0.1);
            border-radius: 50%;
            border-top-color: var(--accent);
            animation: spin 1s ease-in-out infinite;
            margin: 20px auto 0 auto;
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="card">
            <h1>正在跨域重定向 (Meta)</h1>
            <p>正在重定向到 127.0.0.2 目标页面 B (HTML Meta 方式)...</p>
            <div class="spinner"></div>
          </div>
        </div>
      </body>
      </html>
    `);
  }

  // ─── 4. JavaScript window.location 跳转 ──────────────────────────────────────────
  else if (pathname === '/a3') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>页面 A (JS 跳转)...</title>
        <style>
          \${commonStyle}
          .spinner {
            width: 50px;
            height: 50px;
            border: 3px solid rgba(129, 140, 248, 0.1);
            border-radius: 50%;
            border-top-color: var(--accent);
            animation: spin 1s ease-in-out infinite;
            margin: 20px auto 0 auto;
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="card">
            <h1>正在重定向 (JS)</h1>
            <p>正在重定向到目标页面 B (JavaScript window.location 方式)...</p>
            <div class="spinner"></div>
          </div>
        </div>
        <script>
          // 稍微延迟 100ms 触发，让嗅探器有充分的初始化缓冲测试空间
          setTimeout(() => {
            window.location.href = '/b';
          }, 100);
        </script>
      </body>
      </html>
    `);
  }

  // ─── 4.1 跨域 JavaScript window.location 跳转 ──────────────────────────────────────────
  else if (pathname === '/cross-js') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>页面 A (跨域 JS 跳转)...</title>
        <style>
          \${commonStyle}
          .spinner {
            width: 50px;
            height: 50px;
            border: 3px solid rgba(129, 140, 248, 0.1);
            border-radius: 50%;
            border-top-color: var(--accent);
            animation: spin 1s ease-in-out infinite;
            margin: 20px auto 0 auto;
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="card">
            <h1>正在跨域重定向 (JS)</h1>
            <p>正在重定向到 127.0.0.2 目标页面 B (JavaScript window.location 方式)...</p>
            <div class="spinner"></div>
          </div>
        </div>
        <script>
          setTimeout(() => {
            window.location.href = 'http://127.0.0.2:3000/b';
          }, 100);
        </script>
      </body>
      </html>
    `);
  }

  // ─── 4.2 跨域 target="_blank" 页面 ──────────────────────────────────────────
  else if (pathname === '/cross-blank') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>页面 A (target="_blank" 跨域)...</title>
        <style>
          \${commonStyle}
        </style>
      </head>
      <body>
        <div class="container">
          <div class="card">
            <h1>跨域 target="_blank" 测试</h1>
            <p>点击下方按钮，将尝试通过 <code>target="_blank"</code> 打开 127.0.0.2 上的页面 B。</p>
            <a href="http://127.0.0.2:3000/b" target="_blank" class="btn">点击跳转</a>
          </div>
        </div>
      </body>
      </html>
    `);
  }
  
  // ─── 5. 目标页面 B ─────────────────────────────────────────────────────────
  else if (pathname === '/b') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>目标页面 B</title>
        <!-- 引入额外的外部样式文件，以测试静态资源抓取 -->
        <link rel="stylesheet" href="/b_style.css">
      </head>
      <body>
        <div class="container">
          <div class="card">
            <div class="logo-container">
              <!-- 引入额外的外部 SVG 图像，测试媒体资源抓取 -->
              <img src="/b_logo.svg" alt="雷达扫描" width="120" height="120">
            </div>
            <h1>🎉 恭喜！跳转捕获成功！</h1>
            <p>这表明网页跳转网络请求已被工具完美嗅探捕获。本页面已经自动加载了外部样式表 <code>/b_style.css</code>，和 SVG 图标 <code>/b_logo.svg</code>。</p>
            
            <div class="api-card">
              <div class="api-header">异步 API Fetch 嗅探测试</div>
              <div class="api-status">正在异步拉取本地 API 接口数据...</div>
              <pre class="api-result" id="apiResult">等待加载...</pre>
            </div>
            
            <div style="margin-top:24px;">
              <a href="/" class="btn">返回控制台</a>
            </div>
          </div>
        </div>
        <!-- 引入额外的外部 JS 脚本，执行异步 Fetch 网络包，以测试 API 抓取 -->
        <script src="/b_script.js"></script>
      </body>
      </html>
    `);
  }

  // ─── 6. 目标页面 B 伴随资源：b_style.css ──────────────────────────────────────────
  else if (pathname === '/b_style.css') {
    res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
    res.end(`
      ${commonStyle}
      .card::before {
        background: linear-gradient(90deg, #34d399, #10b981);
      }
      .logo-container {
        display: flex;
        justify-content: center;
        margin-bottom: 20px;
      }
      .api-card {
        background: rgba(0, 0, 0, 0.25);
        border: 1px solid var(--card-border);
        border-radius: 12px;
        padding: 16px;
        margin-top: 24px;
        text-align: left;
      }
      .api-header {
        font-size: 13px;
        font-weight: 600;
        color: var(--accent);
        margin-bottom: 8px;
        display: flex;
        align-items: center;
      }
      .api-header::before {
        content: '';
        display: inline-block;
        width: 6px;
        height: 6px;
        background: var(--accent);
        border-radius: 50%;
        margin-right: 8px;
      }
      .api-status {
        font-size: 12px;
        color: var(--text-secondary);
        margin-bottom: 12px;
      }
      .api-result {
        background: rgba(255, 255, 255, 0.015);
        border: 1px solid rgba(255, 255, 255, 0.05);
        border-radius: 6px;
        padding: 12px;
        font-family: monospace;
        font-size: 11px;
        color: var(--success);
        overflow-x: auto;
        white-space: pre-wrap;
        word-break: break-all;
      }
    `);
  }

  // ─── 7. 目标页面 B 伴随资源：b_logo.svg ───────────────────────────────────────────
  else if (pathname === '/b_logo.svg') {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8' });
    res.end(`
      <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="16" cy="16" r="14" stroke="url(#g1)" stroke-width="2">
          <animate attributeName="stroke-dasharray" values="1,200;89,200;89,200" keyTimes="0;0.5;1" dur="2s" repeatCount="indefinite"/>
        </circle>
        <circle cx="16" cy="16" r="6" fill="url(#g1)" opacity="0.8">
          <animate attributeName="opacity" values="0.4;0.9;0.4" dur="2s" repeatCount="indefinite"/>
        </circle>
        <line x1="2" y1="16" x2="30" y2="16" stroke="url(#g1)" stroke-width="1.5" stroke-dasharray="2 2"/>
        <line x1="16" y1="2" x2="16" y2="30" stroke="url(#g1)" stroke-width="1.5" stroke-dasharray="2 2"/>
        <defs>
          <linearGradient id="g1" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
            <stop stop-color="#34d399"/>
            <stop offset="1" stop-color="#10b981"/>
          </linearGradient>
        </defs>
      </svg>
    `);
  }

  // ─── 8. 目标页面 B 伴随资源：b_script.js ──────────────────────────────────────────
  else if (pathname === '/b_script.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    res.end(`
      // 模拟网页延时发出 API 异步网络包 Fetch
      setTimeout(() => {
        const statusEl = document.querySelector('.api-status');
        const resultEl = document.getElementById('apiResult');
        
        fetch('/api/data')
          .then(res => res.json())
          .then(data => {
            statusEl.textContent = '数据拉取成功！';
            statusEl.style.color = '#34d399';
            resultEl.textContent = JSON.stringify(data, null, 2);
          })
          .catch(err => {
            statusEl.textContent = '接口数据抓取失败';
            statusEl.style.color = '#f43f5e';
            resultEl.textContent = 'Error: ' + err.message;
          });
      }, 500);
    `);
  }

  // ─── 9. API 接口数据数据包 ────────────────────────────────────────────────────
  else if (pathname === '/api/data') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      status: "success",
      message: "恭喜！这是通过 Fetch 异步拉取获取的 JSON API 响应包，您已成功抓取并解析到我！",
      timestamp: Date.now(),
      server: "Node.js Native Redirect Server",
      developer: "MoMo's Resource Programmer"
    }));
  }

  // ─── 404 兜底 ──────────────────────────────────────────────────────────────
  else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`\n=========================================`);
  console.log(`[+] 跳转测试服务器成功启动！`);
  console.log(`[+] 控制台主页: http://localhost:${PORT}`);
  console.log(`[+] 按下 Ctrl+C 即可关闭测试服务器`);
  console.log(`=========================================\n`);
});
