import AppKit
import SwiftUI

/// Accounts for the transformed size in layout, so enlarged controls keep their hit areas and can scroll.
private struct InterfaceScaleLayout: Layout {
    var scale: CGFloat
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard let content = subviews.first else { return .zero }
        let size = content.sizeThatFits(ProposedViewSize(width: proposal.width.map { $0 / scale }, height: proposal.height.map { $0 / scale }))
        return CGSize(width: size.width * scale, height: size.height * scale)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        subviews.first?.place(at: bounds.origin, anchor: .topLeading,
            proposal: ProposedViewSize(width: bounds.width / scale, height: bounds.height / scale))
    }
}
struct ScaledInterface<Content: View>: View {
    var scale: CGFloat
    @ViewBuilder var content: Content
    var body: some View { InterfaceScaleLayout(scale: scale) { content.scaleEffect(scale, anchor: .topLeading) } }
}

private struct WindowAppearanceBridge: NSViewRepresentable {
    let appearance: NSAppearance
    final class AppearanceView: NSView {
        var chosenAppearance: NSAppearance?
        override func viewDidMoveToWindow() { super.viewDidMoveToWindow(); window?.appearance = chosenAppearance }
    }
    func makeNSView(context: Context) -> AppearanceView { AppearanceView() }
    func updateNSView(_ view: AppearanceView, context: Context) {
        view.chosenAppearance = appearance
        view.window?.appearance = appearance
    }
}
private struct InterfaceAppearanceModifier: ViewModifier {
    @ObservedObject var interface: InterfaceController
    func body(content: Content) -> some View {
        content
            .environment(\.interfacePalette, InterfacePalette(dark: interface.isDark, increased: interface.increasedContrast))
            .background(WindowAppearanceBridge(appearance: interface.appearance).frame(width: 0, height: 0))
    }
}
extension View {
    func interfaceAppearance(_ interface: InterfaceController) -> some View { modifier(InterfaceAppearanceModifier(interface: interface)) }
}

struct AppWindowContent: View {
    @Environment(\.interfacePalette) private var palette

    @ObservedObject var model: AppModel
    @ObservedObject var interface: InterfaceController
    var body: some View {
        GeometryReader { viewport in
            let scale = interface.preferences.scale.factor
            ScrollView([.horizontal, .vertical]) {
                ScaledInterface(scale: scale) {
                    Group {
                        #if UI_PREVIEW
                        if ProcessInfo.processInfo.arguments.contains("--preview-menu") {
                            VStack {
                                Button("Quick switch preview") { model.beginMenuTracking() }
                                MenuPanel(model: model).frame(width: 420)
                            }.padding(20)
                        } else if model.showAppearanceOnboarding { AppearanceOnboardingView(model: model, interface: interface) }
                        else { RootView(model: model) }
                        #else
                        if model.showAppearanceOnboarding { AppearanceOnboardingView(model: model, interface: interface) }
                        else { RootView(model: model) }
                        #endif
                    }.frame(width: max(model.showAppearanceOnboarding ? 560 : 1040, viewport.size.width / scale), height: max(720, viewport.size.height / scale))
                }
            }.scrollBounceBehavior(.basedOnSize)
        }.background(palette.background).tint(palette.accent).interfaceAppearance(interface)
    }
}

struct AppMenuContent: View {
    @Environment(\.interfacePalette) private var palette

    @ObservedObject var model: AppModel
    @ObservedObject var interface: InterfaceController
    var body: some View {
        let scale = interface.preferences.scale.factor
        let availableHeight = (NSScreen.main?.visibleFrame.height ?? 800) - 80
        ScaledInterface(scale: scale) {
            MenuPanel(model: model, maximumHeight: min(720, availableHeight / scale))
                .frame(width: 420).fixedSize(horizontal: false, vertical: true)
                .tint(palette.accent).controlSize(.large).buttonStyle(.bordered)
        }.interfaceAppearance(interface)
    }
}

private struct InterfaceSheetSizeKey: PreferenceKey {
    static let defaultValue = CGSize.zero
    static func reduce(value: inout CGSize, nextValue: () -> CGSize) { value = nextValue() }
}
/// Separate presentations do not inherit a view transform. Measure their natural size, then keep
/// the full zoomed content reachable by scrolling when a sheet would exceed the current display.
struct InterfaceSheet<Content: View>: View {
    @Environment(\.interfacePalette) private var palette

    @ObservedObject var interface: InterfaceController
    @ViewBuilder var content: Content
    @ViewState private var contentSize = CGSize(width: 640, height: 480)
    var body: some View {
        let scale = interface.preferences.scale.factor
        let screen = NSScreen.main?.visibleFrame.size ?? CGSize(width: 1280, height: 800)
        ScrollView([.horizontal, .vertical]) {
            ScaledInterface(scale: scale) {
                content.fixedSize(horizontal: true, vertical: true)
                    .background(GeometryReader { geometry in Color.clear.preference(key: InterfaceSheetSizeKey.self, value: geometry.size) })
            }
        }.scrollBounceBehavior(.basedOnSize)
            .frame(width: min(contentSize.width * scale, screen.width - 80), height: min(contentSize.height * scale, screen.height - 120))
            .onPreferenceChange(InterfaceSheetSizeKey.self) { size in
                if size.width.isFinite, size.height.isFinite, size.width > 0, size.height > 0, contentSize != size { contentSize = size }
            }.background(palette.background).interfaceAppearance(interface)
    }
}
