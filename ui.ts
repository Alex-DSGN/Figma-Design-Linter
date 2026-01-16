// Design Linter UI Logic

console.log('UI script loaded');

interface Issue {
  id: string;
  nodeId: string;
  pageName: string;
  containerName: string;
  severity: 'error' | 'warn';
  type: string;
  message: string;
  path: string;
  paintContext?: {
    property: 'fills' | 'strokes' | 'backgrounds';
    paintIndex: number;
  };
}

interface LintResult {
  issues: Issue[];
  totalIssues: number;
  errors: number;
  warnings: number;
}

let currentResult: LintResult | null = null;

// DOM Elements - initialize after DOM is ready
let scopeSelect: HTMLSelectElement;
let runBtn: HTMLButtonElement;
let copyBtn: HTMLButtonElement;
let statsDiv: HTMLDivElement;
let totalCount: HTMLDivElement;
let errorCount: HTMLDivElement;
let warnCount: HTMLDivElement;
let resultsDiv: HTMLDivElement;

function initializeUI(): void {
  console.log('Initializing UI...');
  scopeSelect = document.getElementById('scope-select') as HTMLSelectElement;
  runBtn = document.getElementById('run-btn') as HTMLButtonElement;
  copyBtn = document.getElementById('copy-btn') as HTMLButtonElement;
  statsDiv = document.getElementById('stats') as HTMLDivElement;
  totalCount = document.getElementById('total-count') as HTMLDivElement;
  errorCount = document.getElementById('error-count') as HTMLDivElement;
  warnCount = document.getElementById('warn-count') as HTMLDivElement;
  resultsDiv = document.getElementById('results') as HTMLDivElement;

  if (!scopeSelect || !runBtn || !copyBtn || !statsDiv || !totalCount || !errorCount || !warnCount || !resultsDiv) {
    console.error('Failed to find required DOM elements');
    console.error('Elements found:', {
      scopeSelect: !!scopeSelect,
      runBtn: !!runBtn,
      copyBtn: !!copyBtn,
      statsDiv: !!statsDiv,
      totalCount: !!totalCount,
      errorCount: !!errorCount,
      warnCount: !!warnCount,
      resultsDiv: !!resultsDiv,
    });
    return;
  }
  
  console.log('UI initialized successfully');

  // Event Listeners
  runBtn.addEventListener('click', () => {
    const scope = scopeSelect.value as 'selection' | 'currentPage';
    runLint(scope);
  });

  copyBtn.addEventListener('click', () => {
    if (currentResult) {
      copyToClipboard(JSON.stringify(currentResult, null, 2));
    }
  });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeUI);
} else {
  initializeUI();
}

// Message Handler
window.onmessage = (event: MessageEvent) => {
  const msg = event.data.pluginMessage;
  console.log('UI received message:', msg);

  if (msg && msg.type === 'lint-result') {
    displayResults(msg.result);
  } else if (msg && msg.type === 'lint-error') {
    displayError(msg.error);
  } else {
    console.warn('Unknown message type:', msg);
  }
};

// Functions
function runLint(scope: 'selection' | 'currentPage'): void {
  console.log('runLint called with scope:', scope);
  if (!runBtn || !resultsDiv || !statsDiv || !copyBtn) {
    console.error('UI elements not initialized');
    return;
  }
  
  runBtn.disabled = true;
  runBtn.textContent = 'Running...';
  resultsDiv.innerHTML = '<div class="loading">Scanning design...</div>';
  statsDiv.style.display = 'none';
  copyBtn.style.display = 'none';

  const message = {
    pluginMessage: {
      type: 'run-lint',
      scope,
    },
  };
  
  console.log('Sending message to plugin:', message);
  parent.postMessage(message, '*');
}

function displayResults(result: LintResult): void {
  currentResult = result;
  if (!runBtn || !statsDiv || !copyBtn || !totalCount || !errorCount || !warnCount || !resultsDiv) {
    console.error('UI elements not initialized');
    return;
  }
  
  runBtn.disabled = false;
  runBtn.textContent = 'Run';

  // Update stats
  totalCount.textContent = result.totalIssues.toString();
  errorCount.textContent = result.errors.toString();
  warnCount.textContent = result.warnings.toString();
  statsDiv.style.display = 'flex';
  copyBtn.style.display = 'block';

  // Group issues by page -> container
  const grouped = groupIssues(result.issues);

  if (result.issues.length === 0) {
    resultsDiv.innerHTML = '<div class="results-empty">✓ No issues found! All colors use Styles or Variables.</div>';
    return;
  }

  // Render grouped issues
  let html = '';
  for (const pageName in grouped) {
    const pageIssues = grouped[pageName];
    html += `<div class="issue-group">`;
    html += `<div class="group-header">Page: ${escapeHtml(pageName)}</div>`;

    for (const containerName in pageIssues) {
      const containerIssues = pageIssues[containerName];
      html += `<div style="margin-left: 12px; margin-bottom: 8px;">`;
      html += `<div style="font-weight: 500; font-size: 11px; color: #666; margin-bottom: 4px;">${escapeHtml(containerName)}</div>`;

      for (const issue of containerIssues) {
        html += renderIssue(issue);
      }

      html += `</div>`;
    }

    html += `</div>`;
  }

  resultsDiv.innerHTML = html;

  // Attach click handlers
  const issueElements = resultsDiv.querySelectorAll('.issue');
  issueElements.forEach((el) => {
    const nodeId = el.getAttribute('data-node-id');
    if (nodeId) {
      el.addEventListener('click', () => {
        selectNode(nodeId);
      });
    }
  });
}

function groupIssues(issues: Issue[]): Record<string, Record<string, Issue[]>> {
  const grouped: Record<string, Record<string, Issue[]>> = {};

  for (const issue of issues) {
    if (!grouped[issue.pageName]) {
      grouped[issue.pageName] = {};
    }
    if (!grouped[issue.pageName][issue.containerName]) {
      grouped[issue.pageName][issue.containerName] = [];
    }
    grouped[issue.pageName][issue.containerName].push(issue);
  }

  return grouped;
}

function renderIssue(issue: Issue): string {
  return `
    <div class="issue ${issue.severity}" data-node-id="${issue.nodeId}">
      <div class="issue-header">
        <span class="issue-severity ${issue.severity}">${issue.severity}</span>
        <span class="issue-type">${escapeHtml(issue.type)}</span>
      </div>
      <div class="issue-message">${escapeHtml(issue.message)}</div>
      <div class="issue-path">${escapeHtml(issue.path)}</div>
    </div>
  `;
}

function selectNode(nodeId: string): void {
  parent.postMessage(
    {
      pluginMessage: {
        type: 'select-node',
        nodeId,
      },
    },
    '*'
  );
}

function displayError(error: string): void {
  if (!runBtn || !resultsDiv) {
    console.error('UI elements not initialized');
    return;
  }
  
  runBtn.disabled = false;
  runBtn.textContent = 'Run';
  resultsDiv.innerHTML = `<div class="results-empty" style="color: #e53935;">Error: ${escapeHtml(error)}</div>`;
}

function copyToClipboard(text: string): void {
  navigator.clipboard.writeText(text).then(() => {
    const originalText = copyBtn.textContent;
    copyBtn.textContent = 'Copied!';
    setTimeout(() => {
      copyBtn.textContent = originalText;
    }, 2000);
  }).catch((err) => {
    console.error('Failed to copy:', err);
    alert('Failed to copy to clipboard');
  });
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
