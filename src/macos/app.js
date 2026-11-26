// Agent Run Inspector.app: a window and a menu bar item around the local inspector service.
// "ari service install" compiles this file with osacompile (JavaScript for Automation, built into
// macOS) into a stay-open applet, so no compiler or signing account is needed. Port and token are read
// from the file named by Info.plist key ARIServiceFile at launch, never stored in the app.
// Launched with --background (at login), it starts with only the menu bar item. A click on the item
// opens a panel with the mini view (?view=mini: running sessions and their agents); a right click shows
// a text menu (running runs, Open, Check for Updates, Quit). The window opens from either, or from the Dock.
// Updates: the latest GitHub release is checked every 6 h; "Update" runs npm i -g and "ari service install"
// in a login shell, then reopens the app.
// The panel is non-activating: showing it must not activate the app, because activation brings the
// app's window in front of the user's other apps. It closes when it loses key (a click elsewhere).
// Runs in the JXA engine, not Node (ObjC bridge: $.NSWindow, ...).
/* global ObjC, $, Ref */
ObjC.import('Cocoa');
ObjC.import('WebKit');

const REFRESH_S = 10;
const RELEASES = 'https://api.github.com/repos/th-yong/agent-run-inspector/releases/latest';
const INSTALL = "agent-run-inspector"; // what "Update" installs (npm i -g ...): the latest npm release, never unreleased main
const CHECK_EVERY = 3600 / REFRESH_S; // ticks between update checks (1 h)
const UPDATE_LOG = '~/Library/Logs/agent-run-inspector-update.log';
let win = null;
let web = null;
let item = null;
let handler = null;
let svc = null;
let panel = null;
let popWeb = null;
let panelClosedAt = 0;
let panelDelegate = null; // window delegates are weak: keep a reference
let latest = null; // newest released version seen, e.g. "0.7.1"
let ticks = 0;
let updatingSince = 0;
let rightMenu = null;

function readService() {
  const path = ObjC.unwrap($.NSBundle.mainBundle.objectForInfoDictionaryKey('ARIServiceFile')) || '';
  try {
    const s = JSON.parse(ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null)));
    return s && s.port && s.token ? s : null;
  } catch (e) {
    return null;
  }
}

const base = () => `http://127.0.0.1:${svc.port}/`;
const go = (url) => web.loadRequest($.NSURLRequest.requestWithURL($.NSURL.URLWithString(url)));

function page(text) {
  web.loadHTMLStringBaseURL(`<body style="font:14px -apple-system;padding:2em;color:#888;background:#111214">${text}</body>`, $.NSURL.URLWithString('about:blank'));
}

function signIn() {
  svc = readService();
  if (!svc) return page('The inspector service is not installed. Run <code>ari service install</code>.');
  go(`${base()}?t=${svc.token}`);
  if (popWeb) popWeb.loadRequest($.NSURLRequest.requestWithURL($.NSURL.URLWithString(`${base()}?t=${svc.token}&view=mini`)));
}

// A page that never loaded (the service was not up yet, e.g. right after login) has no title: sign in again.
const notLoaded = (view) => !view.loading && !ObjC.unwrap(view.title);

const PANEL_W = 400;
const PANEL_H = 560;

function hidePanel() {
  if (!panel.isVisible) return;
  panel.orderOut(null);
  panelClosedAt = Date.now();
}

// The page reports its content height; the panel keeps its top edge under the item.
function fitPanel(h) {
  const height = Math.max(80, Math.min(PANEL_H, Math.round(h)));
  const f = panel.frame;
  if (Math.abs(f.size.height - height) < 1) return;
  panel.setFrameDisplay($.NSMakeRect(f.origin.x, f.origin.y + f.size.height - height, PANEL_W, height), true);
}

function togglePanel() {
  if (panel.isVisible) return hidePanel();
  // A click on the item while the panel is open first takes key from it (closing it): not a reopen.
  if (Date.now() - panelClosedAt < 300) return;
  if (notLoaded(popWeb)) signIn();
  const f = item.button.window.frame; // the item, in screen coordinates
  const screen = item.button.window.screen.visibleFrame;
  const left = Math.min(Math.max(f.origin.x + f.size.width / 2 - PANEL_W / 2, screen.origin.x + 8), screen.origin.x + screen.size.width - PANEL_W - 8);
  const height = panel.frame.size.height; // as fitted to the content last time
  panel.setFrameDisplay($.NSMakeRect(left, f.origin.y - height - 6, PANEL_W, height), true);
  const app = $.NSApplication.sharedApplication;
  if (app.isHidden) app.unhideWithoutActivation; // launched at login with "open -j" (hidden): windows stay off screen
  panel.orderFrontRegardless;
  panel.makeKeyWindow; // key without activating the app (non-activating panel)
}

