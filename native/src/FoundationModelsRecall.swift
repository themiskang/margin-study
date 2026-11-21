import Foundation
import FoundationModels

private struct RecallRequest: Codable {
    let title: String?
    let parentTitle: String?
    let keywords: [String]
    let excerpt: String
    let excerptLength: Int
    let hasImage: Bool
    let language: String?
}

private struct RecallResponse: Codable {
    let lines: [String]?
    let error: String?
    let availability: String?
}

private func emit(_ response: RecallResponse) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.withoutEscapingSlashes]
    if let data = try? encoder.encode(response), let text = String(data: data, encoding: .utf8) {
        print(text)
    } else {
        print("{\"error\":\"encoding-failed\"}")
    }
}

@main
struct FoundationModelsRecall {
    static func main() async {
        guard CommandLine.arguments.count == 2,
              let data = Data(base64Encoded: CommandLine.arguments[1]),
              let request = try? JSONDecoder().decode(RecallRequest.self, from: data) else {
            emit(RecallResponse(lines: nil, error: "invalid-request", availability: nil))
            return
        }

        let model = SystemLanguageModel.default
        guard case .available = model.availability else {
            emit(RecallResponse(lines: nil, error: "model-unavailable", availability: String(describing: model.availability)))
            return
        }

        let language = request.language == "en" ? "English" : "Simplified Chinese"
        let context = [
            request.title.map { "Title: \($0)" },
            request.parentTitle.map { "Parent: \($0)" },
            request.keywords.isEmpty ? nil : "Keywords: \(request.keywords.prefix(6).joined(separator: ", "))",
            "Excerpt length: \(request.excerptLength)",
            request.hasImage ? "The source includes an image or area excerpt." : "Source: \(request.excerpt)",
        ].compactMap { $0 }.joined(separator: "\n")
        let prompt = """
        Create at most three concise recall hints in \(language).
        Do not reveal the answer, do not repeat the excerpt, and do not add labels or numbering.
        Use only this local study context:
        \(context)
        """

        do {
            let session = LanguageModelSession(model: model)
            let response = try await session.respond(to: prompt)
            let lines = response.content
                .split(whereSeparator: { $0 == "\n" || $0 == "\r" })
                .map { line in
                    line.replacingOccurrences(of: #"^[-*#0-9.\s]+"#, with: "", options: .regularExpression)
                        .trimmingCharacters(in: .whitespacesAndNewlines)
                }
                .filter { !$0.isEmpty && $0.count <= 320 }
            emit(RecallResponse(lines: Array(lines.prefix(4)), error: nil, availability: nil))
        } catch {
            emit(RecallResponse(lines: nil, error: String(describing: error), availability: nil))
        }
    }
}
