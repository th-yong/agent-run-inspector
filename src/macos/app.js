// Agent Run Inspector.app: a window and a menu bar item around the local inspector service.
// "ari service install" compiles this file with osacompile (JavaScript for Automation, built into
// macOS) into a stay-open applet, so no compiler or signing account is needed. Port and token are read
// from the file named by Info.plist key ARIServiceFile at launch, never stored in the app.
// Launched with --background (at login), it starts with only the menu bar item. A click on the item
// opens a popover with the mini view (?view=mini: running run and its graph); a right click shows a
// text menu (recent runs, Open, Quit). The window opens from either, or from the Dock. Runs in the JXA engine, not Node (ObjC bridge: $.NSWindow, ...).
/* global ObjC, $, Ref */
ObjC.import('Cocoa');
ObjC.import('WebKit');

const REFRESH_S = 10;
const RECENT = 5;
let win = null;
let web = null;
let item = null;
let handler = null;
let svc = null;
let pop = null;
let popWeb = null;
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

function togglePopover() {
  if (pop.shown) return pop.performClose(null);
  if (notLoaded(popWeb)) signIn();
  pop.showRelativeToRectOfViewPreferredEdge(item.button.bounds, item.button, 1); // below the item
  $.NSApplication.sharedApplication.activateIgnoringOtherApps(true);
}

function showWindow(sessionId) {
  if (pop && pop.shown) pop.performClose(null);
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
  const last = (s) => s.end || s.lastWrite || 0;
  const recent = (list || []).filter((s) => s.status !== 'running').sort((a, b) => last(b) - last(a)).slice(0, RECENT);
  item.button.title = running.length ? ` ${running.length}` : '';
  const menu = $.NSMenu.alloc.init;
  const head = (t) => menuItem(t, null, (mi) => { mi.enabled = false; });
  if (!list) menu.addItem(head('The inspector service is not answering'));
  else {
    menu.addItem(head(running.length ? `Running (${running.length})` : 'Nothing running'));
    for (const s of running) menu.addItem(menuItem(`● ${label(s)}`, 'openRun:', (mi) => { mi.representedObject = $(s.id); }));
    if (recent.length) {
      menu.addItem($.NSMenuItem.separatorItem);
      menu.addItem(head('Recent'));
      for (const s of recent) menu.addItem(menuItem(label(s), 'openRun:', (mi) => { mi.representedObject = $(s.id); }));
    }
  }
  menu.addItem($.NSMenuItem.separatorItem);
  menu.addItem(menuItem('Open Agent Run Inspector', 'openApp:'));
  menu.addItem(menuItem('Quit', 'quitApp:'));
  rightMenu = menu;
}

ObjC.registerSubclass({
  name: 'ARIMenuTarget',
  methods: {
    'tick:': { types: ['void', ['id']], implementation: () => { try { refresh(); } catch (e) { /* next tick */ } } },
    'openRun:': { types: ['void', ['id']], implementation: (sender) => showWindow(ObjC.unwrap(sender.representedObject)) },
    'openApp:': { types: ['void', ['id']], implementation: () => showWindow(null) },
    'quitApp:': { types: ['void', ['id']], implementation: () => $.NSApplication.sharedApplication.terminate(null) },
    'itemClicked:': {
      types: ['void', ['id']],
      implementation: () => {
        const ev = $.NSApplication.sharedApplication.currentEvent;
        const right = ev && !ev.isNil() && (ev.type === 4 || (ev.modifierFlags & (1 << 18))); // right mouse up, or control-click
        if (right && rightMenu) item.popUpStatusItemMenu(rightMenu);
        else togglePopover();
      },
    },
  },
});

// The popover page asks for the window: window.webkit.messageHandlers.ari.postMessage({ open: sessionId }).
ObjC.registerSubclass({
  name: 'ARIBridge',
  protocols: ['WKScriptMessageHandler'],
  methods: {
    'userContentController:didReceiveScriptMessage:': {
      types: ['void', ['id', 'id']],
      implementation: (controller, message) => {
        const body = ObjC.deepUnwrap(message.body) || {};
        if (typeof body.open === 'string') showWindow(body.open || null);
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

  const popSize = $.NSMakeRect(0, 0, 400, 560);
  const popConfig = $.WKWebViewConfiguration.alloc.init;
  popConfig.userContentController.addScriptMessageHandlerName($.ARIBridge.alloc.init, 'ari');
  popWeb = $.WKWebView.alloc.initWithFrameConfiguration(popSize, popConfig);
  const popView = $.NSViewController.alloc.init;
  popView.view = popWeb;
  pop = $.NSPopover.alloc.init;
  pop.contentSize = $.NSMakeSize(400, 560);
  pop.behavior = 1; // transient: closes on a click outside
  pop.contentViewController = popView;

  const frame = $.NSMakeRect(0, 0, 1280, 820);
  win = $.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer(frame, 15, $.NSBackingStoreBuffered, false); // titled, closable, miniaturizable, resizable
  win.releasedWhenClosed = false; // the menu and the Dock bring it back
  win.title = 'Agent Run Inspector';
  web = $.WKWebView.alloc.initWithFrameConfiguration(frame, $.WKWebViewConfiguration.alloc.init);
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