function showWindow(sessionId) {
  if (panel) hidePanel();
  if (!sessionId && notLoaded(web)) signIn();
  if (sessionId && svc) go(`${base()}?s=${encodeURIComponent(sessionId)}`);
  win.makeKeyAndOrderFront(null);
  $.NSApplication.sharedApplication.activateIgnoringOtherApps(true);
}

// The session list from the service (same API the page uses); null when it does not answer.
function fetchSessions() {
  if (!svc) svc = readService();
  if (!svc) return null;
  const req = $.NSMutableURLRequest.requestWithURL($.NSURL.URLWithString(`${base()}api/sessions`));
  req.setValueForHTTPHeaderField(`ari_${svc.port}=${svc.token}`, 'Cookie');
  req.timeoutInterval = 5;
  const data = $.NSURLConnection.sendSynchronousRequestReturningResponseError(req, Ref(), Ref());
  if (!data || data.isNil()) return null;
  try {
    return JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding))).sessions || [];
  } catch (e) {
    return null;
  }
}

// ---- updates: GitHub releases; "Update" runs npm and "ari service install", then reopens the app ----
const plistValue = (k) => ObjC.unwrap($.NSBundle.mainBundle.objectForInfoDictionaryKey(k)) || '';
const current = () => plistValue('CFBundleShortVersionString');

function isNewer(a, b) {
  const re = /^(\d+)\.(\d+)\.(\d+)$/;
  const x = re.exec(a || '');
  const y = re.exec(b || '');
  if (!x || !y) return false;
  for (let i = 1; i <= 3; i++) if (+x[i] !== +y[i]) return +x[i] > +y[i];
  return false;
}

/** The latest release's version, or null (offline, rate limit). Blocks up to 4 s. */
function fetchLatest() {
  const req = $.NSMutableURLRequest.requestWithURL($.NSURL.URLWithString(RELEASES));
  req.setValueForHTTPHeaderField('application/vnd.github+json', 'Accept');
  req.timeoutInterval = 4;
  const data = $.NSURLConnection.sendSynchronousRequestReturningResponseError(req, Ref(), Ref());
  if (!data || data.isNil()) return null;
  try {
    const tag = JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding))).tag_name;
    return typeof tag === 'string' ? tag.replace(/^v/, '') : null;
  } catch (e) {
    return null;
  }
}

const shell = Application.currentApplication();
shell.includeStandardAdditions = true;

/**
 * True when npm already serves this version's package. A GitHub release comes a minute or two before npm has it:
 * updating then fails (404) or reinstalls the old version. (curl: NSURLConnection's response ref crashes JXA.)
 */
function onNpm(v) {
  if (!/^\d+\.\d+\.\d+$/.test(v || '')) return false;
  try {
    shell.doShellScript(`/usr/bin/curl -sfI -m 4 -o /dev/null https://registry.npmjs.org/agent-run-inspector/-/agent-run-inspector-${v}.tgz`);
    return true;
  } catch (e) {
    return false;
  }
}

function alert(title, text, buttons) {
  if (panel) hidePanel();
  $.NSApplication.sharedApplication.activateIgnoringOtherApps(true);
  const a = $.NSAlert.alloc.init;
  a.messageText = title;
  a.informativeText = text;
  for (const b of buttons) a.addButtonWithTitle(b);
  return a.runModal - 1000; // index of the button pressed
}

const sh = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

