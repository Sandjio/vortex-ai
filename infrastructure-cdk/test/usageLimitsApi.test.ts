import { handler } from "../lambda/usageLimitsApi";

describe("UsageLimitsApi", () => {
  it("should be defined", () => {
    expect(handler).toBeDefined();
  });
});
