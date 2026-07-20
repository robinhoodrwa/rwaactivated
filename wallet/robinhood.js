import {
  BrowserProvider,
  Contract,
  JsonRpcProvider,
  getAddress,
  isAddress,
} from "./vendor/ethers.min.js?v=20260717.3";
import {
  PROTOCOL_CONTRACTS,
  PROTOCOL_ORIGIN,
  ROBINHOOD_TESTNET,
  WALLETCONNECT,
} from "./protocol-config.js?v=20260717.3";
import { normalizeBytes32, sha256Json } from "./recognition.js?v=20260717.3";

export const REGISTRY_ABI = Object.freeze([
  "function anchor(bytes32 passportId, bytes32 manifestHash, bytes32 physicalId, bytes32 physicalMethod, string uri) returns (uint64 version)",
  "function resolve(bytes32 passportId) view returns (uint64 version, tuple(bytes32 manifestHash, bytes32 physicalId, bytes32 physicalMethod, uint64 anchoredAt, address anchoredBy, bool revoked, string uri) current)",
  "function getAnchor(bytes32 passportId, uint64 version) view returns (tuple(bytes32 manifestHash, bytes32 physicalId, bytes32 physicalMethod, uint64 anchoredAt, address anchoredBy, bool revoked, string uri) result)",
  "function latestVersion(bytes32 passportId) view returns (uint64)",
  "function controllerOf(bytes32 passportId) view returns (address)",
  "function pendingControllerOf(bytes32 passportId) view returns (address)",
  "function setRevoked(bytes32 passportId, uint64 version, bool revoked)",
  "function proposeController(bytes32 passportId, address newController)",
  "function acceptController(bytes32 passportId)",
  "event PassportAnchored(bytes32 indexed passportId, uint64 indexed version, bytes32 indexed manifestHash, bytes32 physicalId, bytes32 physicalMethod, address controller, string uri)",
  "event AnchorRevocationChanged(bytes32 indexed passportId, uint64 indexed version, bool revoked)",
]);

const announcedProviders = new Map();
const ROBINHOOD_WALLET_ID = "8837dd9413b1d9b585ee937d27a816590248386d9dbf59f5cd3422dbbb65683e";
let readonlyProvider;
let walletConnectProvider;

function assertDeployment() {
  if (!isAddress(PROTOCOL_CONTRACTS.registry)) {
    throw new Error("The Robinhood testnet registry deployment is not configured.");
  }
}

function captureProvider(event) {
  const detail = event.detail;
  if (!detail?.info?.uuid || !detail?.provider) return;
  announcedProviders.set(detail.info.uuid, detail);
}

if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", captureProvider);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

function inferWalletName(provider, info = {}) {
  const announcedName = String(info.name || "").trim();
  if (announcedName) return announcedName;
  if (provider?.isRobinhoodMobileWallet || provider?.isRobinhood) return "Robinhood Wallet";
  if (provider?.isRabby) return "Rabby Wallet";
  if (provider?.isCoinbaseWallet) return "Coinbase Wallet";
  if (provider?.isMetaMask) return "MetaMask";
  return "Browser wallet";
}

function listLegacyProviders() {
  if (typeof window === "undefined") return [];
  const ethereum = window.ethereum;
  const providers = [
    window.robinhood?.ethereum,
    ...(Array.isArray(ethereum?.providers) ? ethereum.providers : []),
    ethereum,
  ];
  return providers.filter(Boolean).map((provider, index) => ({
    info: {
      uuid: `legacy-${index}`,
      name: inferWalletName(provider),
      rdns: "",
    },
    provider,
  }));
}

export function listBrowserProviders() {
  const providers = [];
  const seen = new Set();
  for (const detail of [...announcedProviders.values(), ...listLegacyProviders()]) {
    if (!detail?.provider || seen.has(detail.provider)) continue;
    seen.add(detail.provider);
    providers.push(Object.freeze({
      info: Object.freeze({
        uuid: detail.info?.uuid || `provider-${providers.length}`,
        name: inferWalletName(detail.provider, detail.info),
        rdns: String(detail.info?.rdns || ""),
        icon: String(detail.info?.icon || ""),
      }),
      provider: detail.provider,
    }));
  }
  return providers;
}

export async function discoverBrowserProviders(timeoutMs = 250) {
  if (typeof window === "undefined") return [];
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  if (timeoutMs > 0) {
    await new Promise((resolve) => window.setTimeout(resolve, timeoutMs));
  }
  return listBrowserProviders();
}