function startUpdate() {
  const app = ObjC.unwrap($.NSBundle.mainBundle.bundlePath);
  const failed = `display alert "Agent Run Inspector could not update" message "Run this in Terminal: npm i -g ${INSTALL} && ari service install. Details: ${UPDATE_LOG}"`;
  const script = [
    `export PATH=${sh(plistValue('ARINodeBin'))}:"$PATH"`,
    `LOG=${UPDATE_LOG.replace('~', '"$HOME"')}`,
    `APP=${sh(app)}`,
    ': > "$LOG"; ok=',
    // up to 3 tries, 30 s apart: npm can lag a moment behind the release, or the network blips
    `for n in 1 2 3; do if { npm i -g ${INSTALL} && ari service install --no-open; } >> "$LOG" 2>&1; then ok=1; break; fi; [ $n = 3 ] || sleep 30; done`,
    'if [ -n "$ok" ]; then',
    '  pkill -f "$APP/Contents/MacOS/applet"; sleep 1; open "$APP"', // the new app, with its window
    `else /usr/bin/osascript -e ${sh(failed)}; fi`,
  ].join('\n');
  const task = $.NSTask.alloc.init;
  task.launchPath = '/bin/zsh';
  task.arguments = $(['-lc', script]); // a login shell: the user's PATH for npm
  task.launch; // keeps running when "ari service install" stops this app
  updatingSince = Date.now();
  item.button.title = ' ↻';
}

function offerUpdate(v) {
  if (alert(`Agent Run Inspector ${v} is available`, `You have ${current()}. Update now? It takes about a minute; the app reopens when it is done.`, ['Update', 'Later']) === 0) startUpdate();
}

function checkForUpdates(manual) {
  const v = fetchLatest();
  const ready = !isNewer(v, current()) || onNpm(v); // offer a newer version only once npm has it
  if (v && ready) latest = v;
  if (!manual) return;
  if (!v) return alert('Could not check for updates', 'GitHub did not answer. Check the connection and try again.', ['OK']);
  if (!ready) return alert(`Agent Run Inspector ${v} is almost ready`, 'It was just released and npm is still publishing it. Try again in a few minutes.', ['OK']);
  if (isNewer(v, current())) return offerUpdate(v);
  return alert('Agent Run Inspector is up to date', `Version ${current()} is the latest.`, ['OK']);
}

function menuItem(title, action, extra) {
  const mi = $.NSMenuItem.alloc.initWithTitleActionKeyEquivalent(title, action || null, '');
  if (action) mi.target = handler;
  if (extra) extra(mi);
  return mi;
}

const label = (s) => {
  const t = s.title ? `${s.title} · ${s.project || ''}` : (s.project || s.id);
  return t.length > 48 ? `${t.slice(0, 47)}…` : t;
};

function refresh() {
  const list = fetchSessions();
  const running = (list || []).filter((s) => s.status === 'running');
  item.button.title = Date.now() - updatingSince < 180000 ? ' ↻' : running.length ? ` ${running.length}` : '';
  const menu = $.NSMenu.alloc.init;
  const head = (t) => menuItem(t, null, (mi) => { mi.enabled = false; });
  if (!list) menu.addItem(head('The inspector service is not answering'));
  else {
    menu.addItem(head(running.length ? `Running (${running.length})` : 'Nothing running'));
    for (const s of running) menu.addItem(menuItem(`● ${label(s)}`, 'openRun:', (mi) => { mi.representedObject = $(s.id); }));
  }
  menu.addItem($.NSMenuItem.separatorItem);
  menu.addItem(menuItem('Open Agent Run Inspector', 'openApp:'));
  menu.addItem(menuItem(isNewer(latest, current()) ? `Update to ${latest}…` : 'Check for Updates…', 'checkUpdates:'));
  menu.addItem(menuItem('Quit', 'quitApp:'));
  rightMenu = menu;
}

ObjC.registerSubclass({
  name: 'ARIMenuTarget',
  methods: {
    'tick:': {
      types: ['void', ['id']],
      implementation: () => {
        if (ticks++ % CHECK_EVERY === 0) try { checkForUpdates(false); } catch (e) { /* next time */ }
        try { refresh(); } catch (e) { /* next tick */ }
      },
    },
    'checkUpdates:': { types: ['void', ['id']], implementation: () => (isNewer(latest, current()) ? offerUpdate(latest) : checkForUpdates(true)) },
    'openRun:': { types: ['void', ['id']], implementation: (sender) => showWindow(ObjC.unwrap(sender.representedObject)) },
    'openApp:': { types: ['void', ['id']], implementation: () => showWindow(null) },
    'quitApp:': { types: ['void', ['id']], implementation: () => $.NSApplication.sharedApplication.terminate(null) },
    'itemClicked:': {
      types: ['void', ['id']],
      implementation: () => {
        const ev = $.NSApplication.sharedApplication.currentEvent;
        const right = ev && !ev.isNil() && (Number(ev.type) === 4 || (Number(ev.modifierFlags) & (1 << 18))); // right mouse up, or control-click (the bridge hands enums over as strings)
        if (right && rightMenu) item.popUpStatusItemMenu(rightMenu);
        else togglePanel();
      },
    },
  },
});

