import assert from "node:assert/strict";
import test from "node:test";

const values = new Map();
globalThis.localStorage = {
  getItem(key) {
    return values.get(key) ?? null;
  },
  setItem(key, value) {
    values.set(key, String(value));
  },
  removeItem(key) {
    values.delete(key);
  },
};

const {
  createEmbeddedWallet,
  embeddedWalletAddress,
  hasEmbeddedWallet,
  lockEmbeddedWallet,
  unlockEmbeddedWallet,
} = await import("./wallet/embedded-wallet.js");

test("creates an encrypted local wallet and unlocks the same Robinhood signer", async () => {
  const passphrase = "correct horse battery stable";
  const connection = await createEmbeddedWallet(passphrase);
  const stored = values.get("rwa-passport.embedded-wallet.v1");
  const record = JSON.parse(stored);

  assert.equal(record.format, "rwa-passport-embedded-wallet/v1");
  assert.equal(record.chainId, 46630);
  assert.equal(hasEmbeddedWallet(), true);
  assert.equal(embeddedWalletAddress(), connection.account);
  assert.equal(record.address, connection.account);
  assert.equal(stored.includes(passphrase), false);
  assert.equal(stored.includes(connection.signer.privateKey), false);

  lockEmbeddedWallet();
  await assert.rejects(
    unlockEmbeddedWallet("incorrect wallet passphrase"),
    /incorrect or the encrypted wallet is damaged/,
  );

  const unlocked = await unlockEmbeddedWallet(passphrase);
  assert.equal(unlocked.embedded, true);
  assert.equal(await unlocked.signer.getAddress(), connection.account);
  assert.equal(Number((await unlocked.signer.provider.getNetwork()).chainId), 46630);
});
