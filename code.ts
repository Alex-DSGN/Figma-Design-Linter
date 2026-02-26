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

type ContrastLevel = 'aa' | 'aaa';

interface AccessibilityOptions {
  contrastLevel: ContrastLevel;
  warnTransparent: boolean;
}

let accessibilityOptions: AccessibilityOptions = {
  contrastLevel: 'aa',
  warnTransparent: true,
};

let issueCounter = 0;
function makeIssueId(base: string): string {
  issueCounter += 1;
  return `${base}-${issueCounter}`;
}

const CLIENT_STORAGE_KEY = 'design-linter-settings';

type StoredSettings = {
  scope?: Scope;
  checks?: Record<string, any>;
  contrastLevel?: ContrastLevel;
  warnTransparent?: boolean;
  nodeFilters?: Record<string, boolean>;
};

const defaultSettings: StoredSettings = {
  scope: 'currentPage',
  checks: {
    colors: true,
    accessibility: true,
    unusedStyles: true,
    unusedTextStyles: true,
    unusedEffectStyles: true,
    textStyles: true,
    effects: true,
  },
  contrastLevel: 'aa',
  warnTransparent: true,
  nodeFilters: {
    components: true,
    instances: true,
    text: true,
    containers: true,
    shapes: true,
  },
};

async function loadSettings(): Promise<StoredSettings> {
  try {
    const stored = await figma.clientStorage.getAsync(CLIENT_STORAGE_KEY);
    return { ...defaultSettings, ...(stored || {}) };
  } catch (error) {
    console.error('Failed to load settings', error);
    return defaultSettings;
  }
}

