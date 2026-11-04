// Draws the DMG window background (660 × 400 points) at 1x and 2x as PNG files.
// Usage: swift draw-dmg-background.swift <output-dir>
// `regenerate-dmg-background.sh` joins them into the committed `dmg-background.tiff`.
//
// The look is the "DMG background" board of the 2.0 design canvas (Soft Neutral): a light page,
// a white tile for the app, a dashed tile for Applications and a dotted arrow between them. The
// layout matches `macos/dmg.rs`: 104 pt icons centred at (165, 198) and (495, 198).
//
// Finder draws the icon names itself, below the icons and inside the tiles. The version is in
// the window title (the volume name), so the picture needs no regeneration per release.

import AppKit

let width: CGFloat = 660
let height: CGFloat = 400
let appCenter = CGPoint(x: 165, y: 198)
let applicationsCenter = CGPoint(x: 495, y: 198)

func color(_ hex: UInt32, _ alpha: CGFloat = 1) -> NSColor {
    NSColor(
        srgbRed: CGFloat((hex >> 16) & 0xff) / 255,
        green: CGFloat((hex >> 8) & 0xff) / 255,
        blue: CGFloat(hex & 0xff) / 255,
        alpha: alpha)
}

/// Draws `text` centred on `x` with its top at `top` (top-left origin coordinates).
@discardableResult
func drawCentered(_ text: String, x: CGFloat, top: CGFloat, font: NSFont, color: NSColor, kern: CGFloat = 0) -> CGSize {
    let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color, .kern: kern]
    let string = NSAttributedString(string: text, attributes: attributes)
    let size = string.size()
    string.draw(at: CGPoint(x: x - size.width / 2, y: top))
    return size
}

func circle(center: CGPoint, radius: CGFloat, fill: UInt32) {
    color(fill).setFill()
    NSBezierPath(ovalIn: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)).fill()
}

/// The tile behind an icon: 170 × 186, its top 72 pt above the icon centre (as in the design).
func tileRect(around center: CGPoint) -> CGRect {
    CGRect(x: center.x - 85, y: center.y - 72, width: 170, height: 186)
}

func draw(in context: CGContext) {
    // Page and the two soft circles.
    color(0xf6f7f9).setFill()
    CGRect(x: 0, y: 0, width: width, height: height).fill()
    circle(center: CGPoint(x: 90, y: 50), radius: 210, fill: 0xeff4ff)
    circle(center: CGPoint(x: 570, y: 370), radius: 230, fill: 0xeef0f3)

    // Eyebrow: a blue dot and the product name, centred together.
    let eyebrowFont = NSFont.systemFont(ofSize: 13, weight: .semibold)
    let eyebrow = NSAttributedString(string: "Azure timetracker", attributes: [.font: eyebrowFont])
    let eyebrowWidth = 8 + 8 + eyebrow.size().width
    let eyebrowLeft = width / 2 - eyebrowWidth / 2
    circle(center: CGPoint(x: eyebrowLeft + 4, y: 34 + eyebrow.size().height / 2), radius: 4, fill: 0x2563eb)
    drawCentered("Azure timetracker", x: eyebrowLeft + 16 + eyebrow.size().width / 2, top: 34,
                 font: eyebrowFont, color: color(0x1d4ed8))

    // Heading and the line under it.
    drawCentered("Drag the app to Applications", x: width / 2, top: 56,
                 font: .systemFont(ofSize: 24, weight: .bold), color: color(0x101828), kern: -0.48)
    drawCentered("Then open it from Applications. It lives in your menu bar.", x: width / 2, top: 92,
                 font: .systemFont(ofSize: 14, weight: .regular), color: color(0x475467))

    // App tile: white with a hairline border and a soft shadow.
    let appTile = NSBezierPath(roundedRect: tileRect(around: appCenter), xRadius: 32, yRadius: 32)
    NSGraphicsContext.saveGraphicsState()
    let shadow = NSShadow()
    shadow.shadowColor = color(0x101828, 0.06)
    shadow.shadowBlurRadius = 24
    shadow.shadowOffset = NSSize(width: 0, height: -8) // flipped context: positive y is down
    shadow.set()
    color(0xffffff).setFill()
    appTile.fill()
    NSGraphicsContext.restoreGraphicsState()
    appTile.lineWidth = 1
    color(0xe4e7ec).setStroke()
    appTile.stroke()

    // Applications tile: white with a dashed blue border, the drop target.
    let target = NSBezierPath(roundedRect: tileRect(around: applicationsCenter).insetBy(dx: 1, dy: 1), xRadius: 31, yRadius: 31)
    color(0xffffff).setFill()
    target.fill()
    target.lineWidth = 2
    target.setLineDash([6, 5], count: 2, phase: 0)
    color(0x93b4fd).setStroke()
    target.stroke()

    // Dotted arrow from the app tile to the Applications tile.
    let arrow = NSBezierPath()
    arrow.move(to: CGPoint(x: 266, y: 220))
    arrow.curve(to: CGPoint(x: 386, y: 214), controlPoint1: CGPoint(x: 300, y: 186), controlPoint2: CGPoint(x: 356, y: 186))
    arrow.lineWidth = 3
    arrow.lineCapStyle = .round
    arrow.setLineDash([0.1, 11], count: 2, phase: 0)
    color(0x2563eb).setStroke()
    arrow.stroke()
    let head = NSBezierPath()
    head.move(to: CGPoint(x: 372, y: 214))
    head.line(to: CGPoint(x: 387, y: 216))
    head.line(to: CGPoint(x: 384, y: 201))
    head.lineWidth = 3
    head.lineCapStyle = .round
    head.lineJoinStyle = .round
    head.stroke()
}

func render(scale: CGFloat, to url: URL) throws {
    let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: Int(width * scale), pixelsHigh: Int(height * scale),
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    rep.size = NSSize(width: width, height: height)
    let graphics = NSGraphicsContext(bitmapImageRep: rep)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = graphics
    let context = graphics.cgContext
    // Top-left origin, like Finder's icon positions.
    context.translateBy(x: 0, y: height)
    context.scaleBy(x: 1, y: -1)
    let flipped = NSGraphicsContext(cgContext: context, flipped: true)
    NSGraphicsContext.current = flipped
    draw(in: context)
    NSGraphicsContext.restoreGraphicsState()
    let png = rep.converting(to: .sRGB, renderingIntent: .default)!.representation(using: .png, properties: [:])!
    try png.write(to: url)
}

let output = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ".")
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
try render(scale: 1, to: output.appendingPathComponent("background.png"))
try render(scale: 2, to: output.appendingPathComponent("background@2x.png"))
