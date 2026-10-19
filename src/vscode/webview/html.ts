/**
 * webview 内容：单文件 HTML + 内联 JS（无前端构建链）。
 * 消费 host 推送的 `ui-event` / `turn-diff` / `meta` / `notice` 消息，
 * 渲染对话正文与回合 diff。所有入站消息按类型白名单解析。
 */
export function webviewHtml(cspSource: string): string {
  const nonce = Math.random().toString(36).slice(2)
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>ds-codebot</title>
<style>
  body { font-family: var(--vscode-font-family, sans-serif); color: var(--vscode-foreground, #ccc); padding: 8px; }
  #log { display: flex; flex-direction: column; gap: 6px; }
  .user { color: var(--vscode-textLink-foreground, #4daafc); font-weight: bold; white-space: pre-wrap; }
  .assistant { white-space: pre-wrap; }
  .tool { color: var(--vscode-editorWarning-foreground, #cca700); }
  .dim { color: var(--vscode-descriptionForeground, #888); font-size: 0.9em; }
  .notice { color: var(--vscode-errorForeground, #f14c4c); }
  .notice.info { color: var(--vscode-textPreformat-foreground, #b5cea8); }
  .diff { background: var(--vscode-textCodeBlock-background, #1e1e1e); border-radius: 4px; padding: 6px; font-family: var(--vscode-editor-font-family, monospace); font-size: 0.9em; overflow-x: auto; }
  .diff .head { font-weight: bold; margin-bottom: 2px; }
  .diff pre { margin: 0; white-space: pre; }
  .add { color: #4ec9b0; }
  .del { color: #f14c4c; }
  .hunk { color: #888; }
  #composer { display: flex; gap: 6px; margin-top: 10px; }
  #input { flex: 1; background: var(--vscode-input-background, #333); color: var(--vscode-input-foreground, #eee); border: 1px solid var(--vscode-input-border, #555); padding: 6px; }
  #send { background: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #fff); border: none; padding: 6px 12px; cursor: pointer; }
  #meta { color: var(--vscode-descriptionForeground, #888); font-size: 0.85em; margin-bottom: 8px; }
</style>
</head>
<body>
<div id="meta"></div>
<div id="log"></div>
<div id="composer">
  <input id="input" type="text" placeholder="输入任务，/cwd <目录> 切换目录，Enter 发送" />
  <button id="send" nonce="${nonce}">发送</button>
</div>
<script nonce="${nonce}">
(function () {
  var vscode = acquireVsCodeApi();
  var log = document.getElementById('log');
  var meta = document.getElementById('meta');
  var input = document.getElementById('input');

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderDiff(files) {
    var box = el('div', 'diff');
    files.forEach(function (file) {
      box.appendChild(el('div', 'head', file.path + ' (+' + file.added + ' -' + file.removed + ')'));
      var pre = el('pre');
      file.patch.split('\\n').forEach(function (line) {
        var span = el('span', line.indexOf('+') === 0 && line.indexOf('+++') !== 0 ? 'add' : (line.indexOf('-') === 0 && line.indexOf('---') !== 0 ? 'del' : (line.indexOf('@') === 0 ? 'hunk' : '')));
        span.textContent = line;
        pre.appendChild(span);
        pre.appendChild(document.createTextNode('\\n'));
      });
      box.appendChild(pre);
    });
    log.appendChild(box);
    vscode.setState({ scroll: document.body.scrollHeight });
  }

  window.addEventListener('message', function (event) {
    var message = event.data;
    if (!message || typeof message.type !== 'string') return;
    if (message.type === 'meta') {
      meta.textContent = 'session ' + message.sessionId + ' · 文件夹 ' + message.folder + ' · ' + message.cwd;
      return;
    }
    if (message.type === 'notice') {
      log.appendChild(el('div', 'notice' + (message.tone === 'info' ? ' info' : ''), message.text));
      return;
    }
    if (message.type === 'turn-diff' && Array.isArray(message.files)) {
      renderDiff(message.files);
      return;
    }
    if (message.type !== 'ui-event' || !message.event) return;
    var event2 = message.event;
    if (event2.kind === 'user-text') log.appendChild(el('div', 'user', '> ' + event2.text));
    else if (event2.kind === 'assistant-text') log.appendChild(el('div', 'assistant', event2.text));
    else if (event2.kind === 'tool-call') log.appendChild(el('div', 'tool', '⚙ ' + event2.name + '(' + event2.args.slice(0, 120) + ')'));
    else if (event2.kind === 'tool-result') log.appendChild(el('div', 'dim', event2.isError ? '✗ 工具失败' : '✓ 工具完成'));
    else if (event2.kind === 'turn-start') log.appendChild(el('div', 'dim', '── turn 开始 ──'));
    else if (event2.kind === 'turn-end') log.appendChild(el('div', 'dim', '── turn 结束 ──'));
  });

  function submit() {
    var text = input.value;
    if (!text.trim()) return;
    if (text.trim().indexOf('/cwd ') === 0) {
      vscode.postMessage({ type: 'cwd', path: text.trim().slice(5).trim() });
    } else {
      vscode.postMessage({ type: 'prompt', text: text });
    }
    input.value = '';
  }

  document.getElementById('send').addEventListener('click', submit);
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') submit();
  });
  vscode.postMessage({ type: 'ready' });
})();
</script>
</body>
</html>`
}
