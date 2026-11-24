/**
 * Regenerates `src/ui/tokenCss.ts` from `src/ui/tokens.css`.
 *
 * The tokens live in CSS for readability, but shadow roots need them as a
 * string so they can be adopted synchronously before first paint. Run via
 * `npm run tokens` after editing the CSS.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const cssPath = path.join(root, 'src/ui/tokens.css');
const outPath = path.join(root, 'src/ui/tokenCss.ts');

const css = fs.readFileSync(cssPath, 'utf8');
const out = `/** Shared design tokens, injected into every shadow root (generated from tokens.css). */\nexport const TOKEN_CSS = ${JSON.stringify(css)};\n`;
fs.writeFileSync(outPath, out);
console.log(`tokenCss.ts regenerated from tokens.css (${css.length} chars)`);
