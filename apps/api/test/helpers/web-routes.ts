import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const webApp = join(__dirname, '..', '..', '..', 'web', 'src', 'app', '(app)');

/** Does a route like /m/poultry/flocks resolve to a web page, allowing [dynamic] segments? */
export function routeExists(href: string): boolean {
  const walk = (dir: string, parts: string[]): boolean => {
    if (parts.length === 0) return existsSync(join(dir, 'page.tsx'));
    if (!existsSync(dir)) return false;
    const [head, ...rest] = parts;
    const children = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    return children.some((c) => (c === head || (c.startsWith('[') && c.endsWith(']'))) && walk(join(dir, c), rest));
  };
  return walk(webApp, href.split('?')[0]!.split('/').filter(Boolean));
}
