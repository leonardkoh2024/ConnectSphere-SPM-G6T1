// C4/C7/C8/C9 use the browser Firebase SDK, like the rest of the frontend.
// Firebase attaches the signed-in user and firestore.rules is the permission
// boundary for every read and atomic workflow write.

import { collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, where } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import { EVENT_STATUS, canApproveEvent, canOpenReview, canRejectEvent, canReassignEvent, canRequestClarification, canRespondToClarification, cleanRequiredText } from "../../domain/eventReview";
import { clarificationRecord, clarificationResponseRecord, coordinatorAssignmentRecord, eventHistoryRecord, notificationRecord } from "../../domain/eventReviewRecords";
import { ROLES } from "../../domain/roles";

const requireUser = () => {
  if (!auth.currentUser) throw new Error("Please sign in again.");
  return auth.currentUser;
};

const asIso = (value) => value?.toDate?.().toISOString?.() || value || null;
const record = (snapshot) => {
  const data = snapshot.data();
  return {
    id: snapshot.id, ...data,
    created_at: asIso(data.created_at), updated_at: asIso(data.updated_at),
    assigned_at: asIso(data.assigned_at), submitted_at: asIso(data.submitted_at),
    responded_at: asIso(data.responded_at), ended_at: asIso(data.ended_at), read_at: asIso(data.read_at)
  };
};

const profileFor = async (userId) => {
  const snapshot = await getDoc(doc(db, "users", userId));
  if (!snapshot.exists()) throw new Error("Your user profile could not be found.");
  return { id: snapshot.id, ...snapshot.data() };
};

const coordinatorFor = async (userId) => {
  if (!userId) return null;
  const snapshot = await getDoc(doc(db, "users", userId));
  if (!snapshot.exists()) return { id: userId, name: userId, active: false };
  const data = snapshot.data();
  return { id: snapshot.id, name: data.name || data.email || snapshot.id, active: data.is_active !== false };
};

const activeCoordinators = async () => {
  const snapshot = await getDocs(query(
    collection(db, "users"),
    where("role", "==", ROLES.COORDINATOR),
    where("is_active", "==", true)
  ));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
    .filter((item) => item.is_active !== false)
    .map((item) => ({ id: item.id, name: item.name || item.email || item.id, active: true }));
};

const list = async () => {
  const user = requireUser();
  const profile = await profileFor(user.uid);
  let snapshots;
  if (profile.role === ROLES.ORGANISER) {
    snapshots = (await getDocs(query(collection(db, "events"), where("organiser_id", "==", user.uid)))).docs;
  } else if (profile.role === ROLES.COORDINATOR) {
    const [current, assignments] = await Promise.all([
      getDocs(query(collection(db, "events"), where("coordinator_id", "==", user.uid))),
      getDocs(query(collection(db, "coordinator_assignments"), where("coordinator_id", "==", user.uid)))
    ]);
    const currentIds = new Set(current.docs.map((item) => item.id));
    const priorIds = [...new Set(assignments.docs.map((item) => item.data().event_id))]
      .filter((eventId) => eventId && !currentIds.has(eventId));
    const prior = await Promise.all(priorIds.map((eventId) => getDoc(doc(db, "events", eventId))));
    snapshots = [...current.docs, ...prior.filter((item) => item.exists())];
  } else throw new Error("This role cannot review event requests.");
  const unique = [...new Map(snapshots.map((item) => [item.id, item])).values()];
  return { events: unique.map((item) => ({ ...record(item), editable: item.data().coordinator_id === user.uid })) };
};

