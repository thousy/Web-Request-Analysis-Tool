const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  /** 同步阻断状态与规则 */
  updateBlockingState: (params) => ipcRenderer.send('update-blocking-state', params),

  /** 弹出新大窗口放大查看网页 */
  openPreviewWindow: (url) => ipcRenderer.send('open-preview-window', url),

  /** 通知主进程同步刷新所有已放大的大预览窗口 */
  reloadPreviewWindows: () => ipcRenderer.send('reload-preview-windows'),

  /** 保存抓取历史存盘 */
  saveHistory: (params) => ipcRenderer.invoke('save-history', params),

  /** 导出 CSV/JSON 数据 */
  exportData: (params) => ipcRenderer.invoke('export-data', params),

  /** 获取历史简要索引 */
  getHistoryList: () => ipcRenderer.invoke('get-history-list'),

  /** 加载单条历史详情 */
  loadHistoryDetail: (id) => ipcRenderer.invoke('load-history-detail', id),

  /** 删除单条历史 */
  deleteHistory: (id) => ipcRenderer.invoke('delete-history', id),

  /** 清空所有历史 */
  clearAllHistory: () => ipcRenderer.invoke('clear-all-history'),

  /** 清除预览视口 Session 的 HTTP 缓存 */
  clearCache: () => ipcRenderer.invoke('clear-cache'),

  /** 注册请求捕获回调（主进程实时推送） */
  onRequestCaptured: (callback) => {
    ipcRenderer.on('request-captured', (_event, data) => callback(data));
  },

  /** 移除所有监听器 */
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});
