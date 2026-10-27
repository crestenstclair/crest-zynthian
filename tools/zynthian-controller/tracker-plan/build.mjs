// SPDX-License-Identifier: GPL-2.0-or-later
// Produce one offline document; reuse the runtime's keyboard, SDL and gamepad input.
import {readFile, writeFile} from 'node:fs/promises';
const here = new URL('.', import.meta.url);
const read = path => readFile(new URL(path, here), 'utf8');
const [template, style, input, app] = await Promise.all([
  read('template.html'), read('style.css'), read('../controller-node/web/input.mjs'), read('app.js')
]);
const html = template.replace('/* PLAN_STYLE */', () => style)
  .replace('/* RUNTIME_INPUT */', () => input.replace(/^export /gm, ''))
  .replace('/* PLAN_APP */', () => app);
await writeFile(new URL('../../../docs/crest-tracker-zynthian-plan.html', here), html);
console.log('Built docs/crest-tracker-zynthian-plan.html');