async function saveSettings(settings: StoredSettings): Promise<void> {
  try {
    await figma.clientStorage.setAsync(CLIENT_STORAGE_KEY, settings);
  } catch (error) {
    console.error('Failed to save settings', error);
  }
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

type RGBAColor = { r: number; g: number; b: number; a: number };

const WHITE: RGBAColor = { r: 1, g: 1, b: 1, a: 1 };

function composite(top: RGBAColor, bottom: RGBAColor): RGBAColor {
  const a = top.a + bottom.a * (1 - top.a);
  if (a === 0) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  return {
    r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / a,
    g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / a,
    b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / a,
    a,
  };
}

function rgbaToOpaque(color: RGBAColor, backdrop: RGBAColor = WHITE): RGB {
  const out = composite(color, backdrop);
  return { r: out.r, g: out.g, b: out.b };
}

function paintToColor(paint: Paint): RGBAColor | null {
  if (paint.type === 'SOLID') {
    const opacity = paint.opacity !== undefined ? paint.opacity : 1;
    return { r: paint.color.r, g: paint.color.g, b: paint.color.b, a: opacity };
  }
  if (paint.type.startsWith('GRADIENT') && 'gradientStops' in paint && paint.gradientStops.length > 0) {
    // Approximate gradient by the first stop
    const stop = paint.gradientStops[0];
    const opacity = paint.opacity !== undefined ? paint.opacity : 1;
    return { r: stop.color.r, g: stop.color.g, b: stop.color.b, a: (stop.color.a ?? 1) * opacity };
  }
  return null;
}

function compositePaints(
  paints: readonly Paint[] | typeof figma.mixed,
  base: RGBAColor
): RGBAColor | null {
  if (!paints || paints === figma.mixed || paints.length === 0) {
    return null;
  }

  let result = base;
  for (const paint of paints) {
    if (paint.visible === false) continue;
    const color = paintToColor(paint);
    if (!color) continue;
    result = composite(color, result);
  }
  return result;
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
        id: makeIssueId(`${node.id}-${property}-mixed`),
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
            id: makeIssueId(`${node.id}-${property}-${i}`),
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
          id: makeIssueId(`unused-style-${style.id}`),
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

function lintUnusedTextStyles(allNodes: SceneNode[]): Issue[] {
  const issues: Issue[] = [];
  const usedTextStyleIds = new Set<string>();

  for (const node of allNodes) {
    if ('textStyleId' in node) {
      const textStyleId = node.textStyleId;
      if (textStyleId && typeof textStyleId === 'string') {
        usedTextStyleIds.add(textStyleId);
      }
    }
  }

  try {
    const localTextStyles = figma.getLocalTextStyles();
    const pageName = allNodes.length > 0 ? getPageName(allNodes[0]) : 'Unknown';

    for (const style of localTextStyles) {
      if (!usedTextStyleIds.has(style.id)) {
        issues.push({
          id: makeIssueId(`unused-text-style-${style.id}`),
          nodeId: '',
          nodeType: undefined,
          pageName,
          containerName: 'Текстовые стили',
          severity: 'warn',
          type: 'unused-text-style',
          message: `Текстовый стиль "${style.name}" не используется`,
          path: `Text Style: ${style.name}`,
        });
      }
    }
  } catch (error) {
    console.error('Error checking unused text styles:', error);
  }

  return issues;
}

function lintUnusedEffectStyles(allNodes: SceneNode[]): Issue[] {
  const issues: Issue[] = [];
  const usedEffectStyleIds = new Set<string>();

  for (const node of allNodes) {
    if ('effectStyleId' in node) {
      const effectStyleId = node.effectStyleId;
      if (effectStyleId && typeof effectStyleId === 'string') {
        usedEffectStyleIds.add(effectStyleId);
      }
    }
  }

  try {
    const localEffectStyles = figma.getLocalEffectStyles();
    const pageName = allNodes.length > 0 ? getPageName(allNodes[0]) : 'Unknown';

    for (const style of localEffectStyles) {
      if (!usedEffectStyleIds.has(style.id)) {
        issues.push({
          id: makeIssueId(`unused-effect-style-${style.id}`),
          nodeId: '',
          nodeType: undefined,
          pageName,
          containerName: 'Эффекты',
          severity: 'warn',
          type: 'unused-effect-style',
          message: `Effect Style "${style.name}" не используется`,
          path: `Effect Style: ${style.name}`,
        });
      }
    }
  } catch (error) {
    console.error('Error checking unused effect styles:', error);
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

function getLetterSpacingPx(letterSpacing: any, fontSize: number): number {
  if (!letterSpacing) return 0;
  if (typeof letterSpacing === 'number') return letterSpacing;
  if ('unit' in letterSpacing && 'value' in letterSpacing) {
    if (letterSpacing.unit === 'PIXELS') return letterSpacing.value;
    if (letterSpacing.unit === 'PERCENT') return (letterSpacing.value / 100) * fontSize;
  }
  return 0;
}

function getLineHeightPx(lineHeight: any, fontSize: number): number | null {
  if (!lineHeight) return null;
  if (typeof lineHeight === 'number') return lineHeight;
  if ('unit' in lineHeight && 'value' in lineHeight) {
    if (lineHeight.unit === 'PIXELS') return lineHeight.value;
    if (lineHeight.unit === 'PERCENT') return (lineHeight.value / 100) * fontSize;
  }
  return null;
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
  
  const visibleTextPaints = textNode.fills.filter(
    (paint) => paint.visible !== false && paint.type !== 'IMAGE' && paint.type !== 'VIDEO'
  );
  if (visibleTextPaints.length === 0) {
    return issues;
  }

  const textComposite = compositePaints(visibleTextPaints, { r: 0, g: 0, b: 0, a: 0 });
  if (!textComposite) {
    return issues;
  }

  const textOpacityFactor = textNode.opacity !== undefined ? textNode.opacity : 1;
  const textColorRGBA: RGBAColor = { ...textComposite, a: textComposite.a * textOpacityFactor };
  
  // Get background color (from parent frame or page)
  let bgColor: RGBAColor | null = null;
  let current: BaseNode | null = textNode.parent;
  
  while (current) {
    if (current.type === 'FRAME' && 'backgrounds' in current) {
      const frame = current as FrameNode;
      const bgComposite = compositePaints(frame.backgrounds, WHITE);
      if (bgComposite) {
        bgColor = bgComposite;
        break;
      }
    }
    if (current.type === 'PAGE') {
      // Default to white for page background
      bgColor = WHITE;
      break;
    }
    current = current.parent;
  }
  
  if (!bgColor) {
    return issues;
  }
  
  const effectiveTextColor = rgbaToOpaque(textColorRGBA, bgColor);
  const effectiveBgColor = rgbaToOpaque(bgColor, WHITE);
  
  const contrastRatio = getContrastRatio(effectiveTextColor, effectiveBgColor);
  
  // Check font size to determine required contrast
  const fontSize = typeof textNode.fontSize === 'number' ? textNode.fontSize : 14;
  const fontWeight = typeof textNode.fontWeight === 'number' ? textNode.fontWeight : 400;
  const letterSpacingPx = getLetterSpacingPx((textNode as any).letterSpacing, fontSize);
  const lineHeightPx = getLineHeightPx((textNode as any).lineHeight, fontSize) ?? fontSize * 1.2;
  const effectiveSize = fontSize + Math.max(0, letterSpacingPx * 0.5) + Math.max(0, lineHeightPx - fontSize) * 0.05;
  const isLargeText = effectiveSize >= 18 || (effectiveSize >= 14 && fontWeight >= 700);

  const targetLevel = accessibilityOptions.contrastLevel || 'aa';
  const requiredRatio =
    targetLevel === 'aaa'
      ? isLargeText
        ? 4.5
        : 7.0
      : isLargeText
      ? 3.0
      : 4.5;
  
  if (contrastRatio < requiredRatio) {
    const ratio = contrastRatio.toFixed(2);
    const required = requiredRatio.toFixed(1);
    issues.push({
      id: makeIssueId(`${node.id}-contrast`),
      nodeId: node.id,
      nodeType: node.type,
      pageName,
      containerName: container.name,
      severity: 'error',
      type: 'low-contrast',
      message: `Низкий контраст текста: ${ratio}:1 (требуется ${required}:1 для WCAG ${targetLevel.toUpperCase()})`,
      path: nodePath,
    });
  }

  if (accessibilityOptions.warnTransparent && textColorRGBA.a < 1) {
    issues.push({
      id: makeIssueId(`${node.id}-transparent-text`),
      nodeId: node.id,
      nodeType: node.type,
      pageName,
      containerName: container.name,
      severity: 'warn',
      type: 'transparent-text',
      message: 'Текст частично прозрачный — проверьте контраст с учётом фона',
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
        id: makeIssueId(`${node.id}-text-style`),
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
        id: makeIssueId(`${node.id}-effects`),
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

figma.showUI(__html__, {
  width: 420,
  height: 620,
  title: 'Проверка дизайна',
});

console.log('UI shown, setting up message handler...');

figma.ui.onmessage = async (msg: any) => {
  console.log('Plugin received message:', msg);
  
  if (!msg || !msg.type) {
    console.error('Invalid message format:', msg);
    return;
  }
  
  if (msg.type === 'request-settings') {
    const settings = await loadSettings();
    figma.ui.postMessage({ type: 'settings', settings });
    return;
  }

  if (msg.type === 'save-settings') {
    await saveSettings(msg.settings || defaultSettings);
    return;
  }
  
  if (msg.type === 'run-lint') {
    const scope: Scope = msg.scope || 'currentPage';
    const checkTypes = {
      colors: true,
      accessibility: true,
      unusedStyles: true,
      unusedTextStyles: true,
      unusedEffectStyles: true,
      textStyles: true,
      effects: true,
      contrastLevel: 'aa' as ContrastLevel,
      warnTransparent: true,
      ...(msg.checkTypes || {}),
    };
    accessibilityOptions = {
      contrastLevel: checkTypes.contrastLevel === 'aaa' ? 'aaa' : 'aa',
      warnTransparent: checkTypes.warnTransparent !== false,
    };
    issueCounter = 0;
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
      if (checkTypes.unusedTextStyles) {
        const unusedText = lintUnusedTextStyles(nodes);
        allIssues.push(...unusedText);
        console.log('Found unused text styles:', unusedText.length);
      }
      if (checkTypes.unusedEffectStyles) {
        const unusedEffects = lintUnusedEffectStyles(nodes);
        allIssues.push(...unusedEffects);
        console.log('Found unused effect styles:', unusedEffects.length);
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
