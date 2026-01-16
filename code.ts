/// <reference types="@figma/plugin-typings" />

// Design Linter Plugin - Main Code
// Extensible rule engine for linting Figma designs

// ============================================================================
// Types & Interfaces
// ============================================================================

type Scope = 'selection' | 'currentPage';

type Severity = 'error' | 'warn';

interface Issue {
  id: string;
  nodeId: string;
  nodeType?: NodeType;
  pageName: string;
  containerName: string;
  severity: Severity;
  type: string;
  message: string;
  path: string;
  paintContext?: {
    property: 'fills' | 'strokes' | 'backgrounds';
    paintIndex: number;
  };
}

interface PaintContext {
  property: 'fills' | 'strokes' | 'backgrounds';
  paintIndex: number;
}

interface Rule {
  name: string;
  lint: (node: SceneNode) => Issue[];
}

interface LintResult {
  issues: Issue[];
  totalIssues: number;
  errors: number;
  warnings: number;
}

interface FilterOptions {
  severity?: 'error' | 'warn' | 'all';
  type?: string;
  containerName?: string;
}

// ============================================================================
// Rule Engine
// ============================================================================

class Linter {
  private rules: Rule[] = [];

  addRule(rule: Rule): void {
    this.rules.push(rule);
  }

  lint(nodes: SceneNode[], enabledRuleNames?: string[]): Issue[] {
    const allIssues: Issue[] = [];
    
    // Filter rules if enabledRuleNames is provided
    const rulesToUse = enabledRuleNames 
      ? this.rules.filter(rule => enabledRuleNames.includes(rule.name))
      : this.rules;
    
    for (const node of nodes) {
      for (const rule of rulesToUse) {
        try {
          const issues = rule.lint(node);
          allIssues.push(...issues);
        } catch (error) {
          console.error(`Error in rule ${rule.name} for node ${node.id}:`, error);
        }
      }
    }

    return allIssues;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function getPath(node: SceneNode): string {
  const parts: string[] = [];
  let current: BaseNode | null = node;

  while (current && current.type !== 'DOCUMENT') {
    parts.unshift(current.name);
    current = current.parent;
  }

  return parts.join(' / ');
}

function getTopContainer(node: SceneNode): { name: string; node: BaseNode } {
  // Find the topmost Frame/Section (the one directly on the page)
  // This groups all issues by the root Frame, not by intermediate containers
  
  // If the node itself is a Frame/Section on the page, use it
  if ((node.type === 'FRAME' || node.type === 'SECTION') && node.parent && node.parent.type === 'PAGE') {
    const containerName = node.name || (node.type === 'FRAME' ? 'Frame' : 'Section');
    return { name: containerName, node: node };
  }

  // Walk up the tree to find the topmost Frame/Section (one whose parent is PAGE)
  let current: BaseNode | null = node.parent;
  let topFrame: BaseNode | null = null;

  while (current) {
    if (current.type === 'FRAME' || current.type === 'SECTION') {
      // Check if this Frame/Section is directly on the page
      if (current.parent && current.parent.type === 'PAGE') {
        topFrame = current;
        break;
      }
      // Otherwise, remember it but continue searching
      if (!topFrame) {
        topFrame = current;
      }
    }
    if (current.type === 'PAGE') {
      break;
    }
    current = current.parent;
  }

  // If we found a top Frame/Section, use its name
  if (topFrame) {
    const containerName = topFrame.name || (topFrame.type === 'FRAME' ? 'Frame' : 'Section');
    return { name: containerName, node: topFrame };
  }

  // If node is directly on page (no Frame/Section parent), use page name
  const page = getPageName(node);
  return { name: page, node: figma.currentPage };
}

function collectNodes(scope: Scope): SceneNode[] {
  const nodes: SceneNode[] = [];

  if (scope === 'selection') {
    const selection = figma.currentPage.selection;
    for (const node of selection) {
      // Check if node has fills, strokes, effects, text style, or is a frame/section
      const hasFills = 'fills' in node;
      const hasStrokes = 'strokes' in node;
      const hasEffects = 'effects' in node;
      const isText = node.type === 'TEXT';
      const isFrameOrSection = node.type === 'FRAME' || node.type === 'SECTION';
      
      if (hasFills || hasStrokes || hasEffects || isText || isFrameOrSection) {
        nodes.push(node as SceneNode);
      }
      // Also collect children recursively
      if ('children' in node) {
        collectNodesRecursive(node as ChildrenMixin, nodes);
      }
    }
  } else {
    // Current page
    collectNodesRecursive(figma.currentPage, nodes);
  }

  return nodes;
}

function collectNodesRecursive(
  parent: ChildrenMixin | PageNode,
  nodes: SceneNode[]
): void {
  for (const child of parent.children) {
    // Check if child has fills, strokes, effects, text style, or is a frame/section
    const hasFills = 'fills' in child;
    const hasStrokes = 'strokes' in child;
    const hasEffects = 'effects' in child;
    const isText = child.type === 'TEXT';
    const isFrameOrSection = child.type === 'FRAME' || child.type === 'SECTION';
    
    if (hasFills || hasStrokes || hasEffects || isText || isFrameOrSection) {
      nodes.push(child as SceneNode);
    }
    if ('children' in child) {
      collectNodesRecursive(child as ChildrenMixin, nodes);
    }
  }
}

// ============================================================================
// Color Linting Rules
// ============================================================================

// Translation dictionaries
const propertyNames: Record<string, string> = {
  'fills': 'Заливка',
  'strokes': 'Обводка',
  'backgrounds': 'Фон'
};

const paintTypeNames: Record<string, string> = {
  'solid': 'сплошной',
  'gradient-linear': 'линейный градиент',
  'gradient-radial': 'радиальный градиент',
  'gradient-angular': 'угловой градиент',
  'gradient-diamond': 'ромбовидный градиент'
};

function hasStyleBinding(paint: Paint, node: SceneNode, property: string): boolean {
  // Check node-level style bindings (for fills/strokes)
  // In Figma API, styleId is typically on the node, not the paint
  if (property === 'fills' && 'fillStyleId' in node) {
    const fillStyleId = node.fillStyleId;
    if (fillStyleId && typeof fillStyleId === 'string') {
      return true;
    }
  }
  if (property === 'strokes' && 'strokeStyleId' in node) {
    const strokeStyleId = node.strokeStyleId;
    if (strokeStyleId && typeof strokeStyleId === 'string') {
      return true;
    }
  }
  
  // For frame backgrounds, check if it's a FrameNode with backgroundStyleId
  if (property === 'backgrounds' && node.type === 'FRAME') {
    const frame = node as FrameNode;
    if ('backgroundStyleId' in frame) {
      const backgroundStyleId = frame.backgroundStyleId;
      if (backgroundStyleId && typeof backgroundStyleId === 'string') {
        return true;
      }
    }
  }

  return false;
}

function hasVariableBinding(paint: Paint): boolean {
  // Check if paint has boundVariables
  if ('boundVariables' in paint && paint.boundVariables) {
    const boundVars = paint.boundVariables;
    // Check if any color-related fields have variable bindings
    if (boundVars && typeof boundVars === 'object') {
      // boundVariables is an object with specific keys like 'color'
      if ('color' in boundVars && boundVars.color) {
          return true;
      }
    }
  }
  return false;
}

function getPageName(node: SceneNode): string {
  let current: BaseNode | null = node;
  while (current) {
    if (current.type === 'PAGE') {
      return current.name;
    }
    current = current.parent;
  }
  return 'Unknown';
}

function lintColors(node: SceneNode): Issue[] {
  const issues: Issue[] = [];
  const pageName = getPageName(node);
  const container = getTopContainer(node);
  const nodePath = getPath(node);

  // Helper to check a paint array
  function checkPaints(
    paints: readonly Paint[] | typeof figma.mixed,
    property: 'fills' | 'strokes' | 'backgrounds',
    nodeName: string
  ): void {
    if (paints === figma.mixed) {
      issues.push({
        id: `${node.id}-${property}-mixed`,
        nodeId: node.id,
        nodeType: node.type,
        pageName,
        containerName: container.name,
        severity: 'warn',
        type: 'mixed-paints',
        message: `Смешанные значения в ${propertyNames[property] || property} — требуется ручная проверка`,
        path: nodePath,
        paintContext: {
          property,
          paintIndex: -1,
        },
      });
      return;
    }

    if (!paints || paints.length === 0) {
      return;
    }

    for (let i = 0; i < paints.length; i++) {
      const paint = paints[i];

      // Skip IMAGE and VIDEO paints
      if (paint.type === 'IMAGE' || paint.type === 'VIDEO') {
        continue;
      }

      // Skip invisible paints
      if (paint.visible === false) {
        continue;
      }

      // Check opacity (treat 0 or undefined as invisible)
      const opacity = paint.opacity !== undefined ? paint.opacity : 1;
      if (opacity <= 0) {
        continue;
      }

      // Check if it's a solid or gradient paint
      if (paint.type === 'SOLID' || paint.type.startsWith('GRADIENT')) {
        const hasStyle = hasStyleBinding(paint, node, property);
        const hasVariable = hasVariableBinding(paint);

        if (!hasStyle && !hasVariable) {
          const paintType = paint.type.toLowerCase().replace('_', '-');
          const propertyName = propertyNames[property] || property;
          const paintTypeName = paintTypeNames[paintType] || paintType;
          issues.push({
            id: `${node.id}-${property}-${i}`,
            nodeId: node.id,
            nodeType: node.type,
            pageName,
            containerName: container.name,
            severity: 'error',
            type: 'color-without-style-or-variable',
            message: `${propertyName} #${i + 1} (${paintTypeName}) не имеет привязки к Style или Variable`,
            path: nodePath,
            paintContext: {
              property,
              paintIndex: i,
            },
          });
        }
      }
    }
  }

  // Check fills
  // For Frame nodes, skip fills check - use backgrounds instead
  if ('fills' in node && node.type !== 'FRAME') {
    checkPaints(node.fills, 'fills', node.name);
  }

  // Check strokes
  if ('strokes' in node) {
    checkPaints(node.strokes, 'strokes', node.name);
  }

  // Check frame backgrounds
  // For Frame nodes, only check backgrounds (not fills)
  if (node.type === 'FRAME' && 'backgrounds' in node) {
    checkPaints(node.backgrounds, 'backgrounds', node.name);
  }

  return issues;
}

// ============================================================================
// Unused Styles Check
// ============================================================================

function lintUnusedStyles(allNodes: SceneNode[]): Issue[] {
  const issues: Issue[] = [];
  
  // Collect all used style IDs
  const usedStyleIds = new Set<string>();
  
  for (const node of allNodes) {
    // Check fill styles
    if ('fillStyleId' in node && node.fillStyleId && typeof node.fillStyleId === 'string') {
      usedStyleIds.add(node.fillStyleId);
    }
    
    // Check stroke styles
    if ('strokeStyleId' in node && node.strokeStyleId && typeof node.strokeStyleId === 'string') {
      usedStyleIds.add(node.strokeStyleId);
    }
    
    // Check background styles for frames
    if (node.type === 'FRAME' && 'backgroundStyleId' in node) {
      const frame = node as FrameNode;
      if (frame.backgroundStyleId && typeof frame.backgroundStyleId === 'string') {
        usedStyleIds.add(frame.backgroundStyleId);
      }
    }
  }
  
  // Get all available color styles
  try {
    const localStyles = figma.getLocalPaintStyles();
    const pageName = allNodes.length > 0 ? getPageName(allNodes[0]) : 'Unknown';
    
    for (const style of localStyles) {
      if (!usedStyleIds.has(style.id)) {
        issues.push({
          id: `unused-style-${style.id}`,
          nodeId: '', // No specific node
          nodeType: undefined,
          pageName,
          containerName: 'Стили',
          severity: 'warn',
          type: 'unused-style',
          message: `Стиль "${style.name}" не используется нигде в дизайне`,
          path: `Color Style: ${style.name}`,
        });
      }
    }
  } catch (error) {
    console.error('Error checking unused styles:', error);
  }
  
  return issues;
}

// ============================================================================
// Accessibility Check (Contrast)
// ============================================================================

function getLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map(val => {
    val = val / 255;
    return val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function getContrastRatio(color1: RGB, color2: RGB): number {
  const l1 = getLuminance(color1.r * 255, color1.g * 255, color1.b * 255);
  const l2 = getLuminance(color2.r * 255, color2.g * 255, color2.b * 255);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function lintAccessibility(node: SceneNode): Issue[] {
  const issues: Issue[] = [];
  
  // Only check text nodes
  if (node.type !== 'TEXT') {
    return issues;
  }
  
  const textNode = node as TextNode;
  const pageName = getPageName(node);
  const container = getTopContainer(node);
  const nodePath = getPath(node);
  
  // Get text color (from fills)
  if (!('fills' in textNode) || !textNode.fills || textNode.fills === figma.mixed) {
    return issues;
  }
  
  if (textNode.fills.length === 0) {
    return issues;
  }
  
  const textPaint = textNode.fills[0];
  if (textPaint.type !== 'SOLID' || !textPaint.visible) {
    return issues;
  }
  
  const textColor = textPaint.color;
  const textOpacity = (textPaint.opacity !== undefined ? textPaint.opacity : 1) * (textNode.opacity !== undefined ? textNode.opacity : 1);
  
  // Get background color (from parent frame or page)
  let bgColor: RGB | null = null;
  let current: BaseNode | null = textNode.parent;
  
  while (current) {
    if (current.type === 'FRAME' && 'backgrounds' in current) {
      const frame = current as FrameNode;
      if (frame.backgrounds && frame.backgrounds.length > 0) {
        const bgPaint = frame.backgrounds[0];
        if (bgPaint.type === 'SOLID' && bgPaint.visible) {
          bgColor = bgPaint.color;
          break;
        }
      }
    }
    if (current.type === 'PAGE') {
      // Default to white for page background
      bgColor = { r: 1, g: 1, b: 1 };
      break;
    }
    current = current.parent;
  }
  
  if (!bgColor) {
    return issues;
  }
  
  // Apply opacity to text color
  const effectiveTextColor: RGB = {
    r: bgColor.r + (textColor.r - bgColor.r) * textOpacity,
    g: bgColor.g + (textColor.g - bgColor.g) * textOpacity,
    b: bgColor.b + (textColor.b - bgColor.b) * textOpacity,
  };
  
  const contrastRatio = getContrastRatio(effectiveTextColor, bgColor);
  
  // Check font size to determine required contrast
  const fontSize = typeof textNode.fontSize === 'number' ? textNode.fontSize : 14;
  const fontWeight = typeof textNode.fontWeight === 'number' ? textNode.fontWeight : 400;
  const isLargeText = fontSize >= 18 || (fontSize >= 14 && fontWeight >= 700);
  const requiredRatio = isLargeText ? 3.0 : 4.5; // WCAG AA standard
  
  if (contrastRatio < requiredRatio) {
    const ratio = contrastRatio.toFixed(2);
    const required = requiredRatio.toFixed(1);
    issues.push({
      id: `${node.id}-contrast`,
      nodeId: node.id,
      nodeType: node.type,
      pageName,
      containerName: container.name,
      severity: 'error',
      type: 'low-contrast',
      message: `Низкий контраст текста: ${ratio}:1 (требуется ${required}:1 для WCAG AA)`,
      path: nodePath,
    });
  }

  return issues;
}

// ============================================================================
// Text Style Check
// ============================================================================

function lintTextStyles(node: SceneNode): Issue[] {
  const issues: Issue[] = [];
  
  // Only check text nodes
  if (node.type !== 'TEXT') {
    return issues;
  }
  
  const textNode = node as TextNode;
  const pageName = getPageName(node);
  const container = getTopContainer(node);
  const nodePath = getPath(node);
  
  // Check if text has a text style
  if ('textStyleId' in textNode) {
    const textStyleId = textNode.textStyleId;
    if (!textStyleId || typeof textStyleId !== 'string') {
      issues.push({
        id: `${node.id}-text-style`,
        nodeId: node.id,
        nodeType: node.type,
        pageName,
        containerName: container.name,
        severity: 'error',
        type: 'text-without-style',
        message: 'Текст не использует Text Style',
        path: nodePath,
      });
    }
  }
  
  return issues;
}

// ============================================================================
// Effect Style Check
// ============================================================================

function lintEffects(node: SceneNode): Issue[] {
  const issues: Issue[] = [];
  const pageName = getPageName(node);
  const container = getTopContainer(node);
  const nodePath = getPath(node);
  
  // Check if node has effects
  if (!('effects' in node)) {
    return issues;
  }
  
  const effects = node.effects;
  if (!effects || effects.length === 0) {
    return issues;
  }
  
  // Check if node has effectStyleId (applies to all effects)
  let hasEffectStyle = false;
  if ('effectStyleId' in node) {
    const effectStyleId = node.effectStyleId;
    if (effectStyleId && typeof effectStyleId === 'string') {
      hasEffectStyle = true;
    }
  }
  
  // If no effect style is applied, check each effect
  if (!hasEffectStyle) {
    // Filter visible effects (skip invisible ones)
    const visibleEffects = effects.filter(effect => effect.visible !== false);
    
    if (visibleEffects.length > 0) {
      const effectTypes = visibleEffects.map(e => e.type).join(', ');
      issues.push({
        id: `${node.id}-effects`,
        nodeId: node.id,
        nodeType: node.type,
        pageName,
        containerName: container.name,
        severity: 'error',
        type: 'effects-without-style',
        message: `Эффекты (${effectTypes}) не используют Effect Style`,
        path: nodePath,
      });
    }
  }
  
  return issues;
}

// ============================================================================
// Plugin Initialization
// ============================================================================

const linter = new Linter();

// Add color linting rule
linter.addRule({
  name: 'color-style-variable-check',
  lint: lintColors,
});

// Add accessibility linting rule
linter.addRule({
  name: 'accessibility-contrast-check',
  lint: lintAccessibility,
});

// Add text style linting rule
linter.addRule({
  name: 'text-style-check',
  lint: lintTextStyles,
});

// Add effect style linting rule
linter.addRule({
  name: 'effect-style-check',
  lint: lintEffects,
});

// ============================================================================
// UI Communication
// ============================================================================

console.log('Initializing plugin...');

// Load UI - when "ui" is specified in manifest.json, Figma loads it automatically
// We need to use the HTML content directly
const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Design Linter</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; color: #333; background: #fff; padding: 12px; overflow-x: hidden; overflow-y: auto; }
    .header { margin-bottom: 12px; }
    .controls { display: flex; gap: 8px; margin-bottom: 12px; }
    .filter-btn { display: flex; align-items: center; justify-content: center; padding: 8px; min-width: 40px; }
    .filter-btn svg { width: 18px; height: 18px; fill: currentColor; }
    .filter-btn.active { background: #18a0fb; color: #fff; }
    .filter-btn.active:hover { background: #1590e6; }
    #filters-container { display: none; }
    #filters-container.visible { display: block; }
    select { flex: 1; padding: 8px; border: 1px solid #e0e0e0; border-radius: 4px; font-size: 12px; background: #fff; appearance: none; -webkit-appearance: none; -moz-appearance: none; background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e"); background-repeat: no-repeat; background-position: right 8px center; background-size: 16px; padding-right: 32px; }
    button { padding: 8px 16px; border: none; border-radius: 4px; font-size: 12px; font-weight: 500; cursor: pointer; transition: background 0.2s; }
    button.primary { background: #18a0fb; color: #fff; }
    button.primary:hover { background: #1590e6; }
    button.secondary { background: #f0f0f0; color: #333; margin-left: 0; }
    button.secondary:hover { background: #e0e0e0; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .stats { display: flex; gap: 16px; padding: 12px; background: #f8f8f8; border-radius: 4px; margin-bottom: 12px; font-size: 11px; }
    .stat { display: flex; flex-direction: column; }
    .stat-label { color: #666; margin-bottom: 4px; }
    .stat-value { font-weight: 600; font-size: 14px; }
    .stat-value.error { color: #e53935; }
    .stat-value.warn { color: #ff9800; }
    .results { overflow: visible; }
    .results-empty { text-align: center; padding: 32px; color: #999; }
    .issue-group { margin-bottom: 12px; }
    .group-header { font-weight: 600; font-size: 11px; color: #666; text-transform: uppercase; margin-bottom: 8px; padding: 4px 0; border-bottom: 1px solid #e0e0e0; }
    .issue { padding: 8px; margin-bottom: 6px; border-radius: 0; cursor: pointer; transition: background 0.2s; border-left: 3px solid transparent; word-wrap: break-word; overflow-wrap: break-word; }
    .issue:hover { background: #f5f5f5; }
    .issue.error { border-left-color: #e53935; }
    .issue.warn { border-left-color: #ff9800; }
    .issue-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
    .issue-severity { font-size: 10px; font-weight: 600; text-transform: uppercase; padding: 2px 6px; border-radius: 3px; }
    .issue-severity.error { background: #ffebee; color: #e53935; }
    .issue-severity.warn { background: #fff3e0; color: #ff9800; }
    .issue-type { font-size: 10px; color: #999; }
    .issue-message { font-size: 11px; color: #333; margin-bottom: 2px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; line-height: 1.4; }
    .issue-path { font-size: 10px; color: #999; font-family: 'Monaco', 'Courier New', monospace; word-wrap: break-word; overflow-wrap: break-word; max-width: 100%; }
    .loading { text-align: center; padding: 32px; color: #999; }
    .checkboxes { margin-bottom: 12px; padding: 12px; background: #f8f8f8; border-radius: 4px; }
    .checkboxes-label { font-size: 11px; font-weight: 600; color: #666; margin-bottom: 8px; display: block; }
    .checkbox-group { display: flex; flex-direction: column; gap: 6px; }
    .checkbox-item { display: flex; align-items: center; gap: 6px; }
    .checkbox-item input[type="checkbox"] { width: 14px; height: 14px; cursor: pointer; }
    .checkbox-item label { font-size: 12px; color: #333; cursor: pointer; user-select: none; }

    details.panel { margin-bottom: 12px; padding: 12px; background: #f8f8f8; border-radius: 4px; }
    details.panel > summary { list-style: none; cursor: pointer; font-size: 11px; font-weight: 600; color: #666; user-select: none; }
    details.panel > summary::-webkit-details-marker { display: none; }
    details.panel > summary::after { content: '▾'; float: right; color: #999; font-size: 14px; line-height: 1; }
    details.panel:not([open]) > summary::after { content: '▸'; }
    details.panel > .panel-body { margin-top: 8px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="controls">
      <select id="scope-select">
        <option value="selection">Выбранные элементы</option>
        <option value="currentPage" selected>Текущая страница</option>
      </select>
      <button id="filter-toggle-btn" class="filter-btn secondary" title="Фильтры">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
          <path d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z"/>
        </svg>
      </button>
      <button id="run-btn" class="primary">Поиск</button>
    </div>
    <div id="filters-container">
    <details class="panel">
      <summary>Фильтр по элементам</summary>
      <div class="panel-body">
        <div class="checkbox-group">
          <div class="checkbox-item">
            <input type="checkbox" id="filter-components" checked>
            <label for="filter-components">Компоненты</label>
          </div>
          <div class="checkbox-item">
            <input type="checkbox" id="filter-instances" checked>
            <label for="filter-instances">Инстансы</label>
          </div>
          <div class="checkbox-item">
            <input type="checkbox" id="filter-text" checked>
            <label for="filter-text">Текст</label>
          </div>
          <div class="checkbox-item">
            <input type="checkbox" id="filter-containers" checked>
            <label for="filter-containers">Контейнеры</label>
          </div>
          <div class="checkbox-item">
            <input type="checkbox" id="filter-shapes" checked>
            <label for="filter-shapes">Фигуры</label>
          </div>
        </div>
      </div>
    </details>
    <details class="panel" open>
      <summary>Типы проверок</summary>
      <div class="panel-body">
        <div class="checkbox-group">
          <div class="checkbox-item">
            <input type="checkbox" id="check-colors" checked>
            <label for="check-colors">Цвета (без Style/Variable)</label>
          </div>
          <div class="checkbox-item">
            <input type="checkbox" id="check-accessibility" checked>
            <label for="check-accessibility">Доступность (контраст)</label>
          </div>
          <div class="checkbox-item">
            <input type="checkbox" id="check-unused-styles" checked>
            <label for="check-unused-styles">Неиспользуемые стили</label>
          </div>
          <div class="checkbox-item">
            <input type="checkbox" id="check-text-styles" checked>
            <label for="check-text-styles">Текстовые стили</label>
          </div>
          <div class="checkbox-item">
            <input type="checkbox" id="check-effects" checked>
            <label for="check-effects">Эффекты (тени, размытие)</label>
          </div>
        </div>
      </div>
    </details>
    </div>
  </div>
  <div id="stats" class="stats" style="display: none;">
    <div class="stat"><div class="stat-label">Всего проблем</div><div class="stat-value" id="total-count">0</div></div>
    <div class="stat"><div class="stat-label">Ошибки</div><div class="stat-value error" id="error-count">0</div></div>
    <div class="stat"><div class="stat-label">Предупреждения</div><div class="stat-value warn" id="warn-count">0</div></div>
  </div>
  <div id="results" class="results"></div>
  <script>
    (function() {
      console.log('UI script loaded');
      let currentResult = null;
      let allIssues = [];
      let scopeSelect, runBtn, statsDiv, totalCount, errorCount, warnCount, resultsDiv;
      let filterToggleBtn, filtersContainer;
      let filtersDiv, filterType, filterSeverity, filterContainer;
      let filterComponents, filterInstances, filterText, filterContainers, filterShapes;
      
      function initializeUI() {
        console.log('Initializing UI...');
        scopeSelect = document.getElementById('scope-select');
        runBtn = document.getElementById('run-btn');
        filterToggleBtn = document.getElementById('filter-toggle-btn');
        filtersContainer = document.getElementById('filters-container');
        statsDiv = document.getElementById('stats');
        totalCount = document.getElementById('total-count');
        errorCount = document.getElementById('error-count');
        warnCount = document.getElementById('warn-count');
        resultsDiv = document.getElementById('results');
        filtersDiv = document.getElementById('filters');
        filterType = document.getElementById('filter-type');
        filterSeverity = document.getElementById('filter-severity');
        filterContainer = document.getElementById('filter-container');
        filterComponents = document.getElementById('filter-components');
        filterInstances = document.getElementById('filter-instances');
        filterText = document.getElementById('filter-text');
        filterContainers = document.getElementById('filter-containers');
        filterShapes = document.getElementById('filter-shapes');
        
        // Required elements
        if (!scopeSelect || !runBtn || !statsDiv || !totalCount || !errorCount || !warnCount || !resultsDiv) {
          console.error('Failed to find required DOM elements');
          console.error('Elements found:', {
            scopeSelect: !!scopeSelect,
            runBtn: !!runBtn,
            statsDiv: !!statsDiv,
            totalCount: !!totalCount,
            errorCount: !!errorCount,
            warnCount: !!warnCount,
            resultsDiv: !!resultsDiv
          });
          return;
        }
        
        // Filter elements are optional
        if (filtersDiv && filterType && filterSeverity && filterContainer) {
          // Set up filter handlers - functions will be defined later
          filterType.addEventListener('change', handleFilterChange);
          filterSeverity.addEventListener('change', handleFilterChange);
          filterContainer.addEventListener('change', handleFilterChange);
        }

        // Node type filter elements
        const nodeFilterEls = [filterComponents, filterInstances, filterText, filterContainers, filterShapes].filter(Boolean);
        nodeFilterEls.forEach((el) => {
          el.addEventListener('change', () => {
            if (allIssues && allIssues.length > 0) {
              renderFiltered();
            }
          });
        });
        
        console.log('UI initialized successfully');
        
        // Filter toggle button
        if (filterToggleBtn && filtersContainer) {
          filterToggleBtn.addEventListener('click', () => {
            const isVisible = filtersContainer.classList.toggle('visible');
            if (isVisible) {
              filterToggleBtn.classList.add('active');
            } else {
              filterToggleBtn.classList.remove('active');
            }
          });
        }
        
        runBtn.addEventListener('click', () => {
          const scope = scopeSelect.value;
          runLint(scope);
        });
        
        function handleFilterChange() {
          if (allIssues && allIssues.length > 0 && typeof applyFilters === 'function') {
            applyFilters();
          }
        }
      }
      
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeUI);
      } else {
        initializeUI();
      }
      
      window.onmessage = (event) => {
        console.log('UI window.onmessage called, event:', event);
        const msg = event.data?.pluginMessage;
        console.log('UI received message:', msg);
        if (!msg) {
          console.warn('No pluginMessage in event.data');
          return;
        }
        if (msg.type === 'lint-result') {
          console.log('Calling displayResults with:', msg.result);
          displayResults(msg.result);
        } else if (msg.type === 'lint-error') {
          console.log('Calling displayError with:', msg.error);
          displayError(msg.error);
        } else {
          console.warn('Unknown message type:', msg.type, msg);
        }
      };
      
      function runLint(scope) {
        console.log('runLint called with scope:', scope);
        if (!runBtn || !resultsDiv || !statsDiv) {
          console.error('UI elements not initialized');
          return;
        }
        
        // Get selected check types
        const checkColors = document.getElementById('check-colors')?.checked ?? true;
        const checkAccessibility = document.getElementById('check-accessibility')?.checked ?? true;
        const checkUnusedStyles = document.getElementById('check-unused-styles')?.checked ?? true;
        const checkTextStyles = document.getElementById('check-text-styles')?.checked ?? true;
        const checkEffects = document.getElementById('check-effects')?.checked ?? true;
        
        const checkTypes = {
          colors: checkColors,
          accessibility: checkAccessibility,
          unusedStyles: checkUnusedStyles,
          textStyles: checkTextStyles,
          effects: checkEffects
        };
        
        runBtn.disabled = true;
        runBtn.textContent = 'Выполняется...';
        resultsDiv.innerHTML = '<div class="loading">Сканирование дизайна...</div>';
        statsDiv.style.display = 'none';
        if (filtersDiv) filtersDiv.style.display = 'none';
        
        const message = { pluginMessage: { type: 'run-lint', scope, checkTypes } };
        console.log('Sending message to plugin:', message);
        try {
          parent.postMessage(message, '*');
        } catch (error) {
          console.error('Error sending message:', error);
          runBtn.disabled = false;
          runBtn.textContent = 'Поиск';
          resultsDiv.innerHTML = '<div class="results-empty" style="color: #e53935;">Ошибка отправки сообщения</div>';
        }
      }
      
      function displayResults(result) {
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

      function updateStats(issues) {
        if (!totalCount || !errorCount || !warnCount) return;
        const total = issues ? issues.length : 0;
        const errors = issues ? issues.filter(i => i.severity === 'error').length : 0;
        const warnings = issues ? issues.filter(i => i.severity === 'warn').length : 0;
        totalCount.textContent = total.toString();
        errorCount.textContent = errors.toString();
        warnCount.textContent = warnings.toString();
      }

      function getNodeCategory(nodeType) {
        if (!nodeType) return null;
        if (nodeType === 'COMPONENT' || nodeType === 'COMPONENT_SET') return 'components';
        if (nodeType === 'INSTANCE') return 'instances';
        if (nodeType === 'TEXT' || nodeType === 'TEXT_PATH') return 'text';
        if (nodeType === 'FRAME' || nodeType === 'SECTION' || nodeType === 'GROUP' || nodeType === 'TRANSFORM_GROUP') return 'containers';
        const shapes = new Set(['RECTANGLE','ELLIPSE','POLYGON','STAR','LINE','VECTOR','BOOLEAN_OPERATION','SHAPE_WITH_TEXT','CONNECTOR']);
        if (shapes.has(nodeType)) return 'shapes';
        return null;
      }

      function passesNodeFilters(issue) {
        // Issues without node context (e.g. unused styles) are always shown
        if (!issue || !issue.nodeId) return true;

        const category = getNodeCategory(issue.nodeType);
        if (!category) return true;

        const enabled = {
          components: filterComponents?.checked ?? true,
          instances: filterInstances?.checked ?? true,
          text: filterText?.checked ?? true,
          containers: filterContainers?.checked ?? true,
          shapes: filterShapes?.checked ?? true
        };

        return enabled[category] === true;
      }

      function getIssueGroup(issue) {
        if (!issue) return 'other';
        if (issue.type === 'low-contrast' || issue.type === 'text-without-style') return 'text';
        if (issue.type === 'unused-style') return 'styles';
        if (issue.type === 'effects-without-style') return 'effects';
        if (issue.paintContext && issue.paintContext.property === 'fills') return 'fill';
        if (issue.paintContext && issue.paintContext.property === 'strokes') return 'stroke';
        if (issue.paintContext && issue.paintContext.property === 'backgrounds') return 'background';
        return 'other';
      }

      function groupIssuesByType(issues) {
        const grouped = {};
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
        const groupLabels = {
          fill: 'Fill',
          stroke: 'Stroke',
          background: 'Background',
          text: 'Text',
          effects: 'Effects',
          styles: 'Styles',
          other: 'Other'
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
      
      function groupIssues(issues) {
        const grouped = {};
        for (const issue of issues) {
          if (!grouped[issue.pageName]) grouped[issue.pageName] = {};
          if (!grouped[issue.pageName][issue.containerName]) grouped[issue.pageName][issue.containerName] = [];
          grouped[issue.pageName][issue.containerName].push(issue);
        }
        return grouped;
      }
      
      function renderIssue(issue) {
        const severityText = issue.severity === 'error' ? 'ошибка' : 'предупреждение';
        const typeTextMap = {
          'color-without-style-or-variable': 'цвет без Style/Variable',
          'mixed-paints': 'смешанные значения',
          'low-contrast': 'низкий контраст',
          'unused-style': 'неиспользуемый стиль',
          'text-without-style': 'текст без стиля',
          'effects-without-style': 'эффекты без стиля'
        };
        const typeText = typeTextMap[issue.type] || issue.type;
        const nodeIdAttr = issue.nodeId ? 'data-node-id="' + issue.nodeId + '"' : '';
        return '<div class="issue ' + issue.severity + '" ' + nodeIdAttr + '><div class="issue-header"><span class="issue-severity ' + issue.severity + '">' + severityText + '</span><span class="issue-type">' + escapeHtml(typeText) + '</span></div><div class="issue-message">' + escapeHtml(issue.message) + '</div><div class="issue-path">' + escapeHtml(issue.path) + '</div></div>';
      }
      
      function selectNode(nodeId) {
        parent.postMessage({ pluginMessage: { type: 'select-node', nodeId } }, '*');
      }
      
      function displayError(error) {
        if (!runBtn || !resultsDiv) {
          console.error('UI elements not initialized');
          return;
        }
        runBtn.disabled = false;
        runBtn.textContent = 'Поиск';
        resultsDiv.innerHTML = '<div class="results-empty" style="color: #e53935;">Ошибка: ' + escapeHtml(error) + '</div>';
      }
      
      
      function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      }
    })();
  </script>
</body>
</html>`;

figma.showUI(htmlContent, {
  width: 400,
  height: 600,
  title: 'Проверка дизайна',
});

console.log('UI shown, setting up message handler...');

figma.ui.onmessage = async (msg: any) => {
  console.log('Plugin received message:', msg);
  
  if (!msg || !msg.type) {
    console.error('Invalid message format:', msg);
    return;
  }
  
  if (msg.type === 'run-lint') {
    const scope: Scope = msg.scope || 'currentPage';
    const checkTypes = msg.checkTypes || { colors: true, accessibility: true, unusedStyles: true, textStyles: true, effects: true };
    console.log('Running lint with scope:', scope, 'checkTypes:', checkTypes);

    try {
      const nodes = collectNodes(scope);
      console.log('Collected nodes:', nodes.length);
      
      if (nodes.length === 0) {
        console.log('No nodes found to lint');
        figma.ui.postMessage({
          type: 'lint-result',
          result: {
            issues: [],
            totalIssues: 0,
            errors: 0,
            warnings: 0,
          },
        });
        return;
      }
      
      const allIssues: Issue[] = [];
      
      // Determine which rules to enable
      const enabledRuleNames: string[] = [];
      if (checkTypes.colors) {
        enabledRuleNames.push('color-style-variable-check');
      }
      if (checkTypes.accessibility) {
        enabledRuleNames.push('accessibility-contrast-check');
      }
      if (checkTypes.textStyles) {
        enabledRuleNames.push('text-style-check');
      }
      if (checkTypes.effects) {
        enabledRuleNames.push('effect-style-check');
      }
      
      // Run node-based linting rules
      if (enabledRuleNames.length > 0) {
        const issues = linter.lint(nodes, enabledRuleNames);
        allIssues.push(...issues);
        console.log('Found issues:', issues.length);
      }
      
      // Check for unused styles (needs all nodes) - only if enabled
      if (checkTypes.unusedStyles) {
        const unusedStyleIssues = lintUnusedStyles(nodes);
        allIssues.push(...unusedStyleIssues);
        console.log('Found unused styles:', unusedStyleIssues.length);
      }

      // Calculate statistics
      const errors = allIssues.filter((i) => i.severity === 'error').length;
      const warnings = allIssues.filter((i) => i.severity === 'warn').length;

      const result: LintResult = {
        issues: allIssues,
        totalIssues: allIssues.length,
        errors,
        warnings,
      };

      console.log('Sending result:', result);
      figma.ui.postMessage({
        type: 'lint-result',
        result,
      });
    } catch (error) {
      console.error('Lint error:', error);
      figma.ui.postMessage({
        type: 'lint-error',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  } else if (msg.type === 'select-node') {
    const nodeId = msg.nodeId;
    const node = figma.getNodeById(nodeId);

    if (node && 'visible' in node) {
      figma.currentPage.selection = [node as SceneNode];
      figma.viewport.scrollAndZoomIntoView([node as SceneNode]);
    }
  } else if (msg.type === 'close') {
    figma.closePlugin();
  }
};
