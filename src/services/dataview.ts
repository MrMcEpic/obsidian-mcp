import type { CacheService } from './cache.js';

// AST types
export type QueryNode =
  | { type: 'AND'; left: QueryNode; right: QueryNode }
  | { type: 'OR'; left: QueryNode; right: QueryNode }
  | ComparisonNode;

export interface ComparisonNode {
  field: string;
  op: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'contains' | 'startsWith' | 'endsWith' | 'exists' | 'notExists';
  value?: string | number | boolean;
}

export interface QueryResult {
  path: string;
  frontmatter: Record<string, unknown>;
}

export function parseQuery(input: string): QueryNode {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Query cannot be empty');

  return parseOr(trimmed);
}

function parseOr(input: string): QueryNode {
  const parts = splitAtKeyword(input, ' OR ');
  if (parts.length === 1) return parseAnd(parts[0] ?? '');
  let node: QueryNode = parseAnd(parts[0] ?? '');
  for (let i = 1; i < parts.length; i++) {
    node = { type: 'OR', left: node, right: parseAnd(parts[i] ?? '') };
  }
  return node;
}

function parseAnd(input: string): QueryNode {
  const parts = splitAtKeyword(input, ' AND ');
  if (parts.length === 1) return parseComparison((parts[0] ?? '').trim());
  let node: QueryNode = parseComparison((parts[0] ?? '').trim());
  for (let i = 1; i < parts.length; i++) {
    node = { type: 'AND', left: node, right: parseComparison((parts[i] ?? '').trim()) };
  }
  return node;
}

function splitAtKeyword(input: string, keyword: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';

  for (let i = 0; i < input.length; i++) {
    if (input[i] === '(') depth++;
    else if (input[i] === ')') depth--;

    if (depth === 0 && input.substring(i, i + keyword.length) === keyword) {
      parts.push(current);
      current = '';
      i += keyword.length - 1;
    } else {
      current += input[i];
    }
  }
  parts.push(current);
  return parts;
}

function parseComparison(input: string): QueryNode {
  const trimmed = input.trim();

  // Handle parenthesized expressions — recurse to parseOr to support AND/OR inside parens
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    return parseOr(trimmed.slice(1, -1));
  }

  // exists / notExists
  const existsMatch = trimmed.match(/^([\w.]+)\s+(exists|notExists)$/);
  if (existsMatch) {
    return { field: existsMatch[1] ?? '', op: (existsMatch[2] ?? '') as 'exists' | 'notExists' };
  }

  // Comparison operators
  const opPattern = /^([\w.]+)\s+(=|!=|>=|<=|>|<|contains|startsWith|endsWith)\s+(.+)$/;
  const match = trimmed.match(opPattern);
  if (!match) throw new Error(`Invalid query expression: "${trimmed}"`);

  const field = match[1] ?? '';
  const op = (match[2] ?? '') as ComparisonNode['op'];
  const rawValue = (match[3] ?? '').trim();

  // Parse value
  let value: string | number | boolean;
  if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
    value = rawValue.slice(1, -1);
  } else if (rawValue === 'true') {
    value = true;
  } else if (rawValue === 'false') {
    value = false;
  } else if (!isNaN(Number(rawValue))) {
    value = Number(rawValue);
  } else {
    value = rawValue; // dates, unquoted strings
  }

  return { field, op, value };
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === undefined || current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function evaluateNode(node: QueryNode, frontmatter: Record<string, unknown>): boolean {
  if ('type' in node && (node.type === 'AND' || node.type === 'OR')) {
    const left = evaluateNode(node.left, frontmatter);
    const right = evaluateNode(node.right, frontmatter);
    return node.type === 'AND' ? left && right : left || right;
  }

  const comp = node as ComparisonNode;
  const fieldValue = getNestedValue(frontmatter, comp.field);

  switch (comp.op) {
    case 'exists': return fieldValue !== undefined && fieldValue !== null;
    case 'notExists': return fieldValue === undefined || fieldValue === null;
    case '=': return String(fieldValue) === String(comp.value);
    case '!=': return String(fieldValue) !== String(comp.value);
    case '>': return (fieldValue as number) > (comp.value as number);
    case '<': return (fieldValue as number) < (comp.value as number);
    case '>=': return (fieldValue as number) >= (comp.value as number);
    case '<=': return (fieldValue as number) <= (comp.value as number);
    case 'contains':
      if (Array.isArray(fieldValue)) return fieldValue.includes(comp.value);
      if (typeof fieldValue === 'string') return fieldValue.includes(String(comp.value));
      return false;
    case 'startsWith':
      return typeof fieldValue === 'string' && fieldValue.startsWith(String(comp.value));
    case 'endsWith':
      return typeof fieldValue === 'string' && fieldValue.endsWith(String(comp.value));
    default: return false;
  }
}

export class DataviewService {
  constructor(private cache: CacheService) {}

  query(
    queryStr: string,
    options: { limit?: number; sortBy?: string; sortOrder?: 'asc' | 'desc' } = {},
  ): QueryResult[] {
    const { limit = 20, sortBy, sortOrder = 'asc' } = options;
    const ast = parseQuery(queryStr);
    const results: QueryResult[] = [];

    for (const [path, entry] of this.cache.getAllEntries()) {
      if (evaluateNode(ast, entry.frontmatter)) {
        results.push({ path, frontmatter: entry.frontmatter });
      }
    }

    if (sortBy) {
      results.sort((a, b) => {
        const aVal = getNestedValue(a.frontmatter, sortBy);
        const bVal = getNestedValue(b.frontmatter, sortBy);
        // Sort undefined/null values last
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;
        const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        return sortOrder === 'desc' ? -cmp : cmp;
      });
    }

    return results.slice(0, Math.min(limit, 100));
  }
}
