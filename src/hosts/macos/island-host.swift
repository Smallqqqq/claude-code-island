import Cocoa
import WebKit
import Foundation

// MARK: - Stdout Helper
func writeToStdout(_ dict: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: dict),
          let line = String(data: data, encoding: .utf8) else { return }
    let output = line + "\n"
    FileHandle.standardOutput.write(output.data(using: .utf8)!)
    fflush(stdout)
}

func log(_ message: String) { fputs("[island-host] \(message)\n", stderr) }

// MARK: - CLI Config
struct Config {
    var width: Int = 640
    var height: Int = 420
    var title: String = "Claude Island"
    var frameless: Bool = false
    var floating: Bool = false
    var transparent: Bool = false
    var x: Int? = nil
    var y: Int? = nil
    var clickThrough: Bool = false
    var hidden: Bool = false
    var noDock: Bool = false
}

func parseArgs() -> Config {
    var config = Config()
    let args = CommandLine.arguments
    var i = 1
    while i < args.count {
        switch args[i] {
        case "--width":  i += 1; if i < args.count, let v = Int(args[i]) { config.width = v }
        case "--height": i += 1; if i < args.count, let v = Int(args[i]) { config.height = v }
        case "--title":  i += 1; if i < args.count { config.title = args[i] }
        case "--frameless": config.frameless = true
        case "--floating": config.floating = true
        case "--transparent": config.transparent = true
        case "--x": i += 1; if i < args.count, let v = Int(args[i]) { config.x = v }
        case "--y": i += 1; if i < args.count, let v = Int(args[i]) { config.y = v }
        case "--click-through": config.clickThrough = true
        case "--hidden": config.hidden = true
        case "--no-dock": config.noDock = true
        default: break
        }
        i += 1
    }
    return config
}

// MARK: - WebView Bridge
let bridgeJS = """
window.islandHost = {
    send: function(data) {
        window.webkit.messageHandlers.islandHost.postMessage(JSON.stringify(data));
    },
    close: function() {
        window.webkit.messageHandlers.islandHost.postMessage(JSON.stringify({__islandHost_close: true}));
    }
};
"""

// MARK: - Window Subclass (prevents constrainFrameRect from pulling window down)
class IslandPanel: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
        return frameRect
    }
}

// MARK: - AppDelegate
@MainActor
class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler, NSWindowDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    let config: Config
    var hidden: Bool = false

    nonisolated init(config: Config) { self.config = config }

    func applicationDidFinishLaunching(_ notification: Notification) {
        hidden = config.hidden
        setupWindow()
        setupWebView()
        startStdinReader()
    }

    private func setupWindow() {
        let rect = NSRect(x: 0, y: 0, width: config.width, height: config.height)
        let styleMask: NSWindow.StyleMask = config.frameless ? [.borderless] : [.titled, .closable, .miniaturizable, .resizable]
        window = IslandPanel(contentRect: rect, styleMask: styleMask, backing: .buffered, defer: false)
        window.title = config.title
        if config.frameless { window.isMovableByWindowBackground = true }
        if config.floating { window.level = .statusBar }
        if config.clickThrough { window.ignoresMouseEvents = true }
        if config.transparent { window.isOpaque = false; window.backgroundColor = .clear }
        if let x = config.x, let y = config.y { window.setFrameOrigin(NSPoint(x: x, y: y)) }
        else { window.center() }
        window.delegate = self
        if config.hidden { window.orderOut(nil) }
        else if config.clickThrough { window.orderFrontRegardless() }
        else { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }
    }

    private func makeWebViewConfiguration() -> WKWebViewConfiguration {
        let ucc = WKUserContentController()
        let script = WKUserScript(source: bridgeJS, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        ucc.addUserScript(script)
        ucc.add(self, name: "islandHost")
        let wkConfig = WKWebViewConfiguration()
        wkConfig.userContentController = ucc
        return wkConfig
    }

    private func setupWebView() {
        webView = WKWebView(frame: window.contentView!.bounds, configuration: makeWebViewConfiguration())
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        if config.transparent {
            webView.underPageBackgroundColor = .clear
            webView.setValue(false, forKey: "drawsBackground")
        }
        window.contentView?.addSubview(webView)
        webView.loadHTMLString("<html><body></body></html>", baseURL: nil)
    }

    private func startStdinReader() {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            while let line = readLine() {
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                guard !trimmed.isEmpty else { continue }
                guard let data = trimmed.data(using: .utf8),
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let type = json["type"] as? String
                else { log("Skipping invalid JSON: \(trimmed)"); continue }
                DispatchQueue.main.async { [weak self] in
                    MainActor.assumeIsolated {
                        self?.handleCommand(type: type, json: json)
                    }
                }
            }
            DispatchQueue.main.async { [weak self] in
                MainActor.assumeIsolated { self?.closeAndExit() }
            }
        }
    }

    func handleCommand(type: String, json: [String: Any]) {
        switch type {
        case "html":
            guard let base64 = json["html"] as? String,
                  let htmlData = Data(base64Encoded: base64),
                  let html = String(data: htmlData, encoding: .utf8)
            else { log("html: missing or invalid payload"); return }
            webView.loadHTMLString(html, baseURL: nil)
        case "eval":
            guard let js = json["js"] as? String else { log("eval: missing js"); return }
            webView.evaluateJavaScript(js, completionHandler: nil)
        case "close":
            closeAndExit()
        default:
            log("Unknown command: \(type)")
        }
    }

    func closeAndExit() {
        writeToStdout(["type": "closed"])
        exit(0)
    }

    nonisolated func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        MainActor.assumeIsolated {
            if hidden { window.orderOut(nil) }
            else { window.makeFirstResponder(webView) }
            var info: [String: Any] = ["type": "ready"]
            // Screen info
            if let screen = NSScreen.main {
                let f = screen.frame
                info["screen"] = [
                    "width": Int(f.width), "height": Int(f.height),
                    "visibleWidth": Int(screen.visibleFrame.width),
                    "visibleHeight": Int(screen.visibleFrame.height),
                ]
            }
            writeToStdout(info)
        }
    }

    nonisolated func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        MainActor.assumeIsolated {
            guard let body = message.body as? String,
                  let data = body.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else { log("Invalid message from webview"); return }
            if json["__islandHost_close"] as? Bool == true { closeAndExit(); return }
            writeToStdout(["type": "message", "data": json])
        }
    }

    func windowWillClose(_ notification: Notification) { writeToStdout(["type": "closed"]); exit(0) }
}

// MARK: - Entry Point
let config = parseArgs()
let app = NSApplication.shared
let delegate = AppDelegate(config: config)
app.delegate = delegate
app.setActivationPolicy((config.clickThrough || config.hidden || config.noDock) ? .accessory : .regular)
app.run()
