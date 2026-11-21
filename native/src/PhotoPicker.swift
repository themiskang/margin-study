import AppKit
import PhotosUI
import UniformTypeIdentifiers
import ImageIO

// One-shot public PhotosUI host. Only selected item-provider representations are read.
@MainActor
final class PhotoPickerHost: NSObject, NSApplicationDelegate, NSWindowDelegate, PHPickerViewControllerDelegate {
    let output: URL
    var window: NSWindow!
    var finished = false
    var totalPixels = 0
    var names: [String] = []
    var pending: [PHPickerResult] = []

    init(output: URL) { self.output = output }

    func finish(_ status: String, message: String? = nil) {
        guard !finished else { return }; finished = true
        var result: [String: Any] = ["version": 1, "status": status]
        if status == "selected" { result["files"] = names }
        if let message { result["message"] = message }
        if let data = try? JSONSerialization.data(withJSONObject: result) {
            FileHandle.standardOutput.write(data)
        }
        exit(0)
    }

    @objc func cancel() { finish("cancelled") }
    func windowShouldClose(_ sender: NSWindow) -> Bool { cancel(); return false }

    func applicationDidFinishLaunching(_ notification: Notification) {
        var configuration = PHPickerConfiguration()
        configuration.filter = .images
        configuration.selectionLimit = 100
        configuration.selection = .ordered
        configuration.preferredAssetRepresentationMode = .compatible
        let picker = PHPickerViewController(configuration: configuration)
        picker.delegate = self
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 760, height: 620), styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.title = "Photos"
        window.contentMinSize = NSSize(width: 520, height: 400)
        window.contentViewController = picker
        window.delegate = self
        let menu = NSMenu(), application = NSMenuItem(), commands = NSMenu()
        for (title, key) in [("Cancel", "w"), ("Quit", "q")] {
            let item = NSMenuItem(title: title, action: #selector(cancel), keyEquivalent: key)
            item.target = self; commands.addItem(item)
        }
        application.submenu = commands; menu.addItem(application); NSApp.mainMenu = menu
        window.center(); window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
    }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        if results.isEmpty { cancel(); return }
        guard results.count <= 100 else { finish("error", message: "一次最多选择100张照片"); return }
        pending = results
        let waiting = NSTextField(labelWithString: "Preparing photos…")
        waiting.alignment = .center
        window.contentView = waiting
        load(at: 0)
    }

    func load(at index: Int) {
        guard !finished else { return }
        if index == pending.count { finish("selected"); return }
        let provider = pending[index].itemProvider
        guard let type = provider.registeredTypeIdentifiers.first(where: { UTType($0)?.conforms(to: .image) == true }) else {
            finish("error", message: "所选内容无法作为图片读取"); return
        }
        let name = String(format: "%04d.png", index), destination = output.appendingPathComponent(name)
        provider.loadFileRepresentation(forTypeIdentifier: type) { url, error in
            // The provider's URL must be consumed before this callback returns.
            var pixels = 0
            do {
                guard error == nil, let url,
                      let size = try FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber,
                      size.intValue <= 100_000_000,
                      let source = CGImageSourceCreateWithURL(url as CFURL, nil),
                      let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
                      let width = properties[kCGImagePropertyPixelWidth] as? Int,
                      let height = properties[kCGImagePropertyPixelHeight] as? Int,
                      width > 0, height > 0, width <= 14400, height <= 14400, width * height <= 32_000_000 else { throw PhotoError.unreadable }
                pixels = width * height
                let options: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: max(width, height)]
                guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary),
                      let encoder = CGImageDestinationCreateWithURL(destination as CFURL, UTType.png.identifier as CFString, 1, nil) else { throw PhotoError.unreadable }
                CGImageDestinationAddImage(encoder, image, nil)
                guard CGImageDestinationFinalize(encoder) else { throw PhotoError.unreadable }
            } catch {
                DispatchQueue.main.async { self.finish("error", message: "所选照片无法读取或尺寸过大，请重选；iCloud照片需要先完成下载") }
                return
            }
            let count = pixels
            DispatchQueue.main.async {
                self.totalPixels += count
                guard self.totalPixels <= 64_000_000 else { self.finish("error", message: "所选照片总尺寸过大，请分批插入"); return }
                self.names.append(name); self.load(at: index + 1)
            }
        }
    }
}

enum PhotoError: Error { case unreadable }
@main struct Launcher {
    @MainActor static func main() {
        guard CommandLine.arguments.count == 2 else { exit(2) }
        let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: output.path, isDirectory: &isDirectory), isDirectory.boolValue else { exit(2) }
        let application = NSApplication.shared
        let host = PhotoPickerHost(output: output)
        application.setActivationPolicy(.accessory)
        application.delegate = host
        withExtendedLifetime(host) { application.run() }
    }
}
