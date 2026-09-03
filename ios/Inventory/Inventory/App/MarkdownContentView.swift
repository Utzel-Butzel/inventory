import SwiftUI

enum MarkdownBlock: Equatable, Sendable {
    case heading(level: Int, text: String)
    case paragraph(String)
    case unorderedList([String])
    case orderedList(start: Int, items: [String])
    case blockQuote(String)
    case horizontalRule
    case image(altText: String, source: String)
}

struct MarkdownDocument: Equatable, Sendable {
    let blocks: [MarkdownBlock]

    init(markdown: String) {
        let normalized = markdown.replacingOccurrences(of: "\r\n", with: "\n")
        let lines = normalized.split(separator: "\n", omittingEmptySubsequences: false)
            .map(String.init)
        var parsedBlocks: [MarkdownBlock] = []
        var index = 0

        while index < lines.count {
            let line = lines[index]
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            if trimmed.isEmpty {
                index += 1
                continue
            }

            if let image = Self.image(from: trimmed) {
                parsedBlocks.append(.image(altText: image.altText, source: image.source))
                index += 1
                continue
            }

            if let heading = Self.heading(from: trimmed) {
                parsedBlocks.append(.heading(level: heading.level, text: heading.text))
                index += 1
                continue
            }

            if Self.unorderedListItem(from: trimmed) != nil {
                var items: [String] = []
                while index < lines.count,
                      let item = Self.unorderedListItem(
                        from: lines[index].trimmingCharacters(in: .whitespaces)
                      ) {
                    items.append(item)
                    index += 1
                }
                parsedBlocks.append(.unorderedList(items))
                continue
            }

            if let firstItem = Self.orderedListItem(from: trimmed) {
                var items: [String] = []
                while index < lines.count,
                      let item = Self.orderedListItem(
                        from: lines[index].trimmingCharacters(in: .whitespaces)
                      ) {
                    items.append(item.text)
                    index += 1
                }
                parsedBlocks.append(.orderedList(start: firstItem.number, items: items))
                continue
            }

            if Self.quoteText(from: trimmed) != nil {
                var quoteLines: [String] = []
                while index < lines.count,
                      let quote = Self.quoteText(
                        from: lines[index].trimmingCharacters(in: .whitespaces)
                      ) {
                    quoteLines.append(quote)
                    index += 1
                }
                parsedBlocks.append(.blockQuote(quoteLines.joined(separator: " ")))
                continue
            }

            if Self.isHorizontalRule(trimmed) {
                parsedBlocks.append(.horizontalRule)
                index += 1
                continue
            }

            var paragraphLines: [String] = []
            while index < lines.count {
                let candidate = lines[index].trimmingCharacters(in: .whitespaces)
                guard !candidate.isEmpty, !Self.isBlockStart(candidate) else { break }
                paragraphLines.append(candidate)
                index += 1
            }
            parsedBlocks.append(.paragraph(paragraphLines.joined(separator: "\n")))
        }

        blocks = parsedBlocks
    }

    private static func isBlockStart(_ line: String) -> Bool {
        image(from: line) != nil ||
            heading(from: line) != nil ||
            unorderedListItem(from: line) != nil ||
            orderedListItem(from: line) != nil ||
            quoteText(from: line) != nil ||
            isHorizontalRule(line)
    }

    private static func heading(from line: String) -> (level: Int, text: String)? {
        var level = 0
        var cursor = line.startIndex
        while cursor < line.endIndex, line[cursor] == "#", level < 6 {
            level += 1
            cursor = line.index(after: cursor)
        }
        guard level > 0,
              cursor < line.endIndex,
              line[cursor].isWhitespace else { return nil }
        let text = line[cursor...].trimmingCharacters(in: .whitespaces)
        return (level, text)
    }

    private static func unorderedListItem(from line: String) -> String? {
        guard let marker = line.first,
              ["-", "*", "+"].contains(marker) else { return nil }
        let afterMarker = line.index(after: line.startIndex)
        guard afterMarker < line.endIndex, line[afterMarker].isWhitespace else { return nil }
        return line[afterMarker...].trimmingCharacters(in: .whitespaces)
    }

