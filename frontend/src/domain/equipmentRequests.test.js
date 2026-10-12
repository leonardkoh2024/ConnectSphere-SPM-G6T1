import {
  equipmentRequestLines,
  validateEquipmentRequestLines
} from "./equipmentRequests";

describe("G1 equipment requests", () => {
  test("organiser equipment lines prefill coordinator lines, including technical notes", () => {
    expect(equipmentRequestLines([
      { equipment_type: "AUDIO", quantity: 2, technical_note: "Wireless microphones" }
    ])).toEqual([
      { equipment_type: "AUDIO", quantity: "2", technical_requirements: "Wireless microphones" }
    ]);
  });

  test("accepts one or more valid request lines", () => {
    expect(validateEquipmentRequestLines([
      { equipment_type: "AUDIO", quantity: "2", technical_requirements: "Wireless" },
      { equipment_type: "OTHERS", quantity: "1", technical_requirements: "" }
    ])).toBe("");
  });

  test("requires at least one line, a supported type, and a positive whole quantity", () => {
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
