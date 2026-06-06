import * as admin from "firebase-admin";

let firebaseInitialized = false;
let firebaseError: Error | null = null;

// Initialize Firebase Admin SDK with retry logic
async function initializeFirebase() {
  if (!admin.apps.length) {
    try {
      // Support both environment variables (production) and service account file (development)
      const useEnvVars =
        process.env.FIREBASE_PROJECT_ID &&
        process.env.FIREBASE_PRIVATE_KEY &&
        process.env.FIREBASE_CLIENT_EMAIL;

      let credential;

      if (useEnvVars) {
        // Production: Use environment variables
        credential = admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        });
        console.log("✓ Using Firebase credentials from environment variables");
      } else {
        // Development: Use service account file
        try {
          const serviceAccountJson = require("../firebase-service-account.json");
          credential = admin.credential.cert({
            projectId: serviceAccountJson.project_id,
            privateKey: serviceAccountJson.private_key,
            clientEmail: serviceAccountJson.client_email,
          });
          console.log("✓ Using Firebase credentials from service account file");
        } catch (error) {
          throw new Error(
            "Firebase service account file not found. Please provide credentials via environment variables or service account file."
          );
        }
      }

      admin.initializeApp({
        credential,
      });

      console.log("✓ Firebase Admin SDK initialized successfully");
      firebaseInitialized = true;
    } catch (error: any) {
      firebaseError = error;
      console.error(
        "✗ Failed to initialize Firebase Admin SDK:",
        error.message
      );

      // Log specific OAuth/network errors
      if (
        error.code === "app/invalid-credential" ||
        error.message?.includes("ETIMEDOUT")
      ) {
        console.error(
          "⚠ Network/credential issue detected. Push notifications will be disabled."
        );
        console.error(
          "  This may be due to IPv6 connectivity issues or firewall blocking."
        );
        console.error(
          "  The app will continue to work without push notifications."
        );
      } else {
        throw error;
      }
    }
  } else {
    firebaseInitialized = true;
  }
}

// Initialize on module load (but don't crash the app if it fails)
initializeFirebase().catch((err) => {
  console.error("Firebase initialization failed:", err.message);
});

// Safe messaging getter with error handling
export const getMessaging = () => {
  if (!firebaseInitialized) {
    if (firebaseError) {
      throw new Error(
        `Firebase not available: ${firebaseError.message}. Push notifications are disabled.`
      );
    }
    throw new Error("Firebase not yet initialized");
  }
  return admin.messaging();
};

// Legacy export for backward compatibility (with safety check)
export const messaging = new Proxy({} as admin.messaging.Messaging, {
  get(target, prop) {
    if (!firebaseInitialized) {
      console.warn(
        `Firebase not initialized. Cannot access messaging.${String(prop)}`
      );
      return undefined;
    }
    return (admin.messaging() as any)[prop];
  },
});
export default admin;
