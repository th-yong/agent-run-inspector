// Agent Run Inspector.app: a window around the local inspector service. "ari service install" compiles
// this file with osacompile (JavaScript for Automation, built into macOS) into a stay-open applet, so
// no compiler or signing account is needed. At each launch it reads the port and token from the file
// named by Info.plist key ARIServiceFile and signs in through /?t=..., so the app never stores the token.
// Runs in the JXA engine, not Node (ObjC bridge: $.NSWindow, ...).
/* global ObjC, $ */
ObjC.import('Cocoa');
ObjC.import('WebKit');

let win = null;
let web = null;

function page(text) {
  web.loadHTMLStringBaseURL(`<body style="font:14px -apple-system;padding:2em;color:#888;background:#111214">${text}</body>`, $.NSURL.URLWithString('about:blank'));
}

function load() {
  const path = ObjC.unwrap($.NSBundle.mainBundle.objectForInfoDictionaryKey('ARIServiceFile')) || '';
  const raw = ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null));
  let s = null;
  try { s = JSON.parse(raw); } catch (e) { s = null; }
  if (!s || !s.port || !s.token) return page('The inspector service is not installed. Run <code>ari service install</code>.');
  web.loadRequest($.NSURLRequest.requestWithURL($.NSURL.URLWithString(`http://127.0.0.1:${s.port}/?t=${s.token}`)));
}

function run() {
  const frame = $.NSMakeRect(0, 0, 1280, 820);
  win = $.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer(frame, 15, $.NSBackingStoreBuffered, false); // titled, closable, miniaturizable, resizable
  win.releasedWhenClosed = false; // the Dock icon brings it back (reopen)
  win.title = 'Agent Run Inspector';
  web = $.WKWebView.alloc.initWithFrameConfiguration(frame, $.WKWebViewConfiguration.alloc.init);
  win.contentView = web;
  win.center;
  win.setFrameAutosaveName('main');
  load();
  win.makeKeyAndOrderFront(null);
  $.NSApplication.sharedApplication.activateIgnoringOtherApps(true);
}

function reopen() {
  if (!win) return run();
  if (!win.isVisible) load();
  win.makeKeyAndOrderFront(null);
}
