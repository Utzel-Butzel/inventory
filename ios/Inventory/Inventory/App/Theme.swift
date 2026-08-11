import SwiftUI

enum InventoryTheme {
    /// Interactive green for controls and text on light surfaces (WCAG 4.5:1+).
    static let accent = Color(red: 0.078, green: 0.478, blue: 0.259)
    /// Brighter brand green reserved for icons and controls on dark surfaces.
    static let highlight = Color(red: 0.37, green: 0.82, blue: 0.49)
    static let lime = Color(red: 0.87, green: 1.0, blue: 0.44)
    static let canvas = Color(red: 0.956, green: 0.963, blue: 0.94)
    static let ink = Color(red: 0.11, green: 0.13, blue: 0.10)
    static let success = accent
    static let warning = Color(red: 0.541, green: 0.294, blue: 0.0)
    static let danger = Color(red: 0.706, green: 0.137, blue: 0.094)
    static let info = Color(red: 0.239, green: 0.298, blue: 0.639)
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
