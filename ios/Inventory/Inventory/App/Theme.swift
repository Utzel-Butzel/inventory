import SwiftUI

enum InventoryTheme {
    static let accent = Color(red: 0.37, green: 0.82, blue: 0.49)
    static let lime = Color(red: 0.87, green: 1.0, blue: 0.44)
    static let canvas = Color(red: 0.956, green: 0.963, blue: 0.94)
    static let ink = Color(red: 0.11, green: 0.13, blue: 0.10)
}

struct InventoryCardModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(16)
            .background(.background, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .stroke(.primary.opacity(0.08), lineWidth: 1)
            }
    }
}

extension View {
    func inventoryCard() -> some View { modifier(InventoryCardModifier()) }
}
