// Design Linter UI Logic

type Scope = 'selection' | 'currentPage';
type ContrastLevel = 'aa' | 'aaa';

interface Issue {
  id: string;
  nodeId: string;
  nodeType?: string;
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

interface UISettings {
  scope: Scope;
  checks: {
    colors: boolean;
    accessibility: boolean;
    unusedStyles: boolean;
    unusedTextStyles: boolean;
    unusedEffectStyles: boolean;
    textStyles: boolean;
    effects: boolean;
    warnTransparent: boolean;
    contrastLevel: ContrastLevel;
  };
  nodeFilters: {
    components: boolean;
    instances: boolean;
    text: boolean;
    containers: boolean;
    shapes: boolean;
  };
}

const defaultSettings: UISettings = {
  scope: 'currentPage',
  checks: {
    colors: true,
    accessibility: true,
    unusedStyles: true,
    unusedTextStyles: true,
    unusedEffectStyles: true,
    textStyles: true,
    effects: true,
    warnTransparent: true,
    contrastLevel: 'aa',
  },
  nodeFilters: {
    components: true,
    instances: true,
    text: true,
    containers: true,
    shapes: true,
  },
};

let settings: UISettings = { ...defaultSettings };
let currentResult: LintResult | null = null;
let allIssues: Issue[] = [];

// DOM Elements
let scopeSelect: HTMLSelectElement | null;
let runBtn: HTMLButtonElement | null;
let statsDiv: HTMLDivElement | null;
let totalCount: HTMLDivElement | null;
let errorCount: HTMLDivElement | null;
let warnCount: HTMLDivElement | null;
let resultsDiv: HTMLDivElement | null;
let filterToggleBtn: HTMLButtonElement | null;
let filtersContainer: HTMLDivElement | null;
let contrastLevelSelect: HTMLSelectElement | null;
let checkColors: HTMLInputElement | null;
let checkAccessibility: HTMLInputElement | null;
let checkUnusedColors: HTMLInputElement | null;
let checkUnusedText: HTMLInputElement | null;
let checkUnusedEffects: HTMLInputElement | null;
let checkTextStyles: HTMLInputElement | null;
let checkEffects: HTMLInputElement | null;
let checkWarnTransparent: HTMLInputElement | null;
let filterComponents: HTMLInputElement | null;
let filterInstances: HTMLInputElement | null;
let filterText: HTMLInputElement | null;
let filterContainers: HTMLInputElement | null;
let filterShapes: HTMLInputElement | null;

function initDom() {
  scopeSelect = document.getElementById('scope-select') as HTMLSelectElement;
  runBtn = document.getElementById('run-btn') as HTMLButtonElement;
  statsDiv = document.getElementById('stats') as HTMLDivElement;
  totalCount = document.getElementById('total-count') as HTMLDivElement;
  errorCount = document.getElementById('error-count') as HTMLDivElement;
  warnCount = document.getElementById('warn-count') as HTMLDivElement;
  resultsDiv = document.getElementById('results') as HTMLDivElement;
  filterToggleBtn = document.getElementById('filter-toggle-btn') as HTMLButtonElement;
  filtersContainer = document.getElementById('filters-container') as HTMLDivElement;
  contrastLevelSelect = document.getElementById('contrast-level') as HTMLSelectElement;
  checkColors = document.getElementById('check-colors') as HTMLInputElement;
  checkAccessibility = document.getElementById('check-accessibility') as HTMLInputElement;
  checkUnusedColors = document.getElementById('check-unused-colors') as HTMLInputElement;
  checkUnusedText = document.getElementById('check-unused-text') as HTMLInputElement;
  checkUnusedEffects = document.getElementById('check-unused-effects') as HTMLInputElement;
  checkTextStyles = document.getElementById('check-text-styles') as HTMLInputElement;
  checkEffects = document.getElementById('check-effects') as HTMLInputElement;
  checkWarnTransparent = document.getElementById('check-warn-transparent') as HTMLInputElement;
  filterComponents = document.getElementById('filter-components') as HTMLInputElement;
  filterInstances = document.getElementById('filter-instances') as HTMLInputElement;
  filterText = document.getElementById('filter-text') as HTMLInputElement;
  filterContainers = document.getElementById('filter-containers') as HTMLInputElement;
  filterShapes = document.getElementById('filter-shapes') as HTMLInputElement;
}

function bindEvents() {
  if (!runBtn || !scopeSelect) return;

  runBtn.addEventListener('click', () => {
    const scope = (scopeSelect!.value as Scope) || 'currentPage';
    runLint(scope);
    persistSettings();
  });

  if (filterToggleBtn && filtersContainer) {
    filterToggleBtn.addEventListener('click', () => {
      const isVisible = filtersContainer!.classList.toggle('visible');
      if (isVisible) {
        filterToggleBtn!.classList.add('active');
      } else {
        filterToggleBtn!.classList.remove('active');
      }
    });
  }

  const checkboxes = [
    checkColors,
    checkAccessibility,
    checkUnusedColors,
    checkUnusedText,
    checkUnusedEffects,
    checkTextStyles,
    checkEffects,
    checkWarnTransparent,
    filterComponents,
    filterInstances,
    filterText,
    filterContainers,
    filterShapes,
  ].filter(Boolean) as HTMLInputElement[];

  checkboxes.forEach((cb) => {
    cb.addEventListener('change', () => {
      persistSettings();
      if (allIssues.length > 0) {
        renderFiltered();
      }
    });
  });

  if (contrastLevelSelect) {
    contrastLevelSelect.addEventListener('change', () => {
      persistSettings();
    });
  }

  if (scopeSelect) {
    scopeSelect.addEventListener('change', () => persistSettings());
  }
}

function requestSettings() {
  parent.postMessage({ pluginMessage: { type: 'request-settings' } }, '*');
}

function persistSettings() {
  const nextSettings = collectSettingsFromUI();
  settings = nextSettings;
  parent.postMessage({ pluginMessage: { type: 'save-settings', settings: nextSettings } }, '*');
}

function collectSettingsFromUI(): UISettings {
  return {
    scope: (scopeSelect?.value as Scope) || 'currentPage',
    checks: {
      colors: checkColors?.checked ?? true,
      accessibility: checkAccessibility?.checked ?? true,
      unusedStyles: checkUnusedColors?.checked ?? true,
      unusedTextStyles: checkUnusedText?.checked ?? true,
      unusedEffectStyles: checkUnusedEffects?.checked ?? true,
      textStyles: checkTextStyles?.checked ?? true,
      effects: checkEffects?.checked ?? true,
      warnTransparent: checkWarnTransparent?.checked ?? true,
      contrastLevel: (contrastLevelSelect?.value as ContrastLevel) || 'aa',
    },
    nodeFilters: {
      components: filterComponents?.checked ?? true,
      instances: filterInstances?.checked ?? true,
      text: filterText?.checked ?? true,
      containers: filterContainers?.checked ?? true,
      shapes: filterShapes?.checked ?? true,
    },
  };
}

function applySettings(newSettings: UISettings) {
  settings = {
    ...defaultSettings,
    ...newSettings,
    checks: { ...defaultSettings.checks, ...newSettings.checks },
    nodeFilters: { ...defaultSettings.nodeFilters, ...newSettings.nodeFilters },
  };

  if (scopeSelect) scopeSelect.value = settings.scope;
  if (checkColors) checkColors.checked = settings.checks.colors;
  if (checkAccessibility) checkAccessibility.checked = settings.checks.accessibility;
  if (checkUnusedColors) checkUnusedColors.checked = settings.checks.unusedStyles;
  if (checkUnusedText) checkUnusedText.checked = settings.checks.unusedTextStyles;
  if (checkUnusedEffects) checkUnusedEffects.checked = settings.checks.unusedEffectStyles;
  if (checkTextStyles) checkTextStyles.checked = settings.checks.textStyles;
  if (checkEffects) checkEffects.checked = settings.checks.effects;
  if (checkWarnTransparent) checkWarnTransparent.checked = settings.checks.warnTransparent;
  if (contrastLevelSelect) contrastLevelSelect.value = settings.checks.contrastLevel;

  if (filterComponents) filterComponents.checked = settings.nodeFilters.components;
  if (filterInstances) filterInstances.checked = settings.nodeFilters.instances;
  if (filterText) filterText.checked = settings.nodeFilters.text;
  if (filterContainers) filterContainers.checked = settings.nodeFilters.containers;
  if (filterShapes) filterShapes.checked = settings.nodeFilters.shapes;
}

function runLint(scope: Scope) {
  if (!runBtn || !resultsDiv || !statsDiv) {
    console.error('UI elements not initialized');
    return;
  }

  runBtn.disabled = true;
  runBtn.textContent = 'Выполняется...';
  resultsDiv.innerHTML = '<div class="loading">Сканирование дизайна...</div>';
  statsDiv.style.display = 'none';

  const currentSettings = collectSettingsFromUI();

  const message = {
    pluginMessage: {
      type: 'run-lint',
      scope,
      checkTypes: {
        colors: currentSettings.checks.colors,
        accessibility: currentSettings.checks.accessibility,
        unusedStyles: currentSettings.checks.unusedStyles,
        unusedTextStyles: currentSettings.checks.unusedTextStyles,
        unusedEffectStyles: currentSettings.checks.unusedEffectStyles,
        textStyles: currentSettings.checks.textStyles,
        effects: currentSettings.checks.effects,
        warnTransparent: currentSettings.checks.warnTransparent,
        contrastLevel: currentSettings.checks.contrastLevel,
      },
      nodeFilters: currentSettings.nodeFilters,
    },
  };

  parent.postMessage(message, '*');
}

function displayResults(result: LintResult) {
  currentResult = result;
  allIssues = result.issues;
  if (!runBtn || !statsDiv || !totalCount || !errorCount || !warnCount || !resultsDiv) {
    console.error('UI elements not initialized');
    return;
  }

  runBtn.disabled = false;
  runBtn.textContent = 'Поиск';
  statsDiv.style.display = 'flex';

  renderFiltered();
}

function updateStats(issues: Issue[]) {
  if (!totalCount || !errorCount || !warnCount) return;
  const total = issues.length;
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warn').length;
  totalCount.textContent = total.toString();
  errorCount.textContent = errors.toString();
  warnCount.textContent = warnings.toString();
}

function getNodeCategory(nodeType?: string | undefined | null) {
  if (!nodeType) return null;
  if (nodeType === 'COMPONENT' || nodeType === 'COMPONENT_SET') return 'components';
  if (nodeType === 'INSTANCE') return 'instances';
  if (nodeType === 'TEXT' || nodeType === 'TEXT_PATH') return 'text';
  if (nodeType === 'FRAME' || nodeType === 'SECTION' || nodeType === 'GROUP' || nodeType === 'TRANSFORM_GROUP') return 'containers';
  const shapes = new Set(['RECTANGLE','ELLIPSE','POLYGON','STAR','LINE','VECTOR','BOOLEAN_OPERATION','SHAPE_WITH_TEXT','CONNECTOR']);
  if (shapes.has(nodeType)) return 'shapes';
  return null;
}

function passesNodeFilters(issue: Issue): boolean {
  if (!issue || !issue.nodeId) return true;
  const category = getNodeCategory(issue.nodeType);
  if (!category) return true;
  const filters = settings.nodeFilters;
  return filters[category as keyof typeof filters] !== false;
}

function getIssueGroup(issue: Issue) {
  if (!issue) return 'other';
  if (['low-contrast', 'text-without-style', 'transparent-text'].includes(issue.type)) return 'text';
  if (['unused-style','unused-text-style','unused-effect-style'].includes(issue.type)) return 'styles';
  if (issue.type === 'effects-without-style') return 'effects';
  if (issue.paintContext && issue.paintContext.property === 'fills') return 'fill';
  if (issue.paintContext && issue.paintContext.property === 'strokes') return 'stroke';
  if (issue.paintContext && issue.paintContext.property === 'backgrounds') return 'background';
  return 'other';
}

function groupIssuesByType(issues: Issue[]) {
  const grouped: Record<string, Record<string, Record<string, Issue[]>>> = {};
  for (const issue of issues) {
    if (!grouped[issue.pageName]) grouped[issue.pageName] = {};
    if (!grouped[issue.pageName][issue.containerName]) grouped[issue.pageName][issue.containerName] = {};
    const bucket = getIssueGroup(issue);
    if (!grouped[issue.pageName][issue.containerName][bucket]) grouped[issue.pageName][issue.containerName][bucket] = [];
    grouped[issue.pageName][issue.containerName][bucket].push(issue);
  }
  return grouped;
}

function renderFiltered() {
  if (!resultsDiv) return;

  if (!allIssues || allIssues.length === 0) {
    updateStats([]);
    resultsDiv.innerHTML = '<div class="results-empty">✓ Проблем не найдено! Все цвета используют Styles или Variables.</div>';
    return;
  }

  const filtered = allIssues.filter(passesNodeFilters);
  if (filtered.length === 0) {
    updateStats([]);
    resultsDiv.innerHTML = '<div class="results-empty">Нет проблем, соответствующих выбранным фильтрам.</div>';
    return;
  }

  updateStats(filtered);

  const grouped = groupIssuesByType(filtered);
  const groupLabels: Record<string, string> = {
    fill: 'Fill',
    stroke: 'Stroke',
    background: 'Background',
    text: 'Text',
    effects: 'Effects',
    styles: 'Styles',
    other: 'Other',
  };
  const groupOrder = ['fill','stroke','background','text','effects','styles','other'];

  let html = '';
  for (const pageName in grouped) {
    const pageIssues = grouped[pageName];
    for (const containerName in pageIssues) {
      const byType = pageIssues[containerName];
      html += '<div class="issue-group"><div class="group-header">' + escapeHtml(containerName) + '</div>';

      for (const groupKey of groupOrder) {
        const issuesInGroup = byType[groupKey];
        if (!issuesInGroup || issuesInGroup.length === 0) continue;
        html += '<div style="margin: 6px 0 4px; font-weight: 600; font-size: 10px; color: #666; text-transform: uppercase;">' + groupLabels[groupKey] + '</div>';
        for (const issue of issuesInGroup) {
          html += renderIssue(issue);
        }
      }
      html += '</div>';
    }
  }
  resultsDiv.innerHTML = html;

  const issueElements = resultsDiv.querySelectorAll('.issue');
  issueElements.forEach((el) => {
    const nodeId = el.getAttribute('data-node-id');
    if (nodeId) {
      el.addEventListener('click', () => selectNode(nodeId));
    }
  });
}

function renderIssue(issue: Issue) {
  const severityText = issue.severity === 'error' ? 'ошибка' : 'предупреждение';
  const typeTextMap: Record<string, string> = {
    'color-without-style-or-variable': 'цвет без Style/Variable',
    'mixed-paints': 'смешанные значения',
    'low-contrast': 'низкий контраст',
    'unused-style': 'неиспользуемый цветовой стиль',
    'unused-text-style': 'неиспользуемый текстовый стиль',
    'unused-effect-style': 'неиспользуемый эффект стиль',
    'text-without-style': 'текст без стиля',
    'transparent-text': 'прозрачный текст',
    'effects-without-style': 'эффекты без стиля',
  };
  const typeText = typeTextMap[issue.type] || issue.type;
  const nodeIdAttr = issue.nodeId ? 'data-node-id="' + issue.nodeId + '"' : '';
  return '<div class="issue ' + issue.severity + '" ' + nodeIdAttr + '><div class="issue-header"><span class="issue-severity ' + issue.severity + '">' + severityText + '</span><span class="issue-type">' + escapeHtml(typeText) + '</span></div><div class="issue-message">' + escapeHtml(issue.message) + '</div><div class="issue-path">' + escapeHtml(issue.path) + '</div></div>';
}

function selectNode(nodeId: string) {
  parent.postMessage({ pluginMessage: { type: 'select-node', nodeId } }, '*');
}

function displayError(error: string) {
  if (!runBtn || !resultsDiv) {
    console.error('UI elements not initialized');
    return;
  }
  runBtn.disabled = false;
  runBtn.textContent = 'Поиск';
  resultsDiv.innerHTML = '<div class="results-empty" style="color: #e53935;">Ошибка: ' + escapeHtml(error) + '</div>';
}

function escapeHtml(text: string) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

window.onmessage = (event: MessageEvent) => {
  const msg = event.data?.pluginMessage;
  if (!msg) return;
  if (msg.type === 'settings') {
    applySettings(msg.settings as UISettings);
  } else if (msg.type === 'lint-result') {
    displayResults(msg.result as LintResult);
  } else if (msg.type === 'lint-error') {
    displayError(msg.error as string);
  }
};

function start() {
  initDom();
  bindEvents();
  requestSettings();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
