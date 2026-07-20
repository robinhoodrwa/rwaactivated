import {
  JsonRpcProvider,
  Wallet,
  formatEther,
  getAddress,
} from "./vendor/ethers.min.js?v=20260717.3";
import { ROBINHOOD_TESTNET } from "./protocol-config.js?v=20260717.3";

const STORAGE_KEY = "rwa-passport.embedded-wallet.v1";
let unlockedWallet;
let embeddedProvider;

function readRecord() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const record = JSON.parse(raw);
    if (record?.format !== "rwa-passport-embedded-wallet/v1" || !record.keystore) return null;
    return record;
  } catch {
    return null;
  }
}

function provider() {
  if (!embeddedProvider) {
    embeddedProvider = new JsonRpcProvider(
      ROBINHOOD_TESTNET.rpcUrls[0],
      ROBINHOOD_TESTNET.chainId,
      { staticNetwork: true },
    );
  }
  return embeddedProvider;
}

function connectionFor(wallet) {
  const signer = wallet.connect(provider());
  return Object.freeze({
    embedded: true,
    signer,
    account: getAddress(wallet.address),
    walletName: "RWA in-app wallet",
  });
}

export function hasEmbeddedWallet() {
  return Boolean(readRecord());
}

export function embeddedWalletAddress() {
  return readRecord()?.address || null;
}

export async function createEmbeddedWallet(passphrase, progress) {
  if (hasEmbeddedWallet()) throw new Error("An in-app wallet already exists on this device.");
  if (String(passphrase).length < 10) throw new Error("Create a wallet passphrase with at least 10 characters.");

  const wallet = Wallet.createRandom();
  const keystore = await wallet.encrypt(passphrase, progress);
  const record = {
    format: "rwa-passport-embedded-wallet/v1",
    chainId: ROBINHOOD_TESTNET.chainId,
    address: getAddress(wallet.address),
    createdAt: new Date().toISOString(),
    keystore,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  unlockedWallet = wallet;
  return connectionFor(wallet);
}

export async function unlockEmbeddedWallet(passphrase, progress) {
  const record = readRecord();
  if (!record) throw new Error("No in-app wallet exists on this device.");
  if (unlockedWallet) return connectionFor(unlockedWallet);
  try {
    unlockedWallet = await Wallet.fromEncryptedJson(record.keystore, passphrase, progress);
  } catch {
    throw new Error("The wallet passphrase is incorrect or the encrypted wallet is damaged.");
  }
  return connectionFor(unlockedWallet);
}

export function lockEmbeddedWallet() {
  unlockedWallet = undefined;
}

export async function embeddedWalletBalance() {
  const address = embeddedWalletAddress();
  if (!address) return null;
  const balance = await provider().getBalance(address);
  return `${Number(formatEther(balance)).toLocaleString(undefined, { maximumFractionDigits: 6 })} ETH`;
}

export function downloadEmbeddedWalletBackup() {
  const record = readRecord();
  if (!record) throw new Error("Create an in-app wallet before downloading a backup.");
  const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `rwa-passport-wallet-${record.address.slice(2, 10)}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1_000);
}
