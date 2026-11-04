import AppKit
// Capture-session start/stop operations are serialized on cameraQueue after configuration.
@preconcurrency import AVFoundation
import CoreMedia
import UniformTypeIdentifiers
import ImageIO

// Public AVFoundation capture with the observed live → Retake / Use Photo workflow.
// No image is written until Use Photo; no microphone input is created.
final class CameraPreview: NSView {
    let video = AVCaptureVideoPreviewLayer()
    override init(frame: NSRect) {
        super.init(frame: frame); wantsLayer = true
        layer?.backgroundColor = NSColor.black.cgColor
        video.videoGravity = .resizeAspect; layer?.addSublayer(video)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }
    override func layout() { super.layout(); video.frame = bounds }
}

final class ShutterButton: NSButton {
    override func draw(_ dirtyRect: NSRect) {
        NSColor(white: 0.25, alpha: 1).setFill()
        NSBezierPath(roundedRect: bounds, xRadius: 5, yRadius: 5).fill()
        let circle = NSRect(x: bounds.midX - 9, y: bounds.midY - 9, width: 18, height: 18)
        (isEnabled ? NSColor.systemRed : NSColor.darkGray).setFill(); NSBezierPath(ovalIn: circle).fill()
        NSColor.white.setFill()
        NSBezierPath(roundedRect: NSRect(x: bounds.midX - 5, y: bounds.midY - 3, width: 10, height: 6), xRadius: 1, yRadius: 1).fill()
        NSBezierPath(rect: NSRect(x: bounds.midX - 2, y: bounds.midY + 3, width: 4, height: 1)).fill()
        NSColor.systemRed.setFill(); NSBezierPath(ovalIn: NSRect(x: bounds.midX - 1.5, y: bounds.midY - 1.5, width: 3, height: 3)).fill()
    }
}

final class CameraPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

@MainActor
final class CameraPickerHost: NSObject, NSApplicationDelegate, AVCapturePhotoCaptureDelegate {
    let output: URL
    let session = AVCaptureSession(), photoOutput = AVCapturePhotoOutput()
    let cameraQueue = DispatchQueue(label: "com.marginstudy.camera-capture")
    var camera: AVCaptureDevice?
    var finished = false, capturing = false
    var window: NSWindow?, waiting: NSWindow?, preview: CameraPreview?, photoView: NSImageView?, confirmationBar: NSView?
    var shutter: NSButton?, cancelButton: NSButton?, retakeButton: NSButton?, useButton: NSButton?
    var captured: CGImage?
    var observers: [NSObjectProtocol] = []
    init(output: URL) { self.output = output }