export function normalizeChainId(value) {
  if (typeof value === "number") {
    if (Number.isSafeInteger(value) && value >= 0) return value;
    throw new Error(`Invalid chain ID: ${value}`);
  }
  if (typeof value === "bigint") {
    if (value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
    throw new Error(`Invalid chain ID: ${value}`);
  }

  const text = String(value ?? "").trim();
  if (!/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(text)) {
    throw new Error(`Invalid chain ID: ${text || "empty value"}`);
  }
  const parsed = BigInt(text);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Chain ID exceeds the safe integer range: ${text}`);
  }
  return Number(parsed);
}

export function walletConnectSessionSupportsChain(session, chainId) {
  const chain = `eip155:${normalizeChainId(chainId)}`;
  return Object.entries(session?.namespaces || {}).some(([namespaceKey, namespace]) => (
    namespaceKey === chain
    || namespace?.chains?.includes(chain)
    || namespace?.accounts?.some((account) => account.startsWith(`${chain}:`))
  ));
}

export async function ensureRobinhoodTestnet(provider) {
  const current = await provider.request({ method: "eth_chainId" });
  if (normalizeChainId(current) === ROBINHOOD_TESTNET.chainId) return;
  if (provider?.isWalletConnect) {
    throw new Error(`Reconnect Robinhood Wallet and approve ${ROBINHOOD_TESTNET.chainName}.`);
  }

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: ROBINHOOD_TESTNET.chainHex }],
    });
  } catch (error) {
    const code = error?.code ?? error?.data?.originalError?.code;
    if (Number(code) !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: ROBINHOOD_TESTNET.chainHex,
          chainName: ROBINHOOD_TESTNET.chainName,
          nativeCurrency: ROBINHOOD_TESTNET.nativeCurrency,
          rpcUrls: [...ROBINHOOD_TESTNET.rpcUrls],
          blockExplorerUrls: [ROBINHOOD_TESTNET.explorerUrl],
        },
      ],
    });
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: ROBINHOOD_TESTNET.chainHex }],
    });
  }

  const selected = await provider.request({ method: "eth_chainId" });
  if (normalizeChainId(selected) !== ROBINHOOD_TESTNET.chainId) {
    throw new Error(`Select ${ROBINHOOD_TESTNET.chainName} in your wallet.`);
  }
}

export async function connectInjectedWallet(providerDetail) {
  const selected = providerDetail?.provider
    ? providerDetail
    : (await discoverBrowserProviders(750))[0];
  if (!selected?.provider) {
    throw new Error("No browser wallet was detected. Use WalletConnect or open this page inside a wallet browser.");
  }
  return connectEip1193(selected.provider, selected.info);
}

async function getWalletConnectProvider() {
  if (walletConnectProvider) return walletConnectProvider;

  const { EthereumProvider } = await import("./vendor/walletconnect.min.js?v=20260717.3");
  walletConnectProvider = await EthereumProvider.init({
    projectId: WALLETCONNECT.projectId,
    chains: [ROBINHOOD_TESTNET.chainId],
    showQrModal: true,
    rpcMap: {
      [ROBINHOOD_TESTNET.chainId]: ROBINHOOD_TESTNET.rpcUrls[0],
    },
    metadata: {
      name: "RWA Passport",
      description: "Local-first object passports anchored on Robinhood Chain testnet.",
      url: `${PROTOCOL_ORIGIN}/wallet/`,
      icons: [`${PROTOCOL_ORIGIN}/favicon.svg`],
      redirect: {
        native: "rwapassport://wallet",
        universal: `${PROTOCOL_ORIGIN}/wallet/`,
      },
    },
    qrModalOptions: {
      themeMode: "dark",
      enableMobileFullScreen: true,
      explorerRecommendedWalletIds: [ROBINHOOD_WALLET_ID],
      themeVariables: {
        "--wcm-accent-color": "#72ff78",
        "--wcm-background-color": "#0d1b12",
        "--wcm-font-family": "Inter, ui-sans-serif, system-ui, sans-serif",
        "--wcm-z-index": "1000",
      },
    },
    telemetryEnabled: false,
  });
  return walletConnectProvider;
}

export async function connectWalletConnect() {
  const provider = await getWalletConnectProvider();
  const expiresAt = Number(provider.session?.expiry || 0);
  const expired = expiresAt > 0 && expiresAt <= Math.floor(Date.now() / 1_000);
  const wrongChain = provider.session && (
    !walletConnectSessionSupportsChain(provider.session, ROBINHOOD_TESTNET.chainId)
    || normalizeChainId(provider.chainId) !== ROBINHOOD_TESTNET.chainId
  );
  if (provider.session && (expired || wrongChain)) {
    await provider.disconnect().catch(() => {});
  }

  if (!provider.session) await provider.connect();
  return connectEip1193(provider, provider.session?.peer?.metadata || {});
}


export async function connectEip1193(provider, metadata = {}) {
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!accounts?.[0]) throw new Error("The wallet did not return an account.");
  await ensureRobinhoodTestnet(provider);

  return Object.freeze({
    eip1193: provider,
    browserProvider: new BrowserProvider(provider, "any"),
    account: getAddress(accounts[0]),
    walletName: metadata.name || inferWalletName(provider, metadata),
  });
}

export function getReadonlyProvider() {
  if (!readonlyProvider) {
    readonlyProvider = new JsonRpcProvider(
      ROBINHOOD_TESTNET.rpcUrls[0],
      ROBINHOOD_TESTNET.chainId,
      { staticNetwork: true },
    );
  }
  return readonlyProvider;
}

export function getRegistry(runner = getReadonlyProvider()) {
  assertDeployment();
  return new Contract(PROTOCOL_CONTRACTS.registry, REGISTRY_ABI, runner);
}

export async function preparePassportAnchor({ passportId, manifest, physicalClaim }) {
  const normalizedPassportId = normalizeBytes32(passportId);
  const manifestHash = await sha256Json(manifest);
  const physicalId = await sha256Json({
    algorithm: physicalClaim.algorithm,
    implementation: physicalClaim.implementation,
    gridSize: physicalClaim.gridSize,
    sections: physicalClaim.sections,
    depth: physicalClaim.depth,
    hashes: [...physicalClaim.hashes].sort(),
  });
  const physicalMethod = await sha256Json({
    method: physicalClaim.method,
    algorithm: physicalClaim.algorithm,
    implementation: physicalClaim.implementation,
    gridSize: physicalClaim.gridSize,
    sections: physicalClaim.sections,
    depth: physicalClaim.depth,
  });
  const uri = `${PROTOCOL_ORIGIN}/verify/?id=${encodeURIComponent(normalizedPassportId)}`;

  return Object.freeze({
    passportId: normalizedPassportId,
    manifestHash,
    physicalId,
    physicalMethod,
    uri,
  });
}

async function connectionSigner(connection) {
  if (connection?.signer) return connection.signer;
  await ensureRobinhoodTestnet(connection.eip1193);
  return connection.browserProvider.getSigner();
}

export async function anchorPassport(connection, prepared) {
  assertDeployment();
  const signer = await connectionSigner(connection);
  const registry = getRegistry(signer);
  const transaction = await registry.anchor(
    prepared.passportId,
    prepared.manifestHash,
    prepared.physicalId,
    prepared.physicalMethod,
    prepared.uri,
  );
  const receipt = await transaction.wait();

  return Object.freeze({
    transactionHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    explorerUrl: `${ROBINHOOD_TESTNET.explorerUrl}/tx/${receipt.hash}`,
  });
}

function normalizeAnchor(version, anchor) {
  return Object.freeze({
    version: Number(version),
    manifestHash: anchor.manifestHash,
    physicalId: anchor.physicalId,
    physicalMethod: anchor.physicalMethod,
    anchoredAt: new Date(Number(anchor.anchoredAt) * 1_000).toISOString(),
    anchoredBy: anchor.anchoredBy,
    revoked: anchor.revoked,
    uri: anchor.uri,
  });
}

export async function resolvePassport(passportId, runner = getReadonlyProvider()) {
  const normalized = normalizeBytes32(passportId);
  const registry = getRegistry(runner);
  const [version, anchor] = await registry.resolve(normalized);
  const controller = await registry.controllerOf(normalized);
  return Object.freeze({
    passportId: normalized,
    controller,
    ...normalizeAnchor(version, anchor),
  });
}

export async function getPassportVersion(passportId, version) {
  const normalized = normalizeBytes32(passportId);
  const anchor = await getRegistry().getAnchor(normalized, version);
  return Object.freeze({
    passportId: normalized,
    ...normalizeAnchor(version, anchor),
  });
}

export async function setPassportRevoked(connection, passportId, version, revoked) {
  const signer = await connectionSigner(connection);
  const transaction = await getRegistry(signer).setRevoked(
    normalizeBytes32(passportId),
    version,
    Boolean(revoked),
  );
  const receipt = await transaction.wait();
  return Object.freeze({
    transactionHash: receipt.hash,
    explorerUrl: `${ROBINHOOD_TESTNET.explorerUrl}/tx/${receipt.hash}`,
  });
}

export function formatChainError(error) {
  const message =
    error?.shortMessage ||
    error?.reason ||
    error?.data?.message ||
    error?.message ||
    "Robinhood Chain request failed.";

  if (/user rejected|user denied|ACTION_REJECTED|connection request reset/i.test(message)) {
    return "Wallet request cancelled.";
  }
  if (/insufficient funds/i.test(message)) {
    return "This Robinhood testnet account needs enough ETH for gas.";
  }
  if (/NotController/i.test(message)) {
    return "Only this passport's controller can publish the next version.";
  }
  if (/DuplicateManifest/i.test(message)) {
    return "This exact manifest is already the latest anchored version.";
  }
  return message.replace(/^Error:\s*/i, "");
}
