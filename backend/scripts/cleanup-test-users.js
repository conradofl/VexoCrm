import dotenv from "dotenv";
import { resolve } from "path";
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

// Load local environment variables
dotenv.config({ path: resolve(process.cwd(), '.env') });

const sa = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
};

if (!sa.projectId ||sa.clientEmail === undefined || sa.privateKey === undefined) {
  console.error("Missing Firebase configuration in .env");
  process.exit(1);
}

initializeApp({
  credential: cert(sa),
});

const auth = getAuth();

async function cleanup() {
  console.log("Listing Firebase users...");
  const users = [];
  let nextPageToken;

  do {
    const result = await auth.listUsers(1000, nextPageToken);
    users.push(...result.users);
    nextPageToken = result.pageToken;
  } while (nextPageToken);

  console.log(`Found ${users.length} total users in Firebase.`);

  // Filter test users
  const testUsers = users.filter((u) => {
    const email = u.email || "";
    return email.startsWith("test-") && email.endsWith("@teste.com");
  });

  console.log(`Found ${testUsers.length} test users to delete.`);

  for (const user of testUsers) {
    console.log(`Deleting ${user.email} (${user.uid})...`);
    try {
      await auth.deleteUser(user.uid);
    } catch (e) {
      console.error(`Failed to delete ${user.email}:`, e);
    }
  }

  console.log("Cleanup finished successfully!");
  process.exit(0);
}

cleanup().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
