// C4/C7/C8/C9 use the browser Firebase SDK, like the rest of the frontend.
// Firebase attaches the signed-in user and firestore.rules is the permission
// boundary for every read and atomic workflow write.
//
// Screens call everything through the one reviewApi object. The code lives in:
//   reviewQueriesApi.js   — the event lists, the detail view and change-impact reads
//   reviewDecisionsApi.js — open, clarify, approve, reject, cancel, complete
//   eventEditApi.js       — editing an event after submission (D1, D2), and its re-requests (I3)
//   leadAssignmentApi.js  — the Lead assigning and reassigning a coordinator (K2, K3)
//   reviewApiSupport.js   — helpers the four share

import { arrangementImpact, detail, leadBoard, list, registeredCount, significantChangeImpact } from "./reviewQueriesApi";
import { approve, cancel, cancelUnassigned, clarify, complete, notifyCancelledAttendees, openReview, reject, respond } from "./reviewDecisionsApi";
import { retryRerequest, saveEventEdit } from "./eventEditApi";
import { assign, leadReassign } from "./leadAssignmentApi";

export const reviewApi = {
  list, detail, openReview, clarify, reject, respond, approve, cancel, cancelUnassigned, complete, notifyCancelledAttendees,
  leadBoard, assign, leadReassign,
  significantChangeImpact, arrangementImpact, saveEventEdit, registeredCount, retryRerequest
};
