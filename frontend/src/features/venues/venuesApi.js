// The venue epic's data access, re-exported from one place so screens and tests
// import from "./venuesApi" whichever workflow they use. The code lives in:
//   venueCatalogueApi.js        — catalogue, search, planning details, unavailability (E)
//   venueBookingRequestsApi.js  — the coordinator's requests, releases and withdrawals (F1, F7, F8, F11–F14)
//   venueBookingQueueApi.js     — Venue Staff's queue: approve, hold, reject (F3–F5, F15)
//   venueApiSupport.js          — helpers the three share

export {
  loadVenueCatalogue,
  loadVenueSafetyCatalogue,
  saveVenueCatalogue,
  saveVenuePlanningDetails,
  loadVenueSearchContext,
  saveVenueUnavailability
} from "./venueCatalogueApi";
export {
  requestVenueBooking,
  loadVenueBookings,
  prepareClashReplacement,
  releaseCancelledEventBookings,
  releaseVenueBooking,
  withdrawVenueBooking
} from "./venueBookingRequestsApi";
export {
  loadVenueBookingQueue,
  approveVenueBooking,
  rejectVenueBookingInFirestore,
  holdVenueBooking,
  rejectVenueBooking
} from "./venueBookingQueueApi";