    private static func orderedListItem(from line: String) -> (number: Int, text: String)? {
        var cursor = line.startIndex
        while cursor < line.endIndex, line[cursor].isNumber {
            cursor = line.index(after: cursor)
        }
        guard cursor > line.startIndex,
              cursor < line.endIndex,
              line[cursor] == "." else { return nil }
        let numberText = String(line[..<cursor])
        cursor = line.index(after: cursor)
        guard cursor < line.endIndex, line[cursor].isWhitespace,
              let number = Int(numberText) else { return nil }
        return (number, line[cursor...].trimmingCharacters(in: .whitespaces))
    }

    private static func quoteText(from line: String) -> String? {
        guard line.first == ">" else { return nil }
        return line.dropFirst().trimmingCharacters(in: .whitespaces)
    }

    private static func isHorizontalRule(_ line: String) -> Bool {
        line.count >= 3 && line.allSatisfy { $0 == "-" }
    }

    private static func image(from line: String) -> (altText: String, source: String)? {
        guard line.hasPrefix("!["), line.hasSuffix(")"),
              let separator = line.range(of: "](") else { return nil }
        let altStart = line.index(line.startIndex, offsetBy: 2)
        let sourceStart = separator.upperBound
        let sourceEnd = line.index(before: line.endIndex)
        guard altStart <= separator.lowerBound, sourceStart <= sourceEnd else { return nil }
        let source = line[sourceStart..<sourceEnd].trimmingCharacters(in: .whitespaces)
        guard !source.isEmpty else { return nil }
        return (String(line[altStart..<separator.lowerBound]), source)
    }
}

enum MarkdownInlineFormatter {
    static func attributedString(from markdown: String, baseURL: URL?) -> AttributedString {
        var result = AttributedString()
        var remainder = markdown[...]

        while let openingTag = remainder.range(of: "<u>"),
              let closingTag = remainder[openingTag.upperBound...].range(of: "</u>") {
            result.append(parse(String(remainder[..<openingTag.lowerBound]), baseURL: baseURL))
            var underlined = parse(
                String(remainder[openingTag.upperBound..<closingTag.lowerBound]),
                baseURL: baseURL
            )
            underlined.underlineStyle = .single
            result.append(underlined)
            remainder = remainder[closingTag.upperBound...]
        }

        result.append(parse(String(remainder), baseURL: baseURL))
        return result
    }

    private static func parse(_ markdown: String, baseURL: URL?) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(
            interpretedSyntax: .inlineOnlyPreservingWhitespace,
            failurePolicy: .returnPartiallyParsedIfPossible
        )
        var result = (try? AttributedString(
            markdown: markdown,
            options: options,
            baseURL: baseURL
        )) ?? AttributedString(markdown)

        let links = result.runs.compactMap { run -> (Range<AttributedString.Index>, URL)? in
            guard let link = run.link else { return nil }
            return (run.range, link)
        }
        for (range, link) in links where !isSafe(link) {
            result[range].link = nil
        }
        return result
    }

    private static func isSafe(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased() else { return false }
        return ["http", "https", "mailto"].contains(scheme)
    }
}

struct MarkdownContentView: View {
    let markdown: String
    var client: APIClient?
    var media: [InventoryMedia]

    init(markdown: String, client: APIClient? = nil, media: [InventoryMedia] = []) {
        self.markdown = markdown
        self.client = client
        self.media = media
    }

