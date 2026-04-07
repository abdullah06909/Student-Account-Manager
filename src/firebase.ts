/// <reference types="vite/client" />
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
        apiKey: (import.meta.env.VITE_FIREBASE_API_KEY as string) || "AIzaSyAOldujiKslpJvEk2MSBaZi4egw2B6eS1Q",
        authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string) || "first-app-u8w5ia.firebaseapp.com",
        projectId: (import.meta.env.VITE_FIREBASE_PROJECT_ID as string) || "first-app-u8w5ia",
        storageBucket: (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string) || "first-app-u8w5ia.firebasestorage.app",
        messagingSenderId: (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string) || "663633808904",
        appId: (import.meta.env.VITE_FIREBASE_APP_ID as string) || "1:663633808904:web:0efd4c951fe71ef8aacbbd"
};

if (!import.meta.env.VITE_FIREBASE_API_KEY) {
    // Informative warning only — keeps current behavior but prompts using env vars for safety
    // eslint-disable-next-line no-console
    console.warn('Using embedded Firebase config. For production, set VITE_FIREBASE_* env vars.');
}

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
