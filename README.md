# Web Request Analysis Tool — 网页请求分析工具 (V1.1.0)

[![GitHub](https://img.shields.io/badge/github-thousy/Web--Request--Analysis--Tool-6366f1?style=flat-flat&logo=github)](https://github.com/thousy/Web-Request-Analysis-Tool)
[![Electron](https://img.shields.io/badge/electron-31.7.7-blue.svg?style=flat-flat&logo=electron)](https://www.electronjs.org/)
[![License](https://img.shields.io/badge/license-MIT-success.svg?style=flat-flat)](LICENSE)

**Web Request Analysis Tool (网页请求分析工具)** 是一款基于 **Electron** + **Chrome Native WebRequest 嗅探架构** 开发的高颜值、高性能网页网络请求捕获、拦截与分析工具。

本工具不仅支持高精度的网络请求实时监控，还融入了专属雷达图标自举转换生成、共享 Session 放大子窗口同步无缓存重载、CSV 导出防乱码 UTF-8 BOM 编码、交互式网络请求阻断过滤以及静态网页快照切换等一整套专业级的网络请求调试与分析解决方案。

---

## 🚀 核心特性

### 1. 高精度网络请求实时捕获
*   **全生命周期监控**：在 Native 层面深度监听网络请求的 `onBeforeRequest`、`onResponseStarted` 以及 `onErrorOccurred` 等生命周期节点。
*   **多维数据采集**：实时采集并直观呈现请求的序号、拦截状态、请求 URL、HTTP 方法、目标服务器 IP 地址、目标端口、资源类型（Fetch/XHR/Stylesheet/Script/Image 等）、HTTP 状态码、错误信息以及高精度时间戳。

### 2. 交互式网络请求阻断拦截 (Request Blocker)
*   **行内快捷键拦截**：点击列表右侧的“阻断”按钮，即可实时将该子请求（例如网页内的 LOGO 图片、分析脚本或特定 API 链接）拦截丢弃。
*   **动态策略继承**：主界面阻断的规则，会在大预览子窗口中同步即时继承生效，无需重新加载即可应用最新过滤策略。
*   **一键恢复允许**：对于已阻断的请求行，可随时点击“允许”按钮将其从过滤黑名单中移除，瞬时恢复资源加载。

### 3. 同步放大预览子窗口 (Shared Session Viewport)
*   **多开放大预览**：支持点击右上角放大按钮，在独立的大窗口中同步放大预览网页，方便进行大屏调试。
*   **网络会话共享**：大窗口与内嵌预览视口共享同一个网络 `partition: persist:preview`，完美继承所有的阻断规则与缓存控制。
*   **忽略缓存同步重载**：在主窗口点击刷新时，所有打开的子窗口会跟随主预览区一同进行无缓存强制重载（`reloadIgnoringCache`），保证大窗口与预览窗口的阻断展示结果高度一致。

### 4. 数据多维分析与一键清空
*   **实时联动过滤**：顶部的统计卡片（总请求数、成功、失败、唯一 IP 数）支持点击联动。点击对应卡片，网络请求列表将自动过滤呈现对应维度的行。
*   **唯一 IP 聚合详情**：点击 “唯一 IP” 统计卡片，将弹出毛玻璃设计的聚合详情弹窗，分类呈现请求的所有服务器目标 IP、请求计数以及请求绑定的解析域名。
*   **历史抽屉一键清空**：历史记录抽屉头部新增了“清空”按钮。一键清空即可安全擦除磁盘上的全量快照 JSON，并将主索引 `index.json` 安全归零为 `[]`，同时按钮自动动态隐藏。

### 5. 无损数据导出（支持防乱码 CSV）
*   **JSON 导出**：支持一键导出包含全部字段的格式化 JSON 分析日志。
*   **CSV 导出防乱码**：导出为 CSV 格式时，算法对包含双引号、逗号及换行符的字段进行了深度 CSV 转义兼容，并**在文件头部自动注入 UTF-8 BOM 字符 (`\ufeff`)**，完美解决使用 Excel 或 WPS 双击直接打开时中文字符产生乱码的顽疾。

### 6. 高清快照折叠切换与 Lightbox 灯箱
*   **静态快照切换**：在实时分析状态下，点击“截图”按钮，可在实时的交互网页与由 Webview 自动捕捉生成的静态 Base64 高清快照图片之间进行平滑折叠切换。
*   **大图灯箱预览**：点击静态快照，将拉起具有对角展开微动效的 Lightbox 大图灯箱，方便查看分析每一帧的渲染细节。

### 7. 专属雷达图标自举渲染
*   **自举生成算法**：无需引入任何第三方的 Node.js 二进制图标依赖，本工具内置了 Chromium 绘图自举算法。每次应用在任意平台启动时，主进程会自动在后台无头将精美的雷达 SVG 图形通过 Canvas 导出为 `icon.png`，并合并 22 字节标准 ICO 二进制头部生成 `icon.ico`。
*   **全局视觉绑定**：生成的图标会自动应用于主窗口、放大预览子窗口的标题栏与任务栏底标中，同时在 `package.json` 的 `build.win` 配置中进行了绑定，支持打包生成统一带雷达图标的发布程序。

---

## 🛠️ 技术架构

*   **核心引擎**：[Electron (V31.7.7)](https://www.electronjs.org/) + Preload 沙箱隔离桥接
*   **网络拦截**：Chromium Native `session.webRequest` API
*   **前端逻辑**：HTML55 + CSS3 (自适应玻璃拟物炫酷暗色/明亮模式切换) + Vanilla JavaScript (原生逻辑控制，绝无冗余依赖)
*   **图标技术**：Canvas 自举合成 + 二进制 ICO 头部拼接算法

---

## 📂 项目结构树

```text
Viwport/
├── .agents/
│   └── AGENTS.md            # 资源程序员角色准则与核心功能防退化守则
├── history_records/         # 本地分析历史快照目录
│   ├── [UUID].json          # 各分析单次的请求详情与快照数据
│   └── index.json           # 历史快照列表主索引文件
├── renderer/                # 渲染层前端目录
│   ├── index.html           # 应用主界面骨架
│   ├── renderer.js          # 前端核心业务控制与 DOM 操作
│   └── styles.css           # 炫酷科技拟物风格样式表
├── main.js                  # Electron 主进程及 Sniffer 网络嗅探核心
├── preload.js               # 安全沙箱桥接配置文件
├── package.json             # 项目配置文件及 electron-builder 打包设置
├── icon.ico                 # 启动后自动生成的专属雷达 Windows 图标
├── icon.png                 # 启动后自动生成的高清雷达 PNG 图像
└── README.md                # 本说明文档
```

---

## ⚙️ 运行与构建

### 1. 环境准备
确保您的电脑上已安装 [Node.js](https://nodejs.org/) (建议 LTS 版本) 以及 `npm`。

### 2. 克隆本仓库并安装依赖
```bash
# 进入项目目录
cd Viwport

# 安装项目开发依赖 (如 electron 与 electron-builder)
npm install
```

### 3. 本地启动开发与调试
```bash
# 启动本地开发
npm start

# 启动带开发者工具调试的模式
npm run dev
```
*(注意：首次启动时，项目根目录下会自动生成专属的雷达图标 `icon.ico` 与 `icon.png`)*

### 4. 编译打包生成 Windows 可执行 EXE
```bash
npm run dist
```
打包成功后，Windows 免安装绿色 ZIP 发布包与 `win-unpacked` 绿色安装目录将输出在 `dist/` 文件夹中。直接运行 `WebRequestAnalysisTool.exe` 即可！

---

## 📄 开源协议

本项目基于 **MIT** 协议开源，详情请参阅 [LICENSE](LICENSE) 文件。
