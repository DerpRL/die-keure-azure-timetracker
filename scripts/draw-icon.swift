import AppKit

let destination = URL(fileURLWithPath: CommandLine.arguments[1])
try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = size * scale
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8,
            samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
        let context = NSGraphicsContext.current!.cgContext
        context.scaleBy(x: CGFloat(pixels) / 1024, y: CGFloat(pixels) / 1024)
        // A simple clock face remains recognizable at small Finder icon sizes.
        let backdrop = NSBezierPath(roundedRect: CGRect(x: 70, y: 70, width: 884, height: 884), xRadius: 198, yRadius: 198)
        NSColor(srgbRed: 0.12, green: 0.13, blue: 0.14, alpha: 1).setFill()
        backdrop.fill()
        NSColor.white.setStroke()
        let ring = NSBezierPath(ovalIn: CGRect(x: 252, y: 252, width: 520, height: 520))
        ring.lineWidth = 44
        ring.stroke()
        let hands = NSBezierPath()
        hands.lineWidth = 44; hands.lineCapStyle = .round; hands.lineJoinStyle = .round
        hands.move(to: NSPoint(x: 512, y: 674))
        hands.line(to: NSPoint(x: 512, y: 512))
        hands.line(to: NSPoint(x: 624, y: 448))
        hands.stroke()
        NSGraphicsContext.restoreGraphicsState()
        let name = "icon_\(size)x\(size)" + (scale == 2 ? "@2x" : "") + ".png"
        try bitmap.representation(using: .png, properties: [:])!.write(to: destination.appendingPathComponent(name))
    }
}
