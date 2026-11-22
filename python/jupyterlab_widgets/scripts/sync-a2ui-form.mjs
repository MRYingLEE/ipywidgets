// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

// Copy the built @a2ui/form package into vendor/a2ui-form.
// Usage: node scripts/sync-a2ui-form.mjs [path/to/a2ui-form/typescript/renderers/form]
// Build it first with `corepack yarn workspace @a2ui/form build` in the a2ui repo.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(
  process.argv[2] ??
    process.env.A2UI_FORM_DIR ??
    join(root, '../../../a2ui-form/typescript/renderers/form')
);
const dist = join(source, 'dist');
for (const file of ['form.js', 'kernel.js', 'types/index.d.ts']) {
  if (!existsSync(join(dist, file))) {
    throw new Error(`Missing ${join(dist, file)}; build @a2ui/form first`);
  }
}

const target = join(root, 'vendor/a2ui-form');
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(join(dist, 'form.js'), join(target, 'form.js'));
cpSync(join(dist, 'kernel.js'), join(target, 'kernel.js'));
cpSync(join(dist, 'types'), join(target, 'types'), { recursive: true });
writeFileSync(join(target, 'form.d.ts'), "export * from './types/index.js';\n");
writeFileSync(
  join(target, 'kernel.d.ts'),
  "export * from './types/kernel.js';\n"
);
const license = join(source, '../../../LICENSE');
if (existsSync(license)) {
  cpSync(license, join(target, 'LICENSE'));
}

let commit = 'unknown';
try {
  commit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: source,
    encoding: 'utf8',
  }).trim();
} catch {
  // Not a git checkout.
}
writeFileSync(
  join(target, 'README.md'),
  `# Vendored @a2ui/form

Built from the a2ui repository (\`typescript/renderers/form\`, commit
\`${commit}\`) by \`scripts/sync-a2ui-form.mjs\`. Do not edit by hand.

- \`kernel.js\`: the A2UI stdin protocol codec, imported statically.
- \`form.js\`: the form renderer with React and A2UI bundled, imported lazily.
`
);
console.log(`Vendored @a2ui/form from ${source}`);
