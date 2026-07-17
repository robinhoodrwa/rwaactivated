const DATABASE_NAME = "rwa-passport-wallet";
const DATABASE_VERSION = 1;
const PASSPORT_STORE = "passports";
const VERIFICATION_STORE = "verifications";

let databasePromise;

function openDatabase() {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PASSPORT_STORE)) {
        const passports = database.createObjectStore(PASSPORT_STORE, { keyPath: "passportId" });
        passports.createIndex("updatedAt", "updatedAt");
        passports.createIndex("status", "status");
      }
      if (!database.objectStoreNames.contains(VERIFICATION_STORE)) {
        const verifications = database.createObjectStore(VERIFICATION_STORE, {
          keyPath: "verificationId",
        });
        verifications.createIndex("passportId", "passportId");
        verifications.createIndex("verifiedAt", "verifiedAt");
      }
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
    request.addEventListener("blocked", () =>
      reject(new Error("Close the older wallet tab before upgrading local storage.")),
    );
  });

  return databasePromise;
}

async function run(storeName, mode, operation) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let request;

    try {
      request = operation(store);
    } catch (error) {
      reject(error);
      return;
    }

    transaction.addEventListener("complete", () => resolve(request?.result));
    transaction.addEventListener("error", () => reject(transaction.error));
    transaction.addEventListener("abort", () =>
      reject(transaction.error || new Error("Local wallet storage was interrupted.")),
    );
  });
}

export async function savePassport(passport) {
  const record = structuredClone(passport);
  await run(PASSPORT_STORE, "readwrite", (store) => store.put(record));
  return record;
}

export async function getPassport(passportId) {
  const result = await run(PASSPORT_STORE, "readonly", (store) => store.get(passportId));
  return result ?? null;
}

export async function listPassports() {
  const results = await run(PASSPORT_STORE, "readonly", (store) => store.getAll());
  return results.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function deletePassport(passportId) {
  await run(PASSPORT_STORE, "readwrite", (store) => store.delete(passportId));
}

export async function saveVerification(verification) {
  const record = structuredClone(verification);
  await run(VERIFICATION_STORE, "readwrite", (store) => store.put(record));
  return record;
}

export async function listVerifications(passportId) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(VERIFICATION_STORE, "readonly");
    const index = transaction.objectStore(VERIFICATION_STORE).index("passportId");
    const request = index.getAll(passportId);
    request.addEventListener("success", () =>
      resolve(request.result.sort((left, right) => right.verifiedAt.localeCompare(left.verifiedAt))),
    );
    request.addEventListener("error", () => reject(request.error));
  });
}

export async function exportWalletData() {
  const [passports, verifications] = await Promise.all([
    listPassports(),
    run(VERIFICATION_STORE, "readonly", (store) => store.getAll()),
  ]);

  return {
    format: "rwa-passport-wallet-export/v1",
    exportedAt: new Date().toISOString(),
    passports,
    verifications,
  };
}

export async function importWalletData(payload) {
  if (payload?.format !== "rwa-passport-wallet-export/v1") {
    throw new TypeError("This is not an RWA Passport Wallet export.");
  }
  if (!Array.isArray(payload.passports) || !Array.isArray(payload.verifications)) {
    throw new TypeError("The wallet export is incomplete.");
  }

  const database = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(
      [PASSPORT_STORE, VERIFICATION_STORE],
      "readwrite",
    );
    const passports = transaction.objectStore(PASSPORT_STORE);
    const verifications = transaction.objectStore(VERIFICATION_STORE);
    for (const passport of payload.passports) passports.put(structuredClone(passport));
    for (const verification of payload.verifications) {
      verifications.put(structuredClone(verification));
    }
    transaction.addEventListener("complete", resolve);
    transaction.addEventListener("error", () => reject(transaction.error));
    transaction.addEventListener("abort", () => reject(transaction.error));
  });
}
