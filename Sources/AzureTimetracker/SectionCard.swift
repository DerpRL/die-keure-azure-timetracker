import SwiftUI

struct SectionCard<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View { Card { VStack(alignment: .leading, spacing: 16) { content } } }
}
