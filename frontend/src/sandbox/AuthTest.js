import React, { useState, useEffect } from 'react';
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged 
} from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db} from '../lib/firebase'; // Import your configured auth instance

function AuthTest() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [user, setUser] = useState(null);

  // Listen for changes in the user's login state (e.g., when they log in or out)
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    // Cleanup subscription on unmount
    return () => unsubscribe();
  }, []);

  // 1. REGISTER a new user
  const handleRegister = async () => {
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);

    // Create user's Firestore document
    await setDoc(doc(db, "users", userCredential.user.uid), {
      uid: userCredential.user.uid,
      email: userCredential.user.email,
    //   name: name,
      createdAt: serverTimestamp()
    });

      alert("Registered successfully as: " + userCredential.user.email);
    } catch (error) {
      console.error(error);
      alert(error.message);
    }
  };

  // 2. LOGIN an existing user
  const handleLogin = async () => {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      alert("Logged in successfully as: " + userCredential.user.email);
    } catch (error) {
      console.error(error);
      alert(error.message);
    }
  };

  // 3. LOGOUT the current user
  const handleLogout = async () => {
    try {
      await signOut(auth);
      alert("Logged out successfully");
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', borderBottom: '1px solid #ccc' }}>
      <h2>Firebase Authentication Test</h2>

      {/* Show different UI depending on whether someone is logged in */}
      {user ? (
        <div>
          <p>Welcome! You are currently logged in as: <strong>{user.email}</strong></p>
          <button onClick={handleLogout}>Log Out</button>
        </div>
      ) : (
        <div>
          <p>You are not logged in.</p>
          <div style={{ marginBottom: '10px' }}>
            <input 
              type="email" 
              placeholder="Email..." 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ marginRight: '10px' }}
            />
            <input 
              type="password" 
              placeholder="Password..." 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button onClick={handleRegister} style={{ marginRight: '10px' }}>Register</button>
          <button onClick={handleLogin}>Log In</button>
        </div>
      )}
    </div>
  );
}

export default AuthTest;