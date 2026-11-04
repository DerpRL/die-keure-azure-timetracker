/**
 * Browser preview only: the sample slices describe Tuesday 6 October 2026, 10:00 in Brussels
 * (`SAMPLE_NOW`). With the real clock a running sample timer would show hundreds of hours and
 * every "today" view would be empty, so the preview moves the page's clock to the sample day.
 * Time still ticks; only the starting point changes. `?clock=real` keeps the real clock.
 */
export function pinClockTo(sampleNow: string): void {
  const offset = Date.parse(sampleNow) - Date.now();
  const RealDate = Date;

  class SampleDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...(args as [string | number | Date]));
    }

    static override now(): number {
      return RealDate.now() + offset;
    }
  }

  globalThis.Date = SampleDate as DateConstructor;
}
