import { describe, expect, it } from "vitest";

import { describeSchedule } from "./schedule";

describe("describeSchedule", () => {
  it("returns a dash for a null schedule", () => {
    expect(describeSchedule(null)).toBe("—");
  });

  it("formats an interval schedule", () => {
    expect(
      describeSchedule({ type: "interval", every: 5, period: "minutes" }),
    ).toBe("every 5 minutes");
  });

  it("singularizes the period when every is 1", () => {
    expect(
      describeSchedule({ type: "interval", every: 1, period: "hours" }),
    ).toBe("every 1 hour");
  });

  it("formats a crontab schedule as a cron expression", () => {
    expect(
      describeSchedule({
        type: "crontab",
        minute: "0",
        hour: "9",
        day_of_month: "*",
        month_of_year: "*",
        day_of_week: "1",
      }),
    ).toBe("0 9 * * 1");
  });
});
