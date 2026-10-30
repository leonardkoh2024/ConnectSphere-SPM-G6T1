import {
  equipmentRequestLines,
  onSiteSupportProblem,
  validateEquipmentRequestLines
} from "./equipmentRequests";

describe("G1 equipment requests", () => {
  test("TC-1152 organiser equipment lines prefill coordinator lines, including technical notes", () => {
    expect(equipmentRequestLines([
      { equipment_type: "AUDIO", quantity: 2, technical_note: "Wireless microphones" }
    ])).toEqual([
      { equipment_type: "AUDIO", quantity: "2", technical_requirements: "Wireless microphones" }
    ]);
  });

  test("TC-1153 accepts one or more valid request lines", () => {
    expect(validateEquipmentRequestLines([
      { equipment_type: "AUDIO", quantity: "2", technical_requirements: "Wireless" },
      { equipment_type: "OTHERS", quantity: "1", technical_requirements: "" }
    ])).toBe("");
  });

  test("TC-1154 requires at least one line, a supported type, and a positive whole quantity", () => {
    expect(validateEquipmentRequestLines([])).toMatch(/at least one/i);
    expect(validateEquipmentRequestLines([
      { equipment_type: "", quantity: "1", technical_requirements: "" }
    ])).toMatch(/equipment type/i);
    for (const quantity of ["", "0", "-1", "1.5", "abc"]) {
      expect(validateEquipmentRequestLines([
        { equipment_type: "AUDIO", quantity, technical_requirements: "" }
      ])).toMatch(/whole number greater than zero/i);
    }
  });
});

// J5 / SCRUM-154 AC2 / AC4 — on-site support is recorded on the equipment request: a box
// to tick, and once ticked, what is needed. Technical Support are told from that.
describe("J5 SCRUM-154 on-site support on an equipment request", () => {
  test("TC-2183 J5 AC2 not needing on-site support asks for nothing more", () => {
    expect(onSiteSupportProblem(false, "")).toBe("");
    expect(onSiteSupportProblem(false, "left over from before")).toBe("");
  });

  test("TC-2184 J5 AC2 needing on-site support asks what is needed, and blank words do not count", () => {
    for (const details of ["", "   ", undefined]) {
      expect(onSiteSupportProblem(true, details)).toBe("Describe the on-site support needed.");
    }
    expect(onSiteSupportProblem(true, "Two technicians for setup")).toBe("");
  });
});

describe("G1 equipment request edges", () => {
  test("TC-1155 [boundary] no lines, camelCase fields and a missing quantity are all read", () => {
    expect(equipmentRequestLines()).toEqual([]);
    expect(equipmentRequestLines([{ equipmentType: "VISUAL", technicalNote: "HDMI" }, {}])).toEqual([
      { equipment_type: "VISUAL", quantity: "", technical_requirements: "HDMI" },
      { equipment_type: "", quantity: "", technical_requirements: "" }
    ]);
    expect(onSiteSupportProblem(true, null)).toBe("Describe the on-site support needed.");
  });

  test("TC-1156 [failure] technical requirements that are not text are refused, naming the line", () => {
    expect(validateEquipmentRequestLines([
      { equipment_type: "AUDIO", quantity: "1", technical_requirements: "" },
      { equipment_type: "AUDIO", quantity: "1", technical_requirements: 42 }
    ])).toBe("Technical requirements for line 2 must be text.");
    expect(validateEquipmentRequestLines(null)).toBe("Add at least one equipment line before submitting.");
  });
});
