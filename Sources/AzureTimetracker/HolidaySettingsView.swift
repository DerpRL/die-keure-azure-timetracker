import SwiftUI
import AzureTimetrackerCore

struct HolidaySettingsView: View {
    @Environment(\.interfacePalette) private var palette

    @Binding var targets: WorkTargets
    @ViewState private var year = Calendar.current.component(.year, from: Date())
    @ViewState private var date = Date()
    @ViewState private var end = Date()
    @ViewState private var multipleDays = false
    @ViewState private var kind = TargetExceptionKind.leave
    @ViewState private var hours = 0.0
    @ViewState private var note = ""
    private var days: [Date] {
        let start = Calendar.current.startOfDay(for: date), finish = Calendar.current.startOfDay(for: multipleDays ? end : date)
        guard finish >= start, finish.timeIntervalSince(start) < 367 * 86400 else { return [] }
        var result: [Date] = [], day = start
        while day <= finish { result.append(day); day = Calendar.current.date(byAdding: .day, value: 1, to: day)! }
        return result
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            AppSectionHeading("Holidays & leave", subtitle: "Adjust targets without creating or changing 7pace entries.")
            Toggle("Use Belgian public holidays", isOn: $targets.usesBelgianHolidays)
            HStack {
                Text("Belgium · " + String(year)).font(.headline)
                Stepper("Holiday year", value: $year, in: 1900...2200).labelsHidden()
            }
            ForEach(BelgianHoliday.all(in: year)) { holiday in
                HStack {
                    Text(holiday.date, format: .dateTime.day().month(.wide).weekday(.abbreviated)).frame(width: 180, alignment: .leading)
                    Text(holiday.name); Spacer()
                    if targets.hours(weekday: Calendar.current.component(.weekday, from: holiday.date)) == 0 {
                        Text("Set replacement date below").font(.caption).foregroundStyle(palette.secondary)
                    }
                }.font(.callout)
            }
            Text("Replacement dates follow your employer’s arrangements. Add them below; the app does not assume the following Monday. Regional or company days off can also be added.").font(.callout).foregroundStyle(palette.secondary)
            Link("Belgian public holiday rules", destination: URL(string: "https://employment.belgium.be/en/themes/international/posting/working-conditions-be-respected-case-posting-belgium/public-holidays")!)
            Divider()
            Text("Add a date exception").font(.headline)
            HStack {
                DatePicker("From", selection: $date, displayedComponents: .date)
                Toggle("Date range", isOn: $multipleDays)
                if multipleDays { DatePicker("Through", selection: $end, displayedComponents: .date) }
            }
            Picker("Exception", selection: $kind) { ForEach(TargetExceptionKind.allCases, id: \.self) { Text($0.rawValue).tag($0) } }
            if kind == .custom { TextField("Target hours", value: $hours, format: .number) }
            TextField("Note (optional)", text: $note)
            HStack {
                Button("Add / replace dates") {
                    let additions = days.map { TargetException(date: $0, kind: kind, hours: hours, note: note) }
                    let keys = Set(additions.map(\.id))
                    targets.exceptions.removeAll { keys.contains($0.id) }; targets.exceptions += additions
                }.disabled(days.isEmpty || !hours.isFinite || !(0...24).contains(hours))
                Text("Save changes below to apply.").font(.caption).foregroundStyle(palette.secondary)
            }
            Text("Half-day leave halves your normal weekday hours. Custom hours override holidays too. Exceptions take priority over the weekly schedule.").font(.callout).foregroundStyle(palette.secondary)
            if !targets.exceptions.isEmpty {
                Divider()
                ForEach(targets.exceptions.sorted { $0.id < $1.id }) { item in
                    HStack {
                        Text(item.id).monospacedDigit(); Text(item.kind.rawValue)
                        if item.kind == .custom { Text(DurationText.short(item.hours * 3600)) }
                        Text(item.note).foregroundStyle(palette.secondary); Spacer()
                        Button("Remove") { targets.exceptions.removeAll { $0.id == item.id } }.accessibilityLabel("Remove exception on " + item.id)
                    }.font(.callout)
                }
            }
        }.textFieldStyle(.roundedBorder)
    }
}
