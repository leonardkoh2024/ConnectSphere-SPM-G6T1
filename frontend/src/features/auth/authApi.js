// Firebase Auth and the users collection, as the landing page needs them. The
// page decides what to say; this module decides what is read and written.

import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import { ROLES, ROLE_META } from "../../domain/roles";

// Signs in and reports whether the account's role belongs to the portal it was
// used on. The caller ends the session when it does not.
export const signInToPortal = async ({ email, password, portal }) => {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  const profile = await getDoc(doc(db, "users", credential.user.uid));
  const storedRole = profile.exists() ? profile.data().role : null;
  const storedPortal = ROLE_META[storedRole]?.portal;
  return { portalMatches: Boolean(storedPortal) && storedPortal === portal };
};

export const signOutUser = () => signOut(auth);

export const createAccount = async ({ email, password, name, isCorporate, organisationName, mobileNumber, preferredContactMethod }) => {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  await setDoc(doc(db, "users", credential.user.uid), {
    user_id: credential.user.uid,
    name: name.trim(),
    email: credential.user.email,
    // Public registration deliberately grants no staff capability. Other
    // staff roles are provisioned by an administrator.
    role: isCorporate ? ROLES.ORGANISER : ROLES.ATTENDEE,
    organisation_name: isCorporate ? organisationName.trim() : null,
    mobile_number: mobileNumber.trim(),
    preferred_contact_method: preferredContactMethod,
    is_active: true,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp()
  });
};
