import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

/**
 * Finds database queries over company-owned tables that do not say which
 * company they are for.
 *
 * Every tenant's data sits in the same tables, told apart by `companyId`. A
 * query that lists, counts or finds by anything other than a unique id
 * without naming a company reads across every farm at once. That is how
 * approval notifications went to another farm's staff until 2026-09-25: the
 * role-holder lookup had no `companyId`, and nothing checked.
 *
 * Deliberately a source scan rather than a runtime hook: it sees every query
 * in the codebase, including the ones no test happens to exercise.
 */

export interface Finding {
  file: string;
  line: number;
  model: string;
  operation: string;
  /** Stable across unrelated edits: file, model, operation and the where-clause text. */
  key: string;
}

/** Operations that read or change many rows, or find one by something other than its id. */
const SCOPED_OPERATIONS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
]);

/** Prisma client accessor names of every model that carries a companyId. */
export function companyScopedModels(schemaPath: string): Set<string> {
  const schema = readFileSync(schemaPath, 'utf8').replace(/\r\n/g, '\n');
  const models = new Set<string>();
  const pattern = /^model (\w+) \{\n([\s\S]*?)^\}/gm;
  for (const match of schema.matchAll(pattern)) {
    const [, name, body] = match;
    if (/^\s+companyId\s/m.test(body!)) models.add(name![0]!.toLowerCase() + name!.slice(1));
  }
  return models;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts') && !entry.endsWith('.d.ts')) out.push(path);
  }
  return out;
}

/** Whether a where-clause names a company, directly or through a relation. */
function namesCompany(where: ts.Expression): boolean {
  return /\bcompanyId\b|\bcompany:\s*\{/.test(where.getText());
}

export function scan(srcDir: string, models: Set<string>): Finding[] {
  const findings: Finding[] = [];
  for (const path of sourceFiles(srcDir)) {
    const text = readFileSync(path, 'utf8');
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.ES2022, true);
    const file = relative(srcDir, path).replace(/\\/g, '/');

    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const operation = node.expression.name.text;
        const target = node.expression.expression;
        if (SCOPED_OPERATIONS.has(operation) && ts.isPropertyAccessExpression(target) && models.has(target.name.text)) {
          const model = target.name.text;
          const arg = node.arguments[0];
          let where: ts.Expression | undefined;
          let whereText = '<no where>';
          if (arg && ts.isObjectLiteralExpression(arg)) {
            const prop = arg.properties.find(
              (p): p is ts.PropertyAssignment | ts.ShorthandPropertyAssignment =>
                (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name.getText() === 'where',
            );
            if (prop && ts.isPropertyAssignment(prop)) where = prop.initializer;
            else if (prop) where = prop.name;
          } else if (arg) {
            whereText = '<built elsewhere>';
          }
          if (where) whereText = where.getText().replace(/\s+/g, ' ');
          if (!where || !namesCompany(where)) {
            const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
            findings.push({ file, line, model, operation, key: `${file} ${model}.${operation} ${whereText}` });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return findings;
}
