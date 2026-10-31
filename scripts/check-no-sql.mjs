// Fails if SQL statements appear in src/ outside the data layer.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = join(import.meta.dirname, '..', 'src');
const allowed = join(root, 'data') + sep;
const sqlPattern = /\b(SELECT\s+[\w*]|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE)\b/;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const offenders = walk(root)
  .filter((file) => file.endsWith('.ts') && !file.startsWith(allowed))
  .flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .map((line, i) => ({ file, line: i + 1, text: line }))
      .filter(({ text }) => sqlPattern.test(text)),
  );

if (offenders.length > 0) {
  for (const o of offenders) {
    console.error(`SQL outside data layer: ${relative(process.cwd(), o.file)}:${o.line}  ${o.text.trim()}`);
  }
  process.exit(1);
}
console.log('check-no-sql: OK (no SQL outside src/data)');