const detail = async (eventId) => {
  const user = requireUser();
  const eventSnapshot = await getDoc(doc(db, "events", eventId));
  if (!eventSnapshot.exists()) throw new Error("Event not found.");
  const event = record(eventSnapshot);
  const [questions, assignments, history, coordinator, profile] = await Promise.all([
    getDocs(query(collection(db, "clarification_requests", where("event_id", "==", eventId))),
    getDocs(query(collection(db, "coordinator_assignments"), where("event_id", "==", eventId))),
    getDocs(query(collection(db, "event_history"), where("event_id", "==", eventId))),
    coordinatorFor(event.coordinator_id), profile›ЬЉ\Щ\‹ќZY
B€JNВ€ЫЫњЭШЫЫЬ™[]ЬњЛ™\ЬЫњЩTЫ\ЪЭЧHH]ШZ]›ЫZ\ЩK[
В€›Щљ[Kњ›ЫHOOH“УTЛђУУФ‘SђUФ€ИXЭ]™PЫЫЬ™[]ЬњК
H€›ЫZ\ЩKњ™\ЫЫ™JЧJK€›ЫZ\ЩK[
]Y\Э[ЫњЛ™ШЬЛ›X\

]Y\Э[ЫЉHO€Щ]ШЬК]Y\ћJЫЫXЭ[ЫЉ‹Ы\љYљXШ][Ы—Ь™\ЬЫњЩ\ИЉKЪ\™JЫ\љYљXШ][Ы—ЪY‹ЏOH‹]Y\Э[Ы‹љY
JJJJB€JNВ€ЫЫњЭћPЬ™X]YH
KЉHO€Эљ[™КKЬ™X]YШ]€ЉK›ШШ[PЫЫ\\™JЭљ[™К‹Ь™X]YШ]€ЉJNВ€ЫЫњЭ\ЭЬћT™XЫЬ™ИH\ЭЬћK™ШЬЛ›X\
™XЫЬ™
KњЫЬќ
ћPЬ™X]Y
NВ€ЫЫњЭXЪ\Ъ[ЫњИH\ЭЬћT™XЫЬ™Л™љ[\Љ
][JHO€И‘U‘S•РT“Х‘Q‹‘U‘S•Ф‘R‘PХQ—Kљ[ЫY\К][KXЭ[Ы—Э\JJNВ€ЫЫњЭXЪ\Ъ[Ы€HXЪ\Ъ[ЫњЛ›[™ЭИXЪ\Ъ[ЫњЦЩXЪ\Ъ[ЫњЛ›[™ЭHWH€ќ[В€™]\›€В€]™[ќ€И‹‹™]™[ќY]X›N€]™[ќЫЫЬ™[]Ь—ЪYOOH\Щ\‹ќZYXЪ\Ъ[ЫЋ€XЪ\Ъ[ЫЏЛ›™]ЧЭ[YHќ[XЪ\Ъ[Ы—Ь™X\ЫЫЋ€XЪ\Ъ[ЫЏЛ™\ШЬљ\[Ы€ќ[XЪYYШћN€XЪ\Ъ[ЫЏЛXЭЬ—ЪYќ[XЪYYШ]€XЪ\Ъ[ЫЏЛЬ™X]YШ]ќ[K€ЫЫЬ™[]Ь‹ЫЫЬ™[]ЬњЛ€Ы\љYљXШ][ЫњО€]Y\Э[ЫњЛ™ШЬЛ›X\
™XЫЬ™
KњЫЬќ
ћPЬ™X]Y
K€™\ЬЫњЩ\О€™\ЬЫњЩTЫ\ЪЭЛ™›]X\

Ы\ЪЭ
HO€Ы\ЪЭ™ШЬЛ›X\
™XЫЬ™
JKњЫЬќ
ћPЬ™X]Y
K€\ЬЪYЫ›Y[ќО€\ЬЪYЫ›Y[ќЛ™ШЬЛ›X\
™XЫЬ™
KњЫЬќ
ћPЬ™X]Y
B€NВџNВ‚ЫЫњЭЬ[”™]љY]ИH\Ю[И
]™[ќY
HO€В€ЫЫњЭ\Щ\€H™\]Z\™U\Щ\Љ
NВ€ЫЫњЭ]™[ќ™Y€HШК‹™]™[ќИ‹]™[ќY
NВ€ЫЫњЭ\ЭЬћT™Y€HШКЫЫXЭ[ЫЉ‹™]™[ќЪ\ЭЬћHЉJNВ€]ШZ]ќ[•[њШXЭ[ЫЉ‹\Ю[И

HO€В€ЫЫњЭЫ\ЪЭH]ШZ]™Щ]
]™[ќ™YЉNВ€Y€
\Ы\ЪЭ™^\ЭК
HXШ[“Ь[”™]љY]КЫ\ЪЭ™]J
K\Щ\‹ќZY
JH›ЭИ™]И\њ›ЬЉ“Ы›HH\ЬЪYЫ™YЫЫЬ™[]Ь€Ш[€Ь[€\ИЭX›Z]Y™\]Y\Э€ЉNВ€ЫЫњЭЪ[™ЩY]HЩ\ќ™\•[Y\Э[\

NВ€ќ\]J]™[ќ™Y‹ИЭ]\О€U‘S•ФХUTЛ•S‘T—Ф‘U’QUЛ\]YШ]€Ъ[™ЩY]JNВ€њЩ]
\ЭЬћT™Y‹]™[ќ\ЭЬћT™XЫЬ™
И\ЭЬћRY€\ЭЬћT™Y‹љY]™[ќYXЭЬ’Y€\Щ\‹ќZYXЭ[Ы•\N€”‘U’QUЧФХT•Q‹љY[[YN€њЭ]\И‹Ы[YN€U‘S•ФХUTЛ”ХP“RUQ™]Х[YN€U‘S•ФХUTЛ•S‘T—Ф‘U’QUЛ\ШЬљ\[ЫЋ€ђЫЫЬ™[]Ь€Ь[™YH™\]Y\Э›Ь€™]љY]Л€‹Ь™X]Y]€Ъ[™ЩY]JJNВ€JNВ€™]\›€ИЪО€ќYHNВџNВ‚ЫЫњЭЫ\љYћHH\Ю[И
]™[ќY[YJHO€В€ЫЫњЭ\Щ\€H™\]Z\™U\Щ\Љ
NВ€ЫЫњЭY\ЬШYЩHHЫX[”™\]Z\™Y^
[YJNВ€Y€
[Y\ЬШYЩJH›ЭИ™]И\њ›ЬЉђЫ\љYљXШ][Ы€Y\ЬШYЩH\И™\]Z\™Y€ЉNВ€ЫЫњЭ]™[ќ™Y€HШК‹™]™[ќИ‹]™[ќY
NВ€ЫЫњЭЫ\љYљXШ][Ы”™Y€HШКЫЫXЭ[ЫЉ‹Ы\љYљXШ][Ы—Ь™\]Y\ЭИЉJNВ€ЫЫњЭ\ЭЬћT™Y€HШКЫЫXЭ[ЫЉ‹™]™[ќЪ\ЭЬћHЉJNВ€ЫЫњЭ›ЭYљXШ][Ы”™Y€HШКЫЫXЭ[ЫЉ‹››ЭYљXШ][ЫњИЉJNВ€]ШZ]ќ[•[њШXЭ[ЫЉ‹\Ю[И

HO€В€ЫЫњЭЫ\ЪЭH]ШZ]™Щ]
]™[ќ™YЉNВ€Y€
\Ы\ЪЭ™^\ЭК
HXШ[”™\]Y\ЭЫ\љYљXШ][ЫЉЫ\ЪЭ™]J
K\Щ\‹ќZY
JH›ЭИ™]И\њ›ЬЉђHЫ\љYљXШ][Ы€Ш[››Э™H™\]Y\ЭY›Ь€\И]™[ќ€ЉNВ€ЫЫњЭ]™[ќHЫ\ЪЭ™]J
NВ€ЫЫњЭЪ[™ЩY]HЩ\ќ™\•[Y\Э[\

NВ€њЩ]
Ы\љYљXШ][Ы”™Y‹Ы\љYљXШ][Ы”™XЫЬ™
ИЫ\љYљXШ][Ы’Y€Ы\љYљXШ][Ы”™Y‹љY]™[ќYЬ™X]YћN€\Щ\‹ќZYY\ЬШYЩKЬ™X]Y]€Ъ[™ЩY]JJNВ€ќ\]J]™[ќ™Y‹ИЭ]\О€U‘S•ФХUTЛ•S‘T—Ф‘U’QUЛЬ[—ШЫ\љYљXШ][Ы—ЪY€Ы\љYљXШ][Ы”™Y‹љY\]YШ]€Ъ[™ЩY]JNВ€њЩ]
\ЭЬћT™Y‹]™[ќ\ЭЬћT™XЫЬ™
И\ЭЬћRY€\ЭЬћT™Y‹љY]™[ќYXЭЬ’Y€\Щ\‹ќZYXЭ[Ы•\N€ђУT’Q’PРUSУ—Ф‘TUQTХQ‹\ШЬљ\[ЫЋ€Y\ЬШYЩKЬ™X]Y]€Ъ[™ЩY]JJNВ€њЩ]
›ЭYљXШ][Ы”™Y‹›ЭYљXШ][Ы”™XЫЬ™
И›ЭYљXШ][Ы’Y€›ЭYљXШ][Ы”™Y‹љY\Щ\’Y€]™[ќ›Ь™Ш[љ\Щ\—ЪY]™[ќY\N€ђУT’Q’PРUSУ—Ф‘TUQTХQ‹Y\ЬШYЩN€	Щ]™[ќ›[YH]™[ќњ™Y™\™[ЩWЫ›ЯN€Ы\љYљXШ][Ы€™\]Y\ЭY8 %	ЫY\ЬШYЩ_XЬ™X]Y]€Ъ[™ЩY]JJNВ€JNВ€™]\›€ИЪО€ќYKЫ\љYљXШ][Ы’Y€Ы\љYљXШ][Ы”™Y‹љYNВџNВ‚ЫЫњЭ™Z™XЭH\Ю[И
]™[ќY[YJHO€В€ЫЫњЭ\Щ\€H™\]Z\™U\Щ\Љ
NВ€ЫЫњЭ™X\ЫЫ€HЫX[”™\]Z\™Y^
[YJNВ€Y€
\™X\ЫЫЉH›ЭИ™]И\њ›ЬЉ”™Z™XЭ[Ы€™X\ЫЫ€\И™\]Z\™Y€ЉNВ€ЫЫњЭ]™[ќ™Y€HШК‹™]™[ќИ‹]™[ќY
NВ€ЫЫњЭ\ЭЬћT™Y€HШКЫЫXЭ[ЫЉ‹™]™[ќЪ\ЭЬћHЉJNВ€ЫЫњЭ›ЭYљXШ][Ы”™Y€HШКЫЫXЭ[ЫЉ‹››ЭYљXШ][ЫњИЉJNВ€]ШZ]ќ[•[њШXЭ[ЫЉ‹\Ю[И

HO€В€ЫЫњЭЫ\ЪЭH]ШZ]™Щ]
]™[ќ™YЉNВ€Y€
\Ы\ЪЭ™^\ЭК
HXШ[”™Z™XЭ]™[ќ
Ы\ЪЭ™]J
K\Щ\‹ќZY
JH›ЭИ™]И\њ›ЬЉ•\И]™[ќШ[››Э™H™Z™XЭY›ЭЛ€ЉNВ€ЫЫњЭ]™[ќHЫ\ЪЭ™]J
NВ€ЫЫњЭЪ[™ЩY]HЩ\ќ™\•[Y\Э[\

NВ€ќ\]J]™[ќ™Y‹ИЭ]\О€U‘S•ФХUTЛ”‘R‘PХQ\]YШ]€Ъ[™ЩY]JNВ€њЩ]
\ЭЬћT™Y‹]™[ќ\ЭЬћT™XЫЬ™
И\ЭЬћRY€\ЭЬћT™Y‹љY]™[ќYXЭЬ’Y€\Щ\‹ќZYXЭ[Ы•\N€‘U‘S•Ф‘R‘PХQ‹љY[[YN€њЭ]\И‹Ы[YN€]™[ќњЭ]\Л™]Х[YN€U‘S•ФХUTЛ”‘R‘PХQ\ШЬљ\[ЫЋ€™X\ЫЫ‹Ь™X]Y]€Ъ[™ЩY]JJNВ€њЩ]
›ЭYљXШ][Ы”™Y‹›ЭYљXШ][Ы”™XЫЬ™
И›ЭYљXШ][Ы’Y€›ЭYљXШ][Ы”™Y‹љY\Щ\’Y€]™[ќ›Ь™Ш[љ\Щ\—ЪY]™[ќY\N€‘U‘S•Ф‘R‘PХQ‹Y\ЬШYЩN€	Щ]™[ќ›[YH]™[ќњ™Y™\™[ЩWЫ›ЯHШ\И™Z™XЭY8 %	Ь™X\ЫЫџXЬ™X]Y]€Ъ[™ЩY]JJNВ€JNВ€™]\›€ИЪО€ќYHNВџNВ‚ЫЫњЭ™X\ЬЪYЫ€H\Ю[И
]™[ќYЫЫЬ™[]Ь’Y
HO€В€ЫЫњЭ\Щ\€H™\]Z\™U\Щ\Љ
NВ€ЫЫњЭ]™[ќ™Y€HШК‹™]™[ќИ‹]™[ќY
NВ€ЫЫњЭ\™Щ]™Y€HШК‹ќ\Щ\њИ‹ЫЫЬ™[]Ь’Y
NВ€ЫЫњЭ™]љ[Э\Ф™Y€HШК‹ЫЫЬ™[]Ь—Ш\ЬЪYЫ›Y[ќИ‹	Щ]™[ќYWЙЭ\Щ\‹ќZYX
NВ€ЫЫњЭ™^™Y€HШК‹ЫЫЬ™[]Ь—Ш\ЬЪYЫ›Y[ќИ‹	Щ]™[ќYWЙШЫЫЬ™[]Ь’YX
NВ€ЫЫњЭ\ЭЬћT™Y€HШКЫЫXЭ[ЫЉ‹™]™[ќЪ\ЭЬћHЉJNВ€ЫЫњЭ›ЭYљXШ][Ы”™YњИHЩШКЫЫXЭ[ЫЉ‹››ЭYљXШ][ЫњИЉJKШКЫЫXЭ[ЫЉ‹››ЭYљXШ][ЫњИЉJKШКЫЫXЭ[ЫЉ‹››ЭYљXШ][ЫњИЉJWNВ€]ШZ]ќ[•[њШXЭ[ЫЉ‹\Ю[И

HO€В€ЫЫњЭЩ]™[ќЫ\ЪЭ\™Щ]Ы\ЪЭ™]љ[Э\ФЫ\ЪЭHH]ШZ]›ЫZ\ЩK[
Э™Щ]
]™[ќ™YЉK™Щ]
\™Щ]™YЉK™Щ]
™]љ[Э\Ф™YЉWJNВ€Y€
Y]™[ќЫ\ЪЭ™^\ЭК
H]\™Щ]Ы\ЪЭ™^\ЭК
JH›ЭИ™]И\њ›ЬЉ‘]™[ќЬ€ЫЫЬ™[]Ь€›Э›Э[™€ЉNВ€ЫЫњЭ]™[ќH]™[ќЫ\ЪЭ™]J
NВ€ЫЫњЭ\™Щ]]HH\™Щ]Ы\ЪЭ™]J
NВ€ЫЫњЭ\™Щ]H\™Щ]]Kњ›ЫHOOH“УTЛђУУФ‘SђUФ€ИИY€\™Щ]Ы\ЪЭљY‹‹ќ\™Щ]]KXЭ]™N€\™Щ]]Kљ\ЧШXЭ]™HOOH[ЩHH€ќ[В€Y€
XШ[”™X\ЬЪYЫ‘]™[ќ
]™[ќ\Щ\‹ќZY\™Щ]
JH›ЭИ™]И\њ›ЬЉ“Ы›HHЭ\њ™[ќЫЫЬ™[]Ь€Ш[€™X\ЬЪYЫ€\И]™[ќИ[›Э\€XЭ]™HЫЫЬ™[]Ь‹€ЉNВ€ЫЫњЭЪ[™ЩY]HЩ\ќ™\•[Y\Э[\

NВ€ќ\]J]™[ќ™Y‹ИЫЫЬ™[]Ь—ЪY€ЫЫЬ™[]Ь’Y\ЬЪYЫ™YШ]€Ъ[™ЩY]\]YШ]€Ъ[™ЩY]JNВ€њЩ]
™]љ[Э\Ф™Y‹ЫЫЬ™[]Ьђ\ЬЪYЫ›Y[ќ™XЫЬ™
И\ЬЪYЫ›Y[ќY€™]љ[Э\Ф™Y‹љY]™[ќYЫЫЬ™[]Ь’Y€\Щ\‹ќZY\ЬЪYЫ™Y]€™]љ[Э\ФЫ\ЪЭ™^\ЭК
HИ™]љ[Э\ФЫ\ЪЭ™]J
K\ЬЪYЫ™YШ]€]™[ќ\ЬЪYЫ™YШ]ќ[[™Y]€Ъ[™ЩY]JJNВ€њЩ]
™^™Y‹ЫЫЬ™[]Ьђ\ЬЪYЫ›Y[ќ™XЫЬ™
И\ЬЪYЫ›Y[ќY€™^™Y‹љY]™[ќYЫЫЬ™[]Ь’Y\ЬЪYЫ™Y]€Ъ[™ЩY]JJNВ€њЩ]
\ЭЬћT™Y‹]™[ќ\ЭЬћT™XЫЬ™
И\ЭЬћRY€\ЭЬћT™Y‹љY]™[ќYXЭЬ’Y€\Щ\‹ќZYXЭ[Ы•\N€ђУУФ‘SђUФ—Ф‘PTФТQУ‘Q‹љY[[YN€ЫЫЬ™[]Ь—ЪY‹Ы[YN€\Щ\‹ќZY™]Х[YN€ЫЫЬ™[]Ь’Y\ШЬљ\[ЫЋ€]™[ќ™X\ЬЪYЫ™YИ	Э\™Щ]›[YH\™Щ]]K™[XZ[ЫЫЬ™[]Ь’YKЬ™X]Y]€Ъ[™ЩY]JJNВ€ЫЫњЭ›ЭHH	Щ]™[ќ›[YH]™[ќњ™Y™\™[ЩWЫ›ЯHШ\И™X\ЬЪYЫ™YИ	Э\™Щ]›[YH\™Щ]]K™[XZ[ЫЫЬ™[]Ь’YKВ€Э\Щ\‹ќZYЫЫЬ™[]Ь’Y]™[ќ›Ь™Ш[љ\Щ\—ЪYK™›Ь‘XXЪ

™XЪ\Y[ќ[™^
HO€њЩ]
›ЭYљXШ][Ы”™YњЦЪ[™^K›ЭYљXШ][Ы”™XЫЬ™
И›ЭYљXШ][Ы’Y€›ЭYљXШ][Ы”™YњЦЪ[™^KљY\Щ\’Y€™XЪ\Y[ќ]™[ќY\N€ђУУФ‘SђUФ—Ф‘PTФТQУ‘Q‹Y\ЬШYЩN€›ЭKЬ™X]Y]€Ъ[™ЩY]JJJNВ€JNВ€™]\›€ИЪО€ќYHNВџNВ‚ЫЫњЭ™\ЬЫ™H\Ю[И
]™[ќYЫ\љYљXШ][Ы’Y[YJHO€В€ЫЫњЭ\Щ\€H™\]Z\™U\Щ\Љ
NВ€ЫЫњЭY\ЬШYЩHHЫX[”™\]Z\™Y^
[YJNВ€Y€
[Y\ЬШYЩJH›ЭИ™]И\њ›ЬЉ”™\ЬЫњЩHY\ЬШYЩH\И™\]Z\™Y€ЉNВ€ЫЫњЭ]™[ќ™Y€HШК‹™]™[ќИ‹]™[ќY
NВ€ЫЫњЭЫ\љYљXШ][Ы”™Y€HШК‹Ы\љYљXШ][Ы—Ь™\]Y\ЭИ‹Ы\љYљXШ][Ы’Y
NВ€ЫЫњЭ™\ЬЫњЩT™Y€HШКЫЫXЭ[ЫЉ‹Ы\љYљXШ][Ы—Ь™\ЬЫњЩ\ИЉJNВ€ЫЫњЭ\ЭЬћT™Y€HШКЫЫXЭ[ЫЉ‹™]™[ќЪ\ЭЬћHЉJNВ€ЫЫњЭ›ЭYљXШ][Ы”™Y€HШКЫЫXЭ[ЫЉ‹››ЭYљXШ][ЫњИЉJNВ€]ШZ]ќ[•[њШXЭ[ЫЉ‹\Ю[И

HO€В€ЫЫњЭЩ]™[ќЫ\ЪЭЫ\љYљXШ][Ы”Ы\ЪЭHH]ШZ]›ЫZ\ЩK[
Э™Щ]
]™[ќ™YЉK™Щ]
Ы\љYљXШ][Ы”™YЉWJNВ€Y€
Y]™[ќЫ\ЪЭ™^\ЭК
HXЫ\љYљXШ][Ы”Ы\ЪЭ™^\ЭК
JH›ЭИ™]И\њ›ЬЉђЫ\љYљXШ][Ы€›Э›Э[™€ЉNВ€ЫЫњЭ]™[ќH]™[ќЫ\ЪЭ™]J
NВ€ЫЫњЭЫ\љYљXШ][Ы€HИЫ\љYљXШ][Ы—ЪY€Ы\љYљXШ][Ы’Y‹‹Ы\љYљXШ][Ы”Ы\ЪЭ™]J
HNВ€Y€
XШ[”™\ЬЫ™РЫ\љYљXШ][ЫЉ]™[ќЫ\љYљXШ][Ы‹\Щ\‹ќZY
JH›ЭИ™]И\њ›ЬЉ–[ЭHШ[››Э[њЭЩ\€\ИЫ\љYљXШ][Ы‹€ЉNВ€ЫЫњЭЪ[™ЩY]HЩ\ќ™\•[Y\Э[\

NВ€њЩ]
™\ЬЫњЩT™Y‹Ы\љYљXШ][Ы”™\ЬЫњЩT™XЫЬ™
И™\ЬЫњЩRY€™\ЬЫњЩT™Y‹љYЫ\љYљXШ][Ы’Y™\ЬЫ™\’Y€\Щ\‹ќZYY\ЬШYЩKЬ™X]Y]€Ъ[™ЩY]JJNВ€ќ\]JЫ\љYљXШ][Ы”™Y‹ИЭ]\О€ђS”ХСT‘Q‹™\ЬЫ™YШ]€Ъ[™ЩY]JNВ€ќ\]J]™[ќ™Y‹ИЬ[—ШЫ\љYљXШ][Ы—ЪY€ќ[\]YШ]€Ъ[™ЩY]JNВ€њЩ]
\ЭЬћT™Y‹]™[ќ\ЭЬћT™XЫЬ™
И\ЭЬћRY€\ЭЬћT™Y‹љY]™[ќYXЭЬ’Y€\Щ\‹ќZYXЭ[Ы•\N€ђУT’Q’PРUSУ—Ф‘TФУ‘Q‹\ШЬљ\[ЫЋ€Y\ЬШYЩKЬ™X]Y]€Ъ[™ЩY]JJNВ€њЩ]
›ЭYљXШ][Ы”™Y‹›ЭYљXШ][Ы”™XЫЬ™
И›ЭYљXШ][Ы’Y€›ЭYљXШ][Ы”™Y‹љY\Щ\’Y€]™[ќЫЫЬ™[]Ь—ЪY]™[ќY\N€ђУT’Q’PРUSУ—Ф‘TФУ‘Q‹Y\ЬШYЩN€	Щ]™[ќ›[YH]™[ќњ™Y™\™[ЩWЫ›ЯN€HЬ™Ш[љ\Щ\€[њЭЩ\™Y[Э\€Ы\љYљXШ][Ы‹Ь™X]Y]€Ъ[™ЩY]JJNВ€JNВ€™]\›€ИЪО€ќYHNВџNВ‚‹ЛИН€ИРФ•SKLLИ8 %\›Э™HHЭX›Z]Y™\]Y\Э€Ш[YHЪ\H\И™Z™XЭ€ЭX\™Ъ]‹ЛИШ[ђ\›Э™Q]™[ќ
PМH[™\€™]љY]ЛPМИ\ЬЪYЫ™YЫЫЬ™[]Ь‹PН›ИЬ[‚‹ЛИЫ\љYљXШ][ЫЉKЩ]H]™[ќ\›Э™Y
PМЉK[™Ьљ]H[€U‘S•РT“Х‘Q\ЭЬћB‹ЛИ[ќћH
PНJHЪЬЩHXЭЬ—ЪY
ИЬ™X]YШ]\™HHXЪY[™ИЫЫЬ™[]Ь€
И[Y\Э[\‚ЫЫњЭ\›Э™HH\Ю[И
]™[ќY
HO€В€ЫЫњЭ\Щ\€H™\]Z\™U\Щ\Љ
NВ€ЫЫњЭ]™[ќ™Y€HШК‹™]™[ќИ‹]™[ќY
NВ€ЫЫњЭ\ЭЬћT™Y€HШКЫЫXЭ[ЫЉ‹™]™[ќЪ\ЭЬћHЉJNВ€]ШZ]ќ[•[њШXЭ[ЫЉ‹\Ю[И

HO€В€ЫЫњЭЫ\ЪЭH]ШZ]™Щ]
]™[ќ™YЉNВ€Y€
\Ы\ЪЭ™^\ЭК
HXШ[ђ\›Э™Q]™[ќ
Ы\ЪЭ™]J
K\Щ\‹ќZY
JH›ЭИ™]И\њ›ЬЉ•\И]™[ќШ[››Э™H\›Э™Y›ЭЛ€ЉNВ€ЫЫњЭ]™[ќHЫ\ЪЭ™]J
NВ€ЫЫњЭЪ[™ЩY]HЩ\ќ™\•[Y\Э[\

NВ€ќ\]J]™[ќ™Y‹ИЭ]\О€U‘S•ФХUTЛђT“Х‘Q\]YШ]€Ъ[™ЩY]JNВ€њЩ]
\ЭЬћT™Y‹]™[ќ\ЭЬћT™XЫЬ™
И\ЭЬћRY€\ЭЬћT™Y‹љY]™[ќYXЭЬ’Y€\Щ\‹ќZYXЭ[Ы•\N€‘U‘S•РT“Х‘Q‹љY[[YN€њЭ]\И‹Ы[YN€]™[ќњЭ]\Л™]Х[YN€U‘S•ФХUTЛђT“Х‘Q\ШЬљ\[ЫЋ€ђЫЫЬ™[]Ь€\›Э™YH™\]Y\Э€‹Ь™X]Y]€Ъ[™ЩY]JJNВ€JNВ€™]\›€ИЪО€ќYHNВџNВ‚™^ЬќЫЫњЭ™]љY]Р\HHИ\Э]Z[Ь[”™]љY]ЛЫ\љYћK™Z™XЭ™X\ЬЪYЫ‹™\ЬЫ™\›Э™HNВ