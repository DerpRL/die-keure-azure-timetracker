// Draws the tray icons committed under `icons/tray/`.
//
//   swift scripts/draw-tray-icons.swift icons/tray
//
// macos-template.png  18 pt (36 px) monochrome template image for the menu bar. It is the 16-pt
//                     clock from MenuBarController.menuClock() in the 1.14 Swift app, centred on
//                     the 18-pt canvas because tray-icon always sizes the menu-bar image to 18 pt.
// <state>-16.png      Coloured tray icons for Windows: 16 px for 100 % scaling, 32 px above. Each
// <state>-32.png      state has its own colour and its own glyph, so it never depends on colour
//                     alone. The 16-px set drops the ring around glyphs that would not be legible
//                     inside it (pause, exclamation mark, question mark).
import AppKit

let destination = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icons/tray")
try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!

func render(pixels: Int, name: String, draw: (CGFloat) -> Void) throws {
    let context = CGContext(data: nil, width: pixels, height: pixels, bitsPerComponent: 8, bytesPerRow: 0,
                            space: sRGB, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
    draw(CGFloat(pixels))
    NSGraphicsContext.restoreGraphicsState()
    let bitmap = NSBitmapImageRep(cgImage: context.makeImage()!)
    try bitmap.representation(using: .png, properties: [:])!.write(to: destination.appendingPathComponent(name))
}

func color(_ hex: UInt32) -> NSColor {
    NSColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
}

// macOS: port of MenuBarController.menuClock(), drawn at 2x and offset by 1 pt.
try render(pixels: 36, name: "macos-template.png") { _ in
    NSGraphicsContext.current!.cgContext.scaleBy(x: 2, y: 2)
    NSGraphicsContext.current!.cgContext.translateBy(x: 1, y: 1)
    NSColor.black.setStroke()
    let ring = NSBezierPath(ovalIn: NSRect(x: 1.75, y: 1.75, width: 12.5, height: 12.5))
    ring.lineWidth = 1.5; ring.stroke()
    let hands = NSBezierPath()
    hands.lineWidth = 1.5; hands.lineCapStyle = .round; hands.lineJoinStyle = .round
    hands.move(to: NSPoint(x: 8, y: 11.5)); hands.line(to: NSPoint(x: 8, y: 8))
    hands.line(to: NSPoint(x: 5.25, y: 8)); hands.stroke()
}

enum Glyph { case hands, pause, exclamation, connecting, question }

struct TrayState {
    let name: String
    let tile: UInt32
    let ink: UInt32
    let glyph: Glyph
}

// Colours: running green, paused amber, stopped neutral (the app icon backdrop), disconnected
// orange warning, connecting slate, attention violet. Ink keeps at least 3:1 against the tile.
let states = [
    TrayState(name: "running", tile: 0x1A7F37, ink: 0xFFFFFF, glyph: .hands),
    TrayState(name: "paused", tile: 0xF5A623, ink: 0x1F2124, glyph: .pause),
    TrayState(name: "stopped", tile: 0x1F2124, ink: 0xFFFFFF, glyph: .hands),
    TrayState(name: "disconnected", tile: 0xD9480F, ink: 0xFFFFFF, glyph: .exclamation),
    TrayState(name: "connecting", tile: 0x5B6B7F, ink: 0xFFFFFF, glyph: .connecting),
    TrayState(name: "attention", tile: 0x7B4FD6, ink: 0xFFFFFF, glyph: .question),
]

for state in states {
    for pixels in [16, 32] {
        try render(pixels: pixels, name: "\(state.name)-\(pixels).png") { size in
            let small = pixels < 24
            let unit = size / 32
            let tile = NSBezierPath(roundedRect: NSRect(x: unit, y: unit, width: size - 2 * unit, height: size - 2 * unit),
                                    xRadius: 7 * unit, yRadius: 7 * unit)
            color(state.tile).setFill(); tile.fill()

            let ink = color(state.ink)
            ink.setStroke(); ink.setFill()
            let stroke: CGFloat = small ? 1.5 : 2.25
            let center = NSPoint(x: size / 2, y: size / 2)
            let radius = small ? 5 : 9 * unit

            func line(_ from: NSPoint, _ to: NSPoint, width: CGFloat) {
                let path = NSBezierPath()
                path.lineWidth = width; path.lineCapStyle = .round; path.lineJoinStyle = .round
                path.move(to: from); path.line(to: to); path.stroke()
            }
            func dot(_ at: NSPoint, diameter: CGFloat) {
                NSBezierPath(ovalIn: NSRect(x: at.x - diameter / 2, y: at.y - diameter / 2, width: diameter, height: diameter)).fill()
            }
            func ring(gap: Bool) {
                let path = NSBezierPath()
                path.lineWidth = stroke; path.lineCapStyle = .round
                // Counter-clockwise from 12 o'clock to 3 o'clock: the connecting state leaves the
                // top-right quarter of the ring open.
                path.appendArc(withCenter: center, radius: radius, startAngle: gap ? 90 : 0, endAngle: 360)
                path.stroke()
            }
            func hands() {
                // Same proportions as the menu-bar clock: minute hand up, hour hand left.
                let path = NSBezierPath()
                path.lineWidth = stroke; path.lineCapStyle = .round; path.lineJoinStyle = .round
                path.move(to: NSPoint(x: center.x, y: center.y + 0.56 * radius))
                path.line(to: center)
                path.line(to: NSPoint(x: center.x - 0.44 * radius, y: center.y))
                path.stroke()
            }

            switch state.glyph {
            case .hands:
                ring(gap: false); hands()
            case .connecting:
                ring(gap: true); hands()
            case .pause:
                if small {
                    for x in [center.x - 2, center.x + 2] { line(NSPoint(x: x, y: 4.5), NSPoint(x: x, y: 11.5), width: 2) }
                } else {
                    ring(gap: false)
                    for offset in [-0.3 * radius, 0.3 * radius] {
                        line(NSPoint(x: center.x + offset, y: center.y - 0.38 * radius),
                             NSPoint(x: center.x + offset, y: center.y + 0.38 * radius), width: stroke)
                    }
                }
            case .exclamation:
                if small {
                    line(NSPoint(x: center.x, y: 12), NSPoint(x: center.x, y: 7), width: 2.25)
                    dot(NSPoint(x: center.x, y: 4.25), diameter: 2.5)
                } else {
                    ring(gap: false)
                    line(NSPoint(x: center.x, y: center.y + 0.48 * radius), NSPoint(x: center.x, y: center.y - 0.08 * radius), width: stroke)
                    dot(NSPoint(x: center.x, y: center.y - 0.46 * radius), diameter: stroke * 1.15)
                }
            case .question:
                if !small { ring(gap: false) }
                let font = NSFont.systemFont(ofSize: small ? 13 : 1.3 * radius, weight: .heavy)
                let text = NSAttributedString(string: "?", attributes: [.font: font, .foregroundColor: ink])
                let bounds = text.boundingRect(with: NSSize(width: size, height: size), options: [.usesDeviceMetrics])
                text.draw(at: NSPoint(x: center.x - bounds.width / 2 - bounds.minX, y: center.y - bounds.height / 2 - bounds.minY))
            }
        }
    }
}