ObjC.registerSubclass({
  name: 'ARIPanelDelegate',
  protocols: ['NSWindowDelegate'],
  methods: {
    'windowDidResignKey:': { types: ['void', ['id']], implementation: () => hidePanel() },
  },
});

// The panel page (and the window's Update badge) asks for the window (postMessage({ open: sessionId })) or reports its height ({ height }).
ObjC.registerSubclass({
  name: 'ARIBridge',
  protocols: ['WKScriptMessageHandler'],
  methods: {
    'userContentController:didReceiveScriptMessage:': {
      types: ['void', ['id', 'id']],
      implementation: (controller, message) => {
        const body = ObjC.deepUnwrap(message.body) || {};
        if (typeof body.open === 'string') showWindow(body.open || null);
        if (body.update === true) checkForUpdates(true);
        if (typeof body.height === 'number' && body.height > 0) fitPanel(body.height);
      },
    },
  },
});

function run() {
  handler = $.ARIMenuTarget.alloc.init;
  item = $.NSStatusBar.systemStatusBar.statusItemWithLength(-1); // variable length
  const icon = $.NSImage.imageWithSystemSymbolNameAccessibilityDescription('point.3.connected.trianglepath.dotted', 'Agent Run Inspector');
  icon.template = true;
  item.button.image = icon;
  item.button.imagePosition = 2; // image left of the count
  item.button.target = handler;
  item.button.action = 'itemClicked:';
  item.button.sendActionOn((1 << 2) | (1 << 4)); // left and right mouse up

  const popSize = $.NSMakeRect(0, 0, PANEL_W, PANEL_H);
  const popConfig = $.WKWebViewConfiguration.alloc.init;
  popConfig.userContentController.addScriptMessageHandlerName($.ARIBridge.alloc.init, 'ari');
  popWeb = $.WKWebView.alloc.initWithFrameConfiguration(popSize, popConfig);
  // titled (so it can take key) | non-activating | full-size content; the title bar is hidden
  panel = $.NSPanel.alloc.initWithContentRectStyleMaskBackingDefer(popSize, 1 | (1 << 7) | (1 << 15), $.NSBackingStoreBuffered, false);
  panel.titleVisibility = 1; // hidden
  panel.titlebarAppearsTransparent = true;
  for (const b of [0, 1, 2]) panel.standardWindowButton(b).hidden = true; // close, minimize, zoom
  panel.movable = false;
  panel.level = 25; // status bar level: above other apps' windows
  panel.hidesOnDeactivate = false;
  panel.releasedWhenClosed = false;
  panel.collectionBehavior = 1 << 0 | 1 << 8; // all spaces, full-screen auxiliary
  panel.contentView = popWeb;
  panelDelegate = $.ARIPanelDelegate.alloc.init;
  panel.delegate = panelDelegate;
  // The app is not active while the panel is up, so a click in another app does not take key from
  // the panel; a global monitor sees those clicks (mouse clicks only, no keys: needs no permission).
  $.NSEvent.addGlobalMonitorForEventsMatchingMaskHandler((1 << 1) | (1 << 3), () => hidePanel()); // left, right mouse down

  const frame = $.NSMakeRect(0, 0, 1280, 820);
  win = $.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer(frame, 15, $.NSBackingStoreBuffered, false); // titled, closable, miniaturizable, resizable
  win.releasedWhenClosed = false; // the menu and the Dock bring it back
  win.title = 'Agent Run Inspector';
  const winConfig = $.WKWebViewConfiguration.alloc.init;
  winConfig.userContentController.addScriptMessageHandlerName($.ARIBridge.alloc.init, 'ari'); // the header's Update badge
  web = $.WKWebView.alloc.initWithFrameConfiguration(frame, winConfig);
  win.contentView = web;
  win.center;
  win.setFrameAutosaveName('main');
  signIn();

  const background = ObjC.deepUnwrap($.NSProcessInfo.processInfo.arguments).includes('--background');
  if (!background) showWindow(null);
  try { refresh(); } catch (e) { /* the timer tries again */ }
  $.NSTimer.scheduledTimerWithTimeIntervalTargetSelectorUserInfoRepeats(REFRESH_S, handler, 'tick:', null, true);
}

function reopen() {
  if (!svc) signIn();
  showWindow(null);
}
