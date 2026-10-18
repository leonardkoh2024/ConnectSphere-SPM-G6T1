import { EQUIPMENT_TYPES } from "./events";

export const terminalEquipmentEventStatuses = ["COMPLETED", "CANCELLED", "REJECTED"];

export const equipmentRequestLines = (lines = []) => lines.map((line) => ({
  equipment_type: String(line.equipment_type || line.equipmentType || ""),
  quantity: line.quantity == null ? "" : String(line.quantity),
  technical_requirements: String(line.technical_requirements || line.technical_note || line.technicalNote || "")
}));

// J5 / SCRUM-154 AC2 / AC4 — on-site support is a tick box on the request; once ticked,
// the coordinator says what is needed. Not ticked asks for nothing.
export const onSiteSupportProblem = (onSiteSupport, details) =>
  onSiteSupport && !String(details ?? "").trim() ? "Describe the on-site support needed." : "";

export const validateEquipmentRequestLines = (lines) => {
  if (!Array.isArray(lines) || lines.length === 0) {
    return "Add at least one equipment line before submitting.";
  }
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!EQUIPMENT_TYPES.includes(line.equipment_type)) {
      return `Choose an equipment type for line ${index + 1}.`;
    }
    const quantity = Number(line.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      return `Quantity for line ${index + 1} must be a whole number greater than zero.`;
    }
    if (typeof line.technical_requirements !== "string") {
      return `Technical requirements for line ${index + 1} must be text.`;
    }
  }
  return "";
};
