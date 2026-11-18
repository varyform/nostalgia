import SwiftUI
import WebKit

/// The launcher and every game, full screen and offline: dist/ is bundled with the app and
/// served from nostalgia://localhost/, so pages keep one origin (the launcher's iframes,
/// localStorage for scores and autosaves) just as they do on the web.
@main
struct NostalgiaApp: App {
    var body: some Scene {
        WindowGroup {
            GameView()
                .ignoresSafeArea()
                .statusBarHidden()
                .persistentSystemOverlays(.hidden)
                // Edge swipes are moves in a game: the first one shouldn't leave it.
                .defersSystemGestures(on: .all)
                .background(.black)
        }
    }
}

struct GameView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(BundledPages(), forURLScheme: BundledPages.scheme)
        // Sound without waiting for a tap inside each game's frame: Run in the launcher is the tap.
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.preferences.isElementFullscreenEnabled = true
        // Games play through the silent switch, like a game console; each has its own sound toggle.
        config.userContentController.addUserScript(WKUserScript(
            source: "if (navigator.audioSession) navigator.audioSession.type = 'playback';",
            injectionTime: .atDocumentStart, forMainFrameOnly: false))

        let web = WKWebView(frame: .zero, configuration: config)
        web.isOpaque = false
        web.backgroundColor = .black
        web.scrollView.backgroundColor = .black
        web.scrollView.isScrollEnabled = false
        web.scrollView.bounces = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.scrollView.pinchGestureRecognizer?.isEnabled = false
        web.isInspectable = true
        web.load(URLRequest(url: URL(string: "\(BundledPages.scheme)://localhost/index.html")!))
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {}
}

/// Serves the bundled dist/ folder.
final class BundledPages: NSObject, WKURLSchemeHandler {
    static let scheme = "nostalgia"
    private let root = Bundle.main.resourceURL!.appendingPathComponent("dist", isDirectory: true)

    func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        let path = url.path.isEmpty || url.path == "/" ? "index.html" : String(url.path.dropFirst())
        let file = root.appendingPathComponent(path).standardizedFileURL
        guard file.path.hasPrefix(root.standardizedFileURL.path + "/"),
              let data = try? Data(contentsOf: file)
        else {
            task.didReceive(HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: [:])!)
            task.didFinish()
            return
        }
        let type = switch file.pathExtension {
        case "html": "text/html; charset=utf-8"
        case "js": "text/javascript"
        case "css": "text/css"
        case "svg": "image/svg+xml"
        case "png": "image/png"
        default: "application/octet-stream"
        }
        task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                        headerFields: ["Content-Type": type, "Content-Length": "\(data.count)"])!)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {}
}