    func finish(_ status: String, message: String? = nil) {
        guard !finished else { return }; finished = true
        var result: [String: Any] = ["version": 1, "status": status]
        if status == "selected" { result["files"] = ["0000.png"] }
        if let message { result["message"] = message }
        if let data = try? JSONSerialization.data(withJSONObject: result) {
            try? data.write(to: output.appendingPathComponent("result.json"), options: .atomic)
            FileHandle.standardOutput.write(data)
        }
        exit(0)
    }
    @objc func cancel() { finish("cancelled") }

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard FileManager.default.fileExists(atPath: output.path) else { cancel(); return }
        let lifetime = Timer(timeInterval: 0.2, repeats: true) { _ in
            Task { @MainActor in
                if !FileManager.default.fileExists(atPath: self.output.path) { self.cancel() }
            }
        }
        RunLoop.main.add(lifetime, forMode: .common)
        let menu = NSMenu(), application = NSMenuItem(), commands = NSMenu()
        for (title, key) in [("Cancel", "w"), ("Quit", "q")] {
            let item = NSMenuItem(title: title, action: #selector(cancel), keyEquivalent: key)
            item.target = self; commands.addItem(item)
        }
        application.submenu = commands; menu.addItem(application); NSApp.mainMenu = menu
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: openCamera()
        case .notDetermined:
            let panel = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 440, height: 160), styleMask: [.titled], backing: .buffered, defer: false)
            panel.title = "Camera"
            let label = NSTextField(labelWithString: "Waiting for camera access…")
            label.frame = NSRect(x: 24, y: 85, width: 392, height: 24)
            let button = NSButton(title: "Cancel", target: self, action: #selector(cancel))
            button.frame = NSRect(x: 320, y: 20, width: 96, height: 32); button.keyEquivalent = "\u{1b}"
            panel.contentView?.addSubview(label); panel.contentView?.addSubview(button)
            waiting = panel; panel.center(); panel.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            AVCaptureDevice.requestAccess(for: .video) { granted in
                DispatchQueue.main.async {
                    guard !self.finished else { return }
                    if granted { self.waiting?.orderOut(nil); self.waiting = nil; self.openCamera() }
                    else { self.permissionDenied() }
                }
            }
        default: permissionDenied()
        }
    }
    func permissionDenied() {
        finish("error", message: "相机权限未开启。请在系统设置 → 隐私与安全性 → 相机中允许 MarginStudy Camera，再重新打开 Camera。")
    }

    func openCamera() {
        guard let device = AVCaptureDevice.default(for: .video) else { finish("error", message: "没有可用的相机，请连接相机后重试。"); return }
        do {
            let input = try AVCaptureDeviceInput(device: device)
            session.beginConfiguration()
            if session.canSetSessionPreset(.photo) { session.sessionPreset = .photo }
            guard session.canAddInput(input), session.canAddOutput(photoOutput) else {
                session.commitConfiguration(); finish("error", message: "无法启动相机拍摄，请重试。"); return
            }
            session.addInput(input); session.addOutput(photoOutput)
            session.commitConfiguration()
            camera = device
        } catch { finish("error", message: "无法打开相机：" + error.localizedDescription); return }
        let size = NSSize(width: min(580, NSScreen.main?.visibleFrame.width ?? 580), height: min(640, NSScreen.main?.visibleFrame.height ?? 640))
        let panel = CameraPanel(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless], backing: .buffered, defer: false)
        panel.title = "Camera"; panel.isReleasedWhenClosed = false; panel.isOpaque = false; panel.backgroundColor = .clear; panel.hasShadow = true
        let root = NSView(frame: NSRect(origin: .zero, size: size)); root.wantsLayer = true
        root.layer?.backgroundColor = NSColor.black.cgColor; root.layer?.cornerRadius = 16; root.layer?.masksToBounds = true
        panel.contentView = root
        let imageArea = NSRect(x: 0, y: 72, width: size.width, height: size.height - 72)
        let live = CameraPreview(frame: imageArea); live.video.session = session
        if let connection = live.video.connection, connection.isVideoMirroringSupported {
            connection.automaticallyAdjustsVideoMirroring = false; connection.isVideoMirrored = false
        }
        if let connection = photoOutput.connection(with: .video), connection.isVideoMirroringSupported {
            connection.automaticallyAdjustsVideoMirroring = false; connection.isVideoMirrored = false
        }
        let frozen = NSImageView(frame: imageArea); frozen.imageScaling = .scaleProportionallyUpOrDown; frozen.isHidden = true
        let bar = NSView(frame: NSRect(x: 0, y: 0, width: size.width, height: 72)); bar.wantsLayer = true; bar.layer?.backgroundColor = NSColor(white: 0.07, alpha: 1).cgColor; bar.isHidden = true
        root.addSubview(live); root.addSubview(frozen); root.addSubview(bar)
        let shot = ShutterButton(title: "", target: self, action: #selector(takePhoto))
        shot.frame = NSRect(x: (size.width - 50) / 2, y: 20, width: 50, height: 20); shot.isBordered = false; shot.isEnabled = false
        shot.setAccessibilityLabel("Take Photo"); shot.toolTip = "Take a picture"
        func action(_ title: String, _ selector: Selector, _ frame: NSRect) -> NSButton {
            let button = NSButton(title: title, target: self, action: selector)
            button.frame = frame; button.isBordered = false; button.font = .systemFont(ofSize: 17); button.contentTintColor = .white
            root.addSubview(button); return button
        }
        let cancel = action("Cancel", #selector(cancel), NSRect(x: size.width - 78, y: 16, width: 62, height: 28))
        cancel.wantsLayer = true; cancel.layer?.backgroundColor = NSColor(white: 0.25, alpha: 1).cgColor; cancel.layer?.cornerRadius = 5; cancel.keyEquivalent = "\u{1b}"
        let retake = action("Retake", #selector(retakePhoto), NSRect(x: 12, y: 16, width: 68, height: 36)); retake.isHidden = true
        let use = action("Use Photo", #selector(usePhoto), NSRect(x: size.width - 110, y: 16, width: 100, height: 36)); use.isHidden = true
        root.addSubview(shot)
        window = panel; preview = live; photoView = frozen; confirmationBar = bar; shutter = shot; cancelButton = cancel; retakeButton = retake; useButton = use
        observers.append(NotificationCenter.default.addObserver(forName: .AVCaptureSessionRuntimeError, object: session, queue: .main) { notice in
            let message = (notice.userInfo?[AVCaptureSessionErrorKey] as? Error)?.localizedDescription ?? "相机意外停止，请重试。"
            Task { @MainActor in if !self.finished { self.finish("error", message: message) } }
        })
        panel.center(); panel.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
        startCamera()
    }
    func startCamera() {
        guard let device = camera else { return }
        let running = session, output = photoOutput
        // On macOS, startRunning can replace the format selected during initial
        // configuration. Apply the native 4:3 preference after each start, then
        // obtain photo dimensions from the actual active format, not the wish.
        let preferred = device.formats.filter {
            let size = CMVideoFormatDescriptionGetDimensions($0.formatDescription)
            return size.height > 0 && abs(Double(size.width) / Double(size.height) - 4.0 / 3.0) < 0.03
        }.max(by: {
            let a = CMVideoFormatDescriptionGetDimensions($0.formatDescription), b = CMVideoFormatDescriptionGetDimensions($1.formatDescription)
            return Int(a.width) * Int(a.height) < Int(b.width) * Int(b.height)
        })
        cameraQueue.async {
            running.startRunning()
            do {
                if let preferred {
                    try device.lockForConfiguration()
                    device.activeFormat = preferred
                    device.unlockForConfiguration()
                }
                guard let dimensions = device.activeFormat.supportedMaxPhotoDimensions.max(by: { Int($0.width) * Int($0.height) < Int($1.width) * Int($1.height) }) else {
                    Task { @MainActor in self.finish("error", message: "当前相机格式不支持拍照，请重试。") }; return
                }
                output.maxPhotoDimensions = dimensions
                Task { @MainActor in
                    if !self.finished && self.captured == nil && !self.capturing { self.shutter?.isEnabled = true }
                }
            } catch {
                let message = error.localizedDescription
                Task { @MainActor in self.finish("error", message: "无法配置相机：" + message) }
            }
        }
    }
    @objc func takePhoto() {
        guard !finished, !capturing, captured == nil, shutter?.isEnabled == true else { return }
        capturing = true; shutter?.isEnabled = false
        let settings = AVCapturePhotoSettings()
        settings.maxPhotoDimensions = photoOutput.maxPhotoDimensions
        photoOutput.capturePhoto(with: settings, delegate: self)
    }
    nonisolated func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        let data = photo.fileDataRepresentation(), message = error?.localizedDescription
        Task { @MainActor in self.showPhoto(data, message: message) }
    }
    nonisolated func photoOutput(_ output: AVCapturePhotoOutput, didFinishCaptureFor resolvedSettings: AVCaptureResolvedPhotoSettings, error: Error?) {
        guard let message = error?.localizedDescription else { return }
        Task { @MainActor in if !self.finished && self.capturing { self.finish("error", message: "拍摄失败：" + message) } }
    }
    func showPhoto(_ data: Data?, message: String?) {
        guard !finished else { return }
        guard message == nil, let data, let source = CGImageSourceCreateWithData(data as CFData, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int, let height = properties[kCGImagePropertyPixelHeight] as? Int,
              width > 0, height > 0, width <= 14400, height <= 14400, width * height <= 32_000_000,
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: 14400] as CFDictionary) else {
            finish("error", message: message ?? "拍摄图片无效或尺寸过大，请重拍。"); return
        }
        capturing = false; captured = image
        photoView?.image = NSImage(cgImage: image, size: NSSize(width: image.width, height: image.height))
        preview?.isHidden = true; photoView?.isHidden = false; confirmationBar?.isHidden = false
        shutter?.isHidden = true; cancelButton?.isHidden = true; retakeButton?.isHidden = false; useButton?.isHidden = false
        let running = session; cameraQueue.async { running.stopRunning() }
    }
    @objc func retakePhoto() {
        guard !finished, captured != nil else { return }
        captured = nil; photoView?.image = nil; photoView?.isHidden = true; preview?.isHidden = false; confirmationBar?.isHidden = true
        shutter?.isHidden = false; shutter?.isEnabled = false; cancelButton?.isHidden = false; retakeButton?.isHidden = true; useButton?.isHidden = true
        startCamera()
    }
    @objc func usePhoto() {
        guard !finished, let image = captured else { return }
        useButton?.isEnabled = false
        guard let encoder = CGImageDestinationCreateWithURL(output.appendingPathComponent("0000.png") as CFURL, UTType.png.identifier as CFString, 1, nil) else {
            finish("error", message: "无法保存拍摄图片，请重拍。"); return
        }
        CGImageDestinationAddImage(encoder, image, nil)
        guard CGImageDestinationFinalize(encoder) else { finish("error", message: "无法保存拍摄图片，请重拍。"); return }
        finish("selected")
    }
}

@main struct Launcher {
    @MainActor static func main() {
        guard CommandLine.arguments.count == 2 else { exit(2) }
        let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: output.path, isDirectory: &isDirectory), isDirectory.boolValue else { exit(2) }
        let application = NSApplication.shared, host = CameraPickerHost(output: output)
        application.setActivationPolicy(.accessory); application.delegate = host
        withExtendedLifetime(host) { application.run() }
    }
}
