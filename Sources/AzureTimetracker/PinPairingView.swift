import SwiftUI
import AzureTimetrackerCore

struct PinPairingView: View {
    @ObservedObject var pairing: PinPairingModel
    let workspace: String
    let disabled: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Pair this Mac using 7pace’s mobile PIN flow. Generate a PIN here, then enter it on the 7pace Apps page in Azure DevOps.")
                .font(.callout).foregroundStyle(Palette.secondary)
            if let pin = pairing.pin {
                Text(pin).font(.system(size: 30, weight: .semibold, design: .monospaced))
                    .textSelection(.enabled).accessibilityLabel("7pace pairing PIN").accessibilityValue(pin)
                if let deadline = pairing.expiresAt {
                    Text("Valid until " + deadline.formatted(date: .omitted, time: .standard)).font(.callout)
                }
            }
            HStack {
                Button(pairing.busy ? "Requesting / waiting…" : "Generate pairing PIN") { pairing.begin(workspace: workspace) }
                    .disabled(disabled || pairing.busy || workspace.isEmpty)
                if pairing.busy { Button("Cancel pairing") { pairing.cancel() } }
            }
            if let status = pairing.status { Text(status).font(.callout).textSelection(.enabled) }
            Text("The PIN lasts one minute. After approval, sign-in and renewal credentials are saved in Keychain immediately. Your Azure PAT is still used for ticket details.")
                .font(.callout).foregroundStyle(Palette.secondary)
        }
        .onChange(of: workspace) { _, _ in pairing.cancel() }
        .onDisappear { if pairing.busy { pairing.cancel() } }
    }
}
