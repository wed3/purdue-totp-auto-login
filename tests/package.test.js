const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const manifest = JSON.parse(read("manifest.json"));

test("every declared extension script, CSS file, and page exists", () => {
  const paths = [manifest.background.service_worker, manifest.action.default_popup, manifest.options_ui.page,
    ...manifest.content_scripts.flatMap(s => [...s.js, ...(s.css || [])])];
  for (const file of paths) assert.ok(fs.statSync(path.join(root, file)).isFile(), file);
  for (const file of [manifest.action.default_popup, manifest.options_ui.page]) {
    for (const match of read(file).matchAll(/(?:src|href)="([^":]+\.(?:js|css))"/g)) {
      assert.ok(fs.statSync(path.join(root, path.dirname(file), match[1])).isFile(), match[1]);
    }
  }
});

test("settings HTML has every element used by its controller and loads helpers in order", () => {
  const html = read("src/options.html");
  for (const match of read("src/options.js").matchAll(/getElementById\("([^"]+)"\)/g)) {
    assert.ok(html.includes('id="' + match[1] + '"'), match[1]);
  }
  assert.ok(html.indexOf('src="totp.js"') < html.indexOf('src="settings.js"'));
  assert.ok(html.indexOf('src="settings.js"') < html.indexOf('src="options.js"'));
});

test("package has no broad host permissions, remote scripts, network calls or credential logging", () => {
  assert.equal(manifest.version, "0.2.0");
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.equal(manifest.host_permissions, undefined);
  for (const file of fs.readdirSync(path.join(root, "src")).filter(f => f.endsWith(".js"))) {
    assert.doesNotMatch(read("src/" + file), /\bfetch\s*\(|XMLHttpRequest|console\.(log|debug|info)\s*\(/, file);
  }
});
