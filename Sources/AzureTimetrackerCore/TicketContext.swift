import Foundation

public struct TicketLink: Identifiable, Sendable {
    public var id: String { url.absoluteString }
    public let title: String
    public let url: URL
}
public struct TicketContext: Identifiable, Sendable {
    public let id: Int
    public let title: String
    public let state: String
    public let type: String
    public let assignedTo: String
    public let project: String
    public let iteration: String
    public let tags: String
    public let description: String
    public let acceptanceCriteria: String
    public let links: [TicketLink]
    public static func decode(_ data: Data, organizationURL: URL) throws -> Self {
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any], let id = object["id"] as? Int,
              let fields = object["fields"] as? [String: Any] else { throw AppError.message("Azure returned incomplete ticket details.") }
        func field(_ key: String) -> String { fields[key] as? String ?? "" }
        let assigned = (fields["System.AssignedTo"] as? [String: Any])?["displayName"] as? String ?? field("System.AssignedTo")
        var seen = Set<String>(), links: [TicketLink] = []
        for relation in object["relations"] as? [[String: Any]] ?? [] {
            guard let raw = relation["url"] as? String, let c = URLComponents(string: raw), c.scheme == "https", c.host != nil, c.user == nil, c.password == nil, var url = c.url else { continue }
            if url.host == organizationURL.host, url.path.hasPrefix(organizationURL.path + "/"), url.path.lowercased().contains("/_apis/wit/workitems/"), let ticket = Int(url.lastPathComponent) {
                url = organizationURL.appendingPathComponent("_workitems/edit/\(ticket)")
            }
            guard seen.insert(url.absoluteString).inserted else { continue }
            let name = (relation["attributes"] as? [String: Any])?["name"] as? String ?? relation["rel"] as? String ?? "Related link"
            links.append(TicketLink(title: name, url: url))
        }
        return Self(id: id, title: field("System.Title"), state: field("System.State"), type: field("System.WorkItemType"), assignedTo: assigned,
                    project: field("System.TeamProject"), iteration: field("System.IterationPath"), tags: field("System.Tags"),
                    description: PlainHTML.text(field("System.Description")), acceptanceCriteria: PlainHTML.text(field("Microsoft.VSTS.Common.AcceptanceCriteria")), links: links)
    }
}
public enum PlainHTML {
    // Display plain text only: no web view, scripts, remote images, or HTML resource loading.
    public static func text(_ source: String) -> String {
        var text = source.replacingOccurrences(of: "(?is)<(script|style)\\b[^>]*>.*?</\\1\\s*>", with: "", options: .regularExpression)
        text = text.replacingOccurrences(of: "(?i)<br\\s*/?>|</(?:p|div|li|h[1-6]|tr)\\s*>", with: "\n", options: .regularExpression)
        text = text.replacingOccurrences(of: "(?i)<li\\b[^>]*>", with: "• ", options: .regularExpression)
        text = text.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
        let regex = try! NSRegularExpression(pattern: "&#(x[0-9a-fA-F]+|[0-9]+);")
        for match in regex.matches(in: text, range: NSRange(text.startIndex..., in: text)).reversed() {
            guard let full = Range(match.range, in: text), let valueRange = Range(match.range(at: 1), in: text) else { continue }
            let value = String(text[valueRange]); let code = value.hasPrefix("x") ? UInt32(value.dropFirst(), radix: 16) : UInt32(value)
            if let code, let scalar = UnicodeScalar(code) { text.replaceSubrange(full, with: String(scalar)) }
        }
        for (entity, decoded) in [("&nbsp;", " "), ("&quot;", "\""), ("&apos;", "'"), ("&lt;", "<"), ("&gt;", ">"), ("&amp;", "&")] { text = text.replacingOccurrences(of: entity, with: decoded) }
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
