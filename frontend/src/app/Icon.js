// The workspace icon set: one place that maps an icon name to a glyph.
//
// `domain/roles.js` names an icon per screen and this module draws it, which is
// what keeps `domain/` free of React. The glyphs come from react-icons' Lucide
// set; they inherit `currentColor` and the size set below, so a glyph takes the
// colour of whatever button holds it.
//
// Adding a screen? Give it an `icon` in ROLE_META and, if the name is new, add
// a row to GLYPHS. An unknown name falls back to LuCircleDot.

import React from "react";
import {
  LuArrowRight,
  LuBell,
  LuBookmark,
  LuBuilding2,
  LuCalendarDays,
  LuCalendarPlus,
  LuChevronDown,
  LuChevronLeft,
  LuChevronRight,
  LuCircle,
  LuCircleCheck,
  LuCircleDot,
  LuCircleX,
  LuClipboardList,
  LuEye,
  LuEyeOff,
  LuFileText,
  LuInbox,
  LuLogOut,
  LuPackage,
  LuPlus,
  LuRefreshCw,
  LuSearch,
  LuTicket,
  LuUsers,
  LuX
} from "react-icons/lu";

const GLYPHS = {
  calendar: LuCalendarDays,
  "calendar-add": LuCalendarPlus,
  draft: LuFileText,
  change: LuRefreshCw,
  people: LuUsers,
  bell: LuBell,
  inbox: LuInbox,
  clipboard: LuClipboardList,
  search: LuSearch,
  building: LuBuilding2,
  equipment: LuPackage,
  check: LuCircleCheck,
  bookmark: LuBookmark,
  ticket: LuTicket,
  "log-out": LuLogOut,
  "chevron-down": LuChevronDown,
  "chevron-left": LuChevronLeft,
  "chevron-right": LuChevronRight,
  "arrow-right": LuArrowRight,
  close: LuX,
  plus: LuPlus,
  eye: LuEye,
  "eye-off": LuEyeOff,
  circle: LuCircle,
  "circle-x": LuCircleX
};

export default function Icon({ name, className = "cs-icon" }) {
  const Glyph = GLYPHS[name] || LuCircleDot;
  return <Glyph className={className} size={18} aria-hidden="true" focusable="false" />;
}
