#!/usr/bin/env node
// Raise CKEditor 5 above the version in Mautic's package-lock.json, then check the result.
//
//   node ckeditor.js raise <version>   before `npm install`, in the Mautic root
//   node ckeditor.js check <floor>     after `npm install` (whose postinstall builds the editor)
//
// raise: if Mautic's lock has ckeditor5 older than <version>, pin every CKEditor 5 package
//        that package.json lists to exactly <version>. CKEditor packages pin their siblings to
//        exact versions, so the transitive ones follow. A lock that is already at or above
//        <version> is left alone, so a newer Mautic release is never downgraded.
// check: every installed CKEditor 5 package is at one version, that version is at least
//        <floor>, and the bundle Mautic serves was built from it.
//
// "CKEditor 5 package" means ckeditor5 and @ckeditor/ckeditor5-*, except the build tooling
// @ckeditor/ckeditor5-dev-*, which has its own version line (56.x for 48.x).
'use strict';
const fs = require('fs');
const path = require('path');

const BUNDLE = 'docroot/media/libraries/ckeditor/ckeditor.js';
const isEditor = (name) =>
  name === 'ckeditor5' ||
  (name.startsWith('@ckeditor/ckeditor5-') && !name.startsWith('@ckeditor/ckeditor5-dev-'));
const parse = (v) => {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v || '');
  if (!m) fail(`not a plain x.y.z version: ${v}`);
  return m.slice(1).map(Number);
};
const cmp = (a, b) => {
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
function fail(msg) {
  console.error(`ckeditor: FAIL: ${msg}`);
  process.exit(1);
}

function raise(target) {
  parse(target);
  const locked = readJson('package-lock.json').packages?.['node_modules/ckeditor5']?.version;
  if (!locked) fail('package-lock.json has no node_modules/ckeditor5');
  if (cmp(locked, target) >= 0) {
    console.log(`ckeditor: Mautic locks ${locked}, at or above ${target}: left alone`);
    return;
  }
  const pkg = readJson('package.json');
  let n = 0;
  for (const field of ['dependencies', 'devDependencies']) {
    for (const name of Object.keys(pkg[field] || {})) {
      if (isEditor(name)) {
        pkg[field][name] = target;
        n++;
      }
    }
  }
  if (n === 0) fail('package.json lists no CKEditor 5 package');
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  console.log(`ckeditor: Mautic locks ${locked}; pinned ${n} packages to ${target}`);
}

function check(floor) {
  parse(floor);
  const found = new Map(); // version -> installed paths
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const scoped = entry.name.startsWith('@');
      const names = scoped
        ? fs.readdirSync(path.join(dir, entry.name)).map((s) => `${entry.name}/${s}`)
        : [entry.name];
      for (const name of names) {
        const p = path.join(dir, name);
        const manifest = path.join(p, 'package.json');
        if (fs.existsSync(manifest) && isEditor(name)) {
          const v = readJson(manifest).version;
          if (!found.has(v)) found.set(v, []);
          found.get(v).push(p);
        }
        if (fs.existsSync(path.join(p, 'node_modules'))) walk(path.join(p, 'node_modules'));
      }
    }
  };
  walk('node_modules');
  if (found.size === 0) fail('no CKEditor 5 package installed');
  if (found.size > 1) {
    for (const [v, ps] of found) console.error(`  ${v}: ${ps.length} (${ps[0]} …)`);
    fail('CKEditor 5 packages are at more than one version');
  }
  const [version] = found.keys();
  if (cmp(version, floor) < 0) fail(`CKEditor 5 is ${version}, below ${floor}`);
  const bundle = fs.readFileSync(BUNDLE, 'utf8');
  if (!bundle.includes(`"${version}"`)) fail(`${BUNDLE} doesn't carry "${version}": built from another copy?`);
  const count = [...found.values()][0].length;
  console.log(`ckeditor: ok, ${count} packages at ${version} (floor ${floor}), ${BUNDLE} built from it`);
}

const [mode, version] = process.argv.slice(2);
if (mode === 'raise' && version) raise(version);
else if (mode === 'check' && version) check(version);
else fail('usage: ckeditor.js raise <version> | check <floor>');
