import React from "react";

const defaultStatus = (line) => {
  if (line.fulfillment_status === "RESERVED") return "Reserved";
  if (line.fulfillment_status === "RESOLVED") return "Unable to fulfil";
  return "Requested";
};

export default function EquipmentRequestLines({ lines, getStatus = defaultStatus }) {
  return <div className="cs-equipment-lines" aria-label="Requested equipment">
    {lines.map((line, index) => <p className="cs-equipment-lines-item" key={index}>
      <strong>{line.equipment_type.replaceAll("_", " ")}</strong>
      {" · "}{line.quantity}
      {" · "}{line.technical_requirements || "None specified"}
      {" · "}{getStatus(line, index) ?? defaultStatus(line)}
    </p>)}
  </div>;
}
