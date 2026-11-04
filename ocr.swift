import Foundation
import Vision
import AppKit
import CoreImage

// MarginStudy OCR helper — macOS Vision framework
// Usage: swift ocr.swift <image-path>
// Output: JSON array of { text, x, y, w, h, conf }

guard CommandLine.arguments.count > 1 else {
    print("[]")
    exit(0)
}

let imagePath = CommandLine.arguments[1]

func loadCGImage(path: String) -> CGImage? {
    if let nsImage = NSImage(contentsOfFile: path),
       let cgImage = nsImage.cgImage(forProposedRect: nil, context: nil, hints: nil) {
        return cgImage
    }
    // Fallback via CoreImage
    guard let ciImage = CIImage(contentsOf: URL(fileURLWithPath: path)) else { return nil }
    let context = CIContext(options: nil)
    return context.createCGImage(ciImage, from: ciImage.extent)
}

guard let cgImage = loadCGImage(path: imagePath) else {
    print("[]")
    exit(0)
}

let request = VNRecognizeTextRequest()
request.recognitionLanguages = ["zh-Hans", "en-US"]
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
try? handler.perform([request])

var results: [[String: Any]] = []
if let observations = request.results {
    for obs in observations {
        guard let candidate = obs.topCandidates(1).first else { continue }
        let box = obs.boundingBox
        results.append([
            "text": candidate.string,
            "x": box.origin.x,
            "y": box.origin.y,
            "w": box.width,
            "h": box.height,
            "conf": candidate.confidence,
        ])
    }
}

let data = try! JSONSerialization.data(withJSONObject: results, options: [])
print(String(data: data, encoding: .utf8)!)
