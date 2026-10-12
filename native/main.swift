import AppKit
import WebKit

// macOS 的快捷键先走主菜单的 key equivalent，再进响应链交给 WKWebView。
// 之前这个壳是纯代码创建 NSApplication 且没有主菜单，Cmd+C/V/X/A/Z、Cmd+Q、Cmd+W
// 都无处可派发，所以软件内完全不能复制粘贴、也退不出。这里手工装一套菜单。
private func makeMainMenu() -> NSMenu {
    let mainMenu = NSMenu()

    let appItem = NSMenuItem()
    mainMenu.addItem(appItem)
    let appMenu = NSMenu(title: "Contest Publisher")
    appMenu.addItem(withTitle: "关于 Contest Publisher", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: "隐藏 Contest Publisher", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
    let hideOthers = NSMenuItem(title: "隐藏其他", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
    hideOthers.keyEquivalentModifierMask = [.command, .option]
    appMenu.addItem(hideOthers)
    appMenu.addItem(withTitle: "全部显示", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: "退出 Contest Publisher", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    appItem.submenu = appMenu

    let editItem = NSMenuItem()
    mainMenu.addItem(editItem)
    let editMenu = NSMenu(title: "编辑")
    editMenu.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
    let redo = NSMenuItem(title: "重做", action: Selector(("redo:")), keyEquivalent: "z")
    redo.keyEquivalentModifierMask = [.command, .shift]
    editMenu.addItem(redo)
    editMenu.addItem(.separator())
    editMenu.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    editMenu.addItem(withTitle: "拷贝", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    editMenu.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    editMenu.addItem(.separator())
    editMenu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    editItem.submenu = editMenu

    let windowItem = NSMenuItem()
    mainMenu.addItem(windowItem)
    let windowMenu = NSMenu(title: "窗口")
    windowMenu.addItem(withTitle: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
    windowMenu.addItem(withTitle: "缩放", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
    windowMenu.addItem(.separator())
    windowMenu.addItem(withTitle: "关闭窗口", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
    windowItem.submenu = windowMenu

    return mainMenu
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate {
    var window: NSWindow?
    var webView: WKWebView?
    var serverProcess: Process?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = makeMainMenu()
        NSApp.mainMenu = menu
        NSApp.windowsMenu = menu.item(at: 2)?.submenu

        guard let serverURL = Bundle.main.url(forResource: "server", withExtension: nil) else {
            fatalError("missing bundled server binary")
        }
        let proc = Process()
        proc.executableURL = serverURL
        proc.arguments = ["ui", "--port", "0", "--no-open"]
        let pipe = Pipe()
        proc.standardOutput = pipe
        proc.standardError = FileHandle.nullDevice
        serverProcess = proc

        let semaphore = DispatchSemaphore(value: 0)
        var appURL: URL?
        var buffer = Data()
        pipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            guard data.count > 0 else { return }
            buffer.append(data)
            // Wait until we have a complete line (newline present) before parsing
            guard let text = String(data: buffer, encoding: .utf8), text.contains("\n") else { return }
            for line in text.split(separator: "\n") {
                if line.hasPrefix("CONTEST_PUBLISHER_UI=") {
                    let urlString = line.dropFirst("CONTEST_PUBLISHER_UI=".count)
                    if let url = URL(string: String(urlString)), url.port != nil {
                        appURL = url
                        semaphore.signal()
                        return
                    }
                }
            }
        }
        try? proc.run()
        // 工作台里的「退出软件」会让服务进程退出；壳跟着退出，窗口才不会停在一个已经死掉的页面上。
        proc.terminationHandler = { _ in
            DispatchQueue.main.async { NSApp.terminate(nil) }
        }

        let waitResult = semaphore.wait(timeout: .now() + 30)
        guard waitResult == .success, let url = appURL else {
            fatalError("server did not report CONTEST_PUBLISHER_UI in time")
        }

        let contentRect = NSRect(x: 0, y: 0, width: 1440, height: 920)
        let win = NSWindow(contentRect: contentRect,
                           styleMask: [.titled, .closable, .miniaturizable, .resizable],
                           backing: .buffered, defer: false)
        win.title = "Contest Publisher"
        win.center()

        let view = WKWebView(frame: contentRect)
        view.autoresizingMask = [.width, .height]
        view.uiDelegate = self
        win.contentView = view
        view.load(URLRequest(url: url))
        win.makeKeyAndOrderFront(nil)
        win.makeFirstResponder(view)
        window = win
        webView = view
        NSApp.activate(ignoringOtherApps: true)
    }

    // WKWebView 默认不弹 window.alert/confirm/prompt：没有 uiDelegate 时 confirm 直接返回 false、
    // prompt 返回 null，按钮就表现为"点了没反应"。工作台已改成页面内自绘弹窗，这里是兜底实现。
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        presentDialog(message: message, kind: .alert) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        presentDialog(message: message, kind: .confirm) { value in completionHandler((value as? Bool) ?? false) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        presentDialog(message: prompt, kind: .prompt, defaultText: defaultText ?? "") { value in
            completionHandler(value as? String)
        }
    }

    private enum DialogKind { case alert, confirm, prompt }

    private func presentDialog(message: String, kind: DialogKind, defaultText: String = "",
                               completion: @escaping (Any?) -> Void) {
        let alert = NSAlert()
        alert.messageText = "Contest Publisher"
        alert.informativeText = message
        var field: NSTextField?
        switch kind {
        case .alert:
            alert.addButton(withTitle: "好")
        case .confirm:
            alert.addButton(withTitle: "确定")
            alert.addButton(withTitle: "取消")
        case .prompt:
            alert.addButton(withTitle: "确定")
            alert.addButton(withTitle: "取消")
            let textField = NSTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24))
            textField.stringValue = defaultText
            alert.accessoryView = textField
            field = textField
        }
        let response = alert.runModal()
        if let textField = field {
            completion(response == .alertFirstButtonReturn ? textField.stringValue : nil)
        } else if kind == .confirm {
            completion(response == .alertFirstButtonReturn)
        } else {
            completion(nil)
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        serverProcess?.terminate()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)

// 菜单自检：CONTEST_PUBLISHER_MENU_SELFTEST=1 时打印菜单与快捷键后退出，
// 便于脚本验证 Cmd+C/V/X/A/Z/Q/W/M 确实挂在主菜单上（GUI 之外唯一的可验证入口）。
if ProcessInfo.processInfo.environment["CONTEST_PUBLISHER_MENU_SELFTEST"] == "1" {
    for item in makeMainMenu().items {
        let entries = (item.submenu?.items ?? []).filter { !$0.keyEquivalent.isEmpty }.map { entry -> String in
            var mods = "cmd"
            if entry.keyEquivalentModifierMask.contains(.shift) { mods += "+shift" }
            if entry.keyEquivalentModifierMask.contains(.option) { mods += "+opt" }
            return "\(entry.title)=\(mods)+\(entry.keyEquivalent)"
        }
        print("MENU \(item.submenu?.title ?? item.title): \(entries.joined(separator: " "))")
    }
    exit(0)
}

app.run()
