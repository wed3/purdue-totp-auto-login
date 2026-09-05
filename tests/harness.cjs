// Dependency-free simulation of extension messaging and the DOM APIs used here.
// This is a regression harness, not a browser or a live Microsoft integration test.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const source = name => fs.readFileSync(path.join(__dirname, "../src", name), "utf8");
const tenant = "4130bd39-7c53-419c-b1e5-8758d6d63f21";
const entry = `https://login.microsoftonline.com/${tenant}/saml2`;
const tick = () => new Promise(resolve => setImmediate(resolve));

function background(overrides = {}) {
  const local = { username: "testuser", enabled: true, totpSecret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", autoSelectMethod: true, autoSubmit: true, ...overrides };
  const session = {};
  const clock = { now: 600000 }; // start of a TOTP window, no actual credential
  const accesses = [];
  let listener;
  let storageChanged;
  const area = data => ({
    async get(keys) {
      if (typeof keys === "string") return { [keys]: data[keys] };
      if (!keys) return { ...data };
      return Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, data[k] ?? v]));
    },
    async set(values) { Object.assign(data, values); },
    async remove(key) { delete data[key]; },
    async clear() { for (const key of Object.keys(data)) delete data[key]; },
    async setAccessLevel(value) { accesses.push(value.accessLevel); }
  });
  const ctx = vm.createContext({
    URL, crypto: webcrypto,
    Date: class extends Date { static now() { return clock.now; } },
    chrome: {
      runtime: { onInstalled: { addListener() {} }, onMessage: { addListener(fn) { listener = fn; } }, async openOptionsPage() {} },
      storage: { local: area(local), session: area(session), onChanged: { addListener(fn) { storageChanged = fn; } } }
    }
  });
  ctx.importScripts = name => vm.runInContext(source(name), ctx);
  vm.runInContext(source("service_worker.js"), ctx);
  const send = (type, sender = { url: entry, tab: { id: 1 }, frameId: 0 }) =>
    new Promise(resolve => listener(typeof type === "string" ? { type } : type, sender, resolve));
  const changeSettings = async values => {
    const changes = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { oldValue: local[key], newValue: value }]));
    Object.assign(local, values);
    storageChanged(changes, "local");
    // A subsequent queued message waits until the revocation has completed.
    await send("getExtensionStatus");
  };
  return { local, session, clock, send, accesses, changeSettings };
}

function dom(worker, { url = entry, tabId = 1 } = {}) {
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.listeners = {}; this._text = ""; this.disabled = false; this.visible = true; this.clicks = 0; }
    get parentElement() { return this.parent; }
    get isConnected() { return this === document.documentElement || Boolean(this.parent?.isConnected); }
    get textContent() { return this._text + this.children.map(c => c.textContent).join(" "); }
    set textContent(value) { this._text = value; this.children = []; }
    get innerText() { return this.textContent; }
    setAttribute(k, v) { this.attributes[k] = String(v); }
    getAttribute(k) { return this.attributes[k] ?? this[k] ?? null; }
    append(...children) { for (const c of children) { c.remove(); c.parent = this; this.children.push(c); } }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null; }
    matches(selector) {
      return selector.split(",").some(piece => {
        const s = piece.trim();
        const tag = s.match(/^[a-z]+/i)?.[0];
        if (tag && this.tag !== tag) return false;
        const id = s.match(/#([\w-]+)/)?.[1];
        if (id && this.id !== id) return false;
        const cls = s.match(/\.([\w-]+)/)?.[1];
        if (cls && !(this.className || "").split(" ").includes(cls)) return false;
        for (const m of s.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
          const value = this.getAttribute(m[1]);
          if (value === null || (m[2] !== undefined && value !== m[2])) return false;
        }
        return true;
      });
    }
    querySelectorAll(selector) { return this.children.flatMap(c => [...(c.matches(selector) ? [c] : []), ...c.querySelectorAll(selector)]); }
    closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) || null; }
    getBoundingClientRect() { const visible = this.visible && (!this.parent || this.parent.getBoundingClientRect().width > 0); return { width: visible ? 100 : 0, height: visible ? 20 : 0 }; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    dispatchEvent(event) { for (const fn of this.listeners[event.type] || []) fn(event); }
    click() { this.clicks++; this.dispatchEvent({ type: "click", isTrusted: false }); }
    userClick() { this.clicks++; this.dispatchEvent({ type: "click", isTrusted: true }); }
    focus() { document.activeElement = this; }
  }
  class Input extends Element {
    constructor() { super("input"); this._value = ""; }
    get value() { return this._value; }
    set value(value) { this._value = value; }
  }
  const document = {
    createElement: tag => tag === "input" ? new Input() : new Element(tag),
    querySelectorAll: s => document.documentElement.querySelectorAll(s),
    getElementById: id => document.querySelectorAll("#" + id)[0] || null,
    addEventListener() {}
  };
  document.documentElement = new Element("html");
  document.body = new Element("body");
  document.documentElement.append(document.body);
  let observer;
  let timerId = 0;
  const timers = new Map();
  const intervals = [];
  const calls = [];
  let inFlight = 0;
  const sender = { url, tab: { id: tabId }, frameId: 0 };
  const ctx = vm.createContext({
    document, HTMLInputElement: Input,
    Event: class { constructor(type) { this.type = type; } },
    MutationObserver: class { constructor(fn) { observer = fn; } observe() {} disconnect() {} },
    window: {
      setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
      setInterval(fn) { intervals.push(fn); },
      getComputedStyle: e => ({ display: e.visible ? "block" : "none", visibility: "visible" })
    },
    chrome: { runtime: { async sendMessage(message) {
      calls.push(message.type);
      inFlight++;
      try { return await worker.send(message, sender); }
      finally { inFlight--; }
    } } }
  });
  const node = (tag, props = {}, text = "") => { const n = document.createElement(tag); Object.assign(n, props); n.textContent = text; return n; };
  const screen = (...nodes) => {
    for (const n of [...document.body.children]) n.remove();
    const form = node("form", { id: "lightbox" });
    form.append(...nodes);
    document.body.append(form);
    observer?.();
    return form;
  };
  const flush = async () => {
    for (let i = 0; i < 200; i++) {
      await tick();
      if (!timers.size && !inFlight) { await tick(); if (!timers.size && !inFlight) return; }
      // WebCrypto uses a native worker pool. Wait for outstanding messages,
      // rather than treating an empty JavaScript timer queue as completion.
      if (!timers.size && inFlight) await new Promise(resolve => setTimeout(resolve, 1));
      for (const [id, fn] of [...timers]) { timers.delete(id); fn(); }
    }
    throw new Error("Unexpected scan loop");
  };
  return {
    document, node, screen, calls, sender, flush,
    start: () => vm.runInContext(source("microsoft_login.js"), ctx),
    poll: async () => { intervals.forEach(fn => fn()); await flush(); },
    button: () => document.getElementById("purdue-totp-auto-login-button"),
    status: () => document.getElementById("purdue-totp-status")?.textContent
  };
}
module.exports = { background, dom, entry, tenant, tick };
