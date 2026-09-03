import XCTest
@testable import Inventory

final class MarkdownDocumentTests: XCTestCase {
    func testParsesTheMarkdownBlocksSupportedByTheWebDescriptionRenderer() {
        let document = MarkdownDocument(markdown: """
        # Überschrift

        Ein **wichtiger** Absatz
        mit [Link](https://example.com).

        - Erster Punkt
        - Zweiter Punkt

        3. Dritter Punkt
        4. Vierter Punkt

        > Ein Zitat
        > über zwei Zeilen

        ---

        ![Produktfoto](/api/files/photo.jpg)
        """)

        XCTAssertEqual(document.blocks, [
            .heading(level: 1, text: "Überschrift"),
            .paragraph("Ein **wichtiger** Absatz\nmit [Link](https://example.com)."),
            .unorderedList(["Erster Punkt", "Zweiter Punkt"]),
            .orderedList(start: 3, items: ["Dritter Punkt", "Vierter Punkt"]),
            .blockQuote("Ein Zitat über zwei Zeilen"),
            .horizontalRule,
            .image(altText: "Produktfoto", source: "/api/files/photo.jpg"),
        ])
    }

    func testDoesNotTreatIncompleteMarkdownAsAFormattingBlock() {
        let document = MarkdownDocument(markdown: "#Ohne Abstand\n-Ohne Abstand\n![ohne URL]()")

        XCTAssertEqual(
            document.blocks,
            [.paragraph("#Ohne Abstand\n-Ohne Abstand\n![ohne URL]()")]
        )
    }

    func testInlineFormattingRemovesMarkdownAndUnderlineTagsFromVisibleText() {
        let formatted = MarkdownInlineFormatter.attributedString(
            from: "**Fett**, *kursiv* und <u>unterstrichen</u>",
            baseURL: nil
        )

        XCTAssertEqual(String(formatted.characters), "Fett, kursiv und unterstrichen")
    }

    func testUnsafeInlineLinksAreNotInteractive() {
        let formatted = MarkdownInlineFormatter.attributedString(
            from: "[Unsicher](javascript:alert(1))",
            baseURL: URL(string: "https://inventory.example")
        )

        XCTAssertTrue(formatted.runs.allSatisfy { $0.link == nil })
    }
}
