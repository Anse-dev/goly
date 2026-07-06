/**
 * Dashboard WebView (placeholder for future React dashboard)
 */

import * as vscode from 'vscode';

export function createDashboardPanel(context: vscode.ExtensionContext): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    'goly.dashboard',
    'Goly Dashboard',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  panel.webview.html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          font-family: var(--vscode-font-family);
          padding: 20px;
          color: var(--vscode-foreground);
          background: var(--vscode-editor-background);
        }
        h1 { color: var(--vscode-textLink-foreground); }
        .card {
          border: 1px solid var(--vscode-widget-border);
          border-radius: 8px;
          padding: 16px;
          margin: 10px 0;
          background: var(--vscode-widget-background);
        }
        .metric {
          font-size: 32px;
          font-weight: bold;
          color: var(--vscode-textLink-foreground);
        }
        .label { color: var(--vscode-foreground); opacity: 0.8; }
      </style>
    </head>
    <body>
      <h1>🎛️ Goly Dashboard</h1>
      <p>Your parallel workspace cockpit.</p>
      
      <div class="card">
        <div class="metric" id="worktree-count">-</div>
        <div class="label">Active Worktrees</div>
      </div>
      
      <div class="card">
        <div class="metric" id="port-count">-</div>
        <div class="label">Open Ports</div>
      </div>
      
      <div class="card">
        <div class="metric" id="agent-count">-</div>
        <div class="label">Active Agents</div>
      </div>

      <script>
        // TODO: Connect to extension via postMessage
        const vscode = acquireVsCodeApi();
      </script>
    </body>
    </html>
  `;

  return panel;
}
