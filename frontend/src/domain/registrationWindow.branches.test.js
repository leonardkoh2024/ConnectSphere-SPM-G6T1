// H1 / SCRUM-139 — the missing-field and omitted-argument cases of the registration window rules.

import {
  capacityReductionNeedsAcknowledgement,
  registeredFloorMessage,
  registrationAttemptRefusal,
  registrationInstant,
  registrationPhase,
  registrationRecheckApplies,
  registrationReview,
  registrationSetupRefusal,
  registrationWindowOf,
  validateRegistrationSettings,
  venueCapacityCeiling
} from "./registrationWindow.mjs";

const event = (overrides = {}) => ({
  status: "APPROVED",
  registration_required: true,
  registration_capacity: 10,
  event_date: "2099-12-31",
  start_time: "10:00",
  registration_open_date: "2000-01-01",
  registration_open_time: "09:00",
  registration_close_date: "2099-12-30",
  registration_close_time: "17:00",
  ...overrides
});

describe("H1 registration window fallbacks", () => {
  test("TC-2739 the floor message says person for one and people for more", () => {
    expect(registeredFloorMessage(1)).toMatch(/1 person already/);
    expect(registeredFloorMessage(3)).toMatch(/3 people already/);
  });

  test("TC-2740 a missing or impossible date or time gives no instant", () => {
    expect(registrationInstant("2026-12-01", undefined)).toBeNull();
    expect(registrationInstant(null, "10:00")).toBeNull();
    expect(registrationInstant("2026-13-45", "10:00")).toBeNull();
  });

  test("TC-2741 no event gives no window, and the phase is judged against the current time", () => {
    expect(registrationWindowOf()).toEqual({ opensAt: null, closesAt: null });
    expect(registrationPhase(event())).toBe("OPEN");
  });

  test("TC-2742 setup and attempt refusals use the current time and cope with no status", () => {
    expect(registrationSetupRefusal(event())).toBeNull();
    expect(registrationSetupRefusal(event({ status: undefined })).reason).toBe("status");
    expect(registrationAttemptRefusal(event())).toBeNull();
  });

  test("TC-2743 no bookings give no venue ceiling", () => {
    expect(venueCapacityCeiling()).toBeNull();
  });

  test("TC-2744 settings with no input or options report every problem", () => {
    const result = validateRegistrationSettings();
    expect(result.ok).toBe(false);
    expect(result.errors).toMatchObject({ registrationWindow: expect.any(String) });
  });

  test("TC-2745 with no approved venue, a capacity cannot be set on an event that had none", () => {
    const result = validateRegistrationSettings(
      {
        registrationCapacity: "5",
        registrationOpenDate: "2000-01-01",
        registrationOpenTime: "09:00",
        registrationCloseDate: "2099-12-30",
        registrationCloseTime: "17:00"
      },
      { event: { event_date: "2099-12-31", start_time: "10:00" } }
    );
    expect(result.errors.registrationCapacity).toMatch(/venue booking has been approved/i);
  });

  test("TC-2746 a missing capacity is not a number", () => {
    expect(validateRegistrationSettings({}).errors.registrationCapacity).toMatch(/whole number/i);
  });

  test("TC-2747 a reduction check with nothing given needs no acknowledgement", () => {
    expect(capacityReductionNeedsAcknowledgement()).toBe(false);
    expect(capacityReductionNeedsAcknowledgement({ oldCapacity: "abc", newCapacity: 1 })).toBe(false);
    expect(capacityReductionNeedsAcknowledgement({ oldCapacity: 10 })).toBe(false);
    expect(capacityReductionNeedsAcknowledgement({ oldCapacity: 10, newCapacity: 2 })).toBe(false);
  });

  test("TC-2748 the recheck applies to nothing when no changes are given", () => {
    expect(registrationRecheckApplies()).toBe(false);
    expect(registrationRecheckApplies(null)).toBe(false);
    expect(registrationRecheckApplies({ start_time: "11:00" })).toBe(true);
  });

  test("TC-2749 a review with no arguments needs none", () => {
    expect(registrationReview()).toEqual({ needsReview: false, reasons: [] });
  });
});