    private var document: MarkdownDocument { MarkdownDocument(markdown: markdown) }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(document.blocks.enumerated()), id: \.offset) { index, block in
                blockView(block, isFirst: index == 0)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .tint(InventoryTheme.accent)
        .textSelection(.enabled)
    }

    @ViewBuilder
    private func blockView(_ block: MarkdownBlock, isFirst: Bool) -> some View {
        switch block {
        case let .heading(level, text):
            MarkdownInlineText(markdown: text, baseURL: client?.serverURL)
                .font(headingFont(level))
                .foregroundStyle(.primary)
                .padding(.top, isFirst ? 0 : 4)
        case let .paragraph(text):
            MarkdownInlineText(markdown: text, baseURL: client?.serverURL)
                .font(.body)
                .foregroundStyle(.secondary)
                .lineSpacing(3)
        case let .unorderedList(items):
            VStack(alignment: .leading, spacing: 7) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    listItem(marker: "•", markdown: item, markerWidth: 14)
                }
            }
        case let .orderedList(start, items):
            VStack(alignment: .leading, spacing: 7) {
                ForEach(Array(items.enumerated()), id: \.offset) { offset, item in
                    listItem(marker: "\(start + offset).", markdown: item, markerWidth: 30)
                }
            }
        case let .blockQuote(text):
            HStack(alignment: .top, spacing: 11) {
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(.secondary.opacity(0.35))
                    .frame(width: 4)
                MarkdownInlineText(markdown: text, baseURL: client?.serverURL)
                    .font(.body.italic())
                    .foregroundStyle(.secondary)
                    .lineSpacing(3)
                    .padding(.vertical, 3)
            }
            .fixedSize(horizontal: false, vertical: true)
        case .horizontalRule:
            Divider().padding(.vertical, 4)
        case let .image(altText, source):
            MarkdownDescriptionImage(
                source: source,
                altText: altText,
                client: client,
                media: media
            )
        }
    }

    private func listItem(marker: String, markdown: String, markerWidth: CGFloat) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(marker)
                .font(.body.monospacedDigit())
                .foregroundStyle(.secondary)
                .frame(width: markerWidth, alignment: .trailing)
            MarkdownInlineText(markdown: markdown, baseURL: client?.serverURL)
                .font(.body)
                .foregroundStyle(.secondary)
                .lineSpacing(3)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func headingFont(_ level: Int) -> Font {
        switch level {
        case 1: .title2.weight(.semibold)
        case 2: .title3.weight(.semibold)
        case 3: .headline
        case 4: .subheadline.weight(.semibold)
        case 5: .footnote.weight(.semibold)
        default: .caption.weight(.semibold)
        }
    }
}

private struct MarkdownInlineText: View {
    let markdown: String
    let baseURL: URL?

    var body: some View {
        Text(MarkdownInlineFormatter.attributedString(from: markdown, baseURL: baseURL))
    }
}

private struct MarkdownDescriptionImage: View {
    let source: String
    let altText: String
    let client: APIClient?
    let media: [InventoryMedia]

    var body: some View {
        Group {
            if let client, let matchedMedia {
                AuthenticatedInventoryImage(media: matchedMedia, client: client)
            } else if let imageURL {
                AsyncImage(url: imageURL) { phase in
                    ZStack {
                        Rectangle().fill(.secondary.opacity(0.08))
                        switch phase {
                        case let .success(image):
                            image.resizable().scaledToFit()
                        case .failure:
                            imagePlaceholder
                        case .empty:
                            ProgressView()
                        @unknown default:
                            imagePlaceholder
                        }
                    }
                }
            } else {
                ZStack {
                    Rectangle().fill(.secondary.opacity(0.08))
                    imagePlaceholder
                }
            }
        }
        .frame(maxWidth: .infinity)
        .aspectRatio(imageAspectRatio, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(.primary.opacity(0.08), lineWidth: 1)
        }
        .accessibilityLabel(altText.isEmpty ? "Bild in der Beschreibung" : altText)
    }

    private var matchedMedia: InventoryMedia? {
        if let exactMatch = media.first(where: { $0.url == source }) {
            return exactMatch
        }
        guard let client, let sourceURL = try? client.resolveMediaURL(source) else { return nil }
        return media.first { item in
            guard let itemURL = try? client.resolveMediaURL(item.url) else { return false }
            return itemURL == sourceURL
        }
    }

    private var imageURL: URL? {
        if let client {
            guard let url = try? client.resolveMediaURL(source), !clientURLRequiresAuthentication(url)
            else { return nil }
            return url
        }
        guard let url = URL(string: source),
              ["http", "https"].contains(url.scheme?.lowercased() ?? "") else { return nil }
        return url
    }

    private func clientURLRequiresAuthentication(_ url: URL) -> Bool {
        guard let client else { return false }
        return url.scheme?.lowercased() == client.serverURL.scheme?.lowercased() &&
            url.host?.lowercased() == client.serverURL.host?.lowercased() &&
            url.port == client.serverURL.port
    }

    private var imageAspectRatio: CGFloat {
        guard let width = matchedMedia?.width,
              let height = matchedMedia?.height,
              width > 0,
              height > 0 else { return 16 / 9 }
        return CGFloat(width) / CGFloat(height)
    }

    private var imagePlaceholder: some View {
        VStack(spacing: 7) {
            Image(systemName: "photo")
                .font(.title2)
            if !altText.isEmpty {
                Text(altText)
                    .font(.caption)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
            }
        }
        .foregroundStyle(.secondary)
        .padding()
    }
}
