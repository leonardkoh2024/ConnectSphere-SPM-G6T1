// src/FirebaseTest.js

import React, { useState } from "react";

import {
  collection,
  addDoc,
  getDocs
} from "firebase/firestore";

import {
  ref,
  uploadBytes,
  getDownloadURL
} from "firebase/storage";

import { db, storage } from "../lib/firebase";

function FirebaseTest() {
  const [data, setData] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [downloadURL, setDownloadURL] = useState("");

  // ==========================================
  // FIRESTORE - WRITE
  // ==========================================
  const handlePostData = async () => {
    try {
      const docRef = await addDoc(
        collection(db, "test_collection"),
        {
          message: "Firebase is working perfectly!",
          createdAt: new Date().toLocaleTimeString()
        }
      );

      alert("Success! Document written with ID: " + docRef.id);
    } catch (error) {
      console.error("Error adding document:", error);
      alert("Failed to write data. Check your console.");
    }
  };

  // ==========================================
  // FIRESTORE - READ
  // ==========================================
  const handleRetrieveData = async () => {
    try {
      const querySnapshot = await getDocs(
        collection(db, "test_collection")
      );

      const fetchedData = querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data()
      }));

      setData(fetchedData);
    } catch (error) {
      console.error("Error fetching documents:", error);
      alert("Failed to read data. Check your console.");
    }
  };

  // ==========================================
  // STORAGE - SELECT FILE
  // ==========================================
  const handleFileChange = (event) => {
    const file = event.target.files[0];

    if (file) {
      setSelectedFile(file);
      setDownloadURL("");
    }
  };

  // ==========================================
  // STORAGE - UPLOAD FILE
  // ==========================================
  const handleUploadFile = async () => {
    if (!selectedFile) {
      alert("Please select a file first.");
      return;
    }

    try {
      // Create a reference inside Firebase Storage
      const storageRef = ref(
        storage,
        `test_uploads/${selectedFile.name}`
      );

      // Upload the file
      const snapshot = await uploadBytes(
        storageRef,
        selectedFile
      );

      console.log("Uploaded file:", snapshot);

      // Get a URL that can be used to download/view the file
      const url = await getDownloadURL(snapshot.ref);

      setDownloadURL(url);

      alert("File uploaded successfully!");
    } catch (error) {
      console.error("Error uploading file:", error);
      alert("Upload failed. Check your console.");
    }
  };

  return (
    <div
      style={{
        padding: "20px",
        fontFamily: "Arial, sans-serif"
      }}
    >

      {/* =====================================
          FIRESTORE TEST
      ====================================== */}

      <h2>Firestore Connection Test</h2>

      <div style={{ marginBottom: "20px" }}>
        <button
          onClick={handlePostData}
          style={{ marginRight: "10px" }}
        >
          1. Post Test Data
        </button>

        <button onClick={handleRetrieveData}>
          2. Retrieve Data
        </button>
      </div>

      <h3>Retrieved Data:</h3>

      <ul>
        {data.length === 0 ? (
          <li>
            No data retrieved yet. Click the button above.
          </li>
        ) : (
          data.map((item) => (
            <li key={item.id}>
              <strong>{item.message}</strong>
              {" "}
              (Created at: {item.createdAt})
            </li>
          ))
        )}
      </ul>

      <hr />

      {/* =====================================
          FIREBASE STORAGE TEST
      ====================================== */}

      <h2>Firebase Storage Test</h2>

      <input
        type="file"
        onChange={handleFileChange}
      />

      <br />
      <br />

      <button onClick={handleUploadFile}>
        Upload File
      </button>

      {selectedFile && (
        <p>
          Selected file: {selectedFile.name}
        </p>
      )}

      {downloadURL && (
        <div>
          <p>Upload successful!</p>

          <a
            href={downloadURL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open uploaded file
          </a>
        </div>
      )}

    </div>
  );
}

export default FirebaseTest;