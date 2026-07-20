import assert from "node:assert/strict";
import test from "node:test";

import {
  ensureRobinhoodTestnet,
  normalizeChainId,
  walletConnectSessionSupportsChain,
} from "./wallet/robinhood.js";

const CHAIN_ID = 46_630;
const CHAIN_HEX = "0xb626";

function createProvider(initialChainId, { unknownOnFirstSwitch = false } = {}) {
  let chainId = initialChainId;
  let firstSwitch = unknownOnFirstSwitch;
  const calls = [];

  return {
    calls,
    provider: {
      async request({ method, params }) {
        calls.push(method);
        if (method === "eth_chainId") return chainId;
        if (method === "wallet_addEthereumChain") return null;
        if (method === "wallet_switchEthereumChain") {
          if (firstSwitch) {
            firstSwitch = false;
            const error = new Error("Unknown chain");
            error.code = 4902;
            throw error;
          }
          chainId = params[0].chainId;
          return null;
        }
        throw new Error(`Unexpected method: ${method}`);
      },
    },
  };
}

test("chain IDs normalize from WalletConnect numbers and EIP-1193 strings", () => {
  assert.equal(normalizeChainId(CHAIN_ID), CHAIN_ID);
  assert.equal(normalizeChainId(BigInt(CHAIN_ID)), CHAIN_ID);
  assert.equal(normalizeChainId(String(CHAIN_ID)), CHAIN_ID);
  assert.equal(normalizeChainId(CHAIN_HEX), CHAIN_ID);
  assert.throws(() => normalizeChainId("not-a-chain"), /Invalid chain ID/);
});

test("WalletConnect sessions must explicitly approve Robinhood Chain", () => {
  const robinhoodAccount = "eip155:46630:0x0000000000000000000000000000000000000001";
  const mainnetAccount = "eip155:1:0x0000000000000000000000000000000000000001";

  assert.equal(walletConnectSessionSupportsChain({
    namespaces: { eip155: { accounts: [robinhoodAccount], methods: [], events: [] } },
  }, CHAIN_ID), true);
  assert.equal(walletConnectSessionSupportsChain({
    namespaces: { eip155: { accounts: [mainnetAccount], methods: [], events: [] } },
  }, CHAIN_ID), false);
});


test("WalletConnect numeric chain IDs do not trigger a false network switch", async () => {
  const { provider, calls } = createProvider(CHAIN_ID);

  await ensureRobinhoodTestnet(provider);

  assert.deepEqual(calls, ["eth_chainId"]);
});

test("a wrong-chain WalletConnect session is rejected without requesting an unsupported switch", async () => {
  const { provider, calls } = createProvider("0x1");
  provider.isWalletConnect = true;

  await assert.rejects(
    ensureRobinhoodTestnet(provider),
    /Reconnect Robinhood Wallet and approve Robinhood Chain Testnet/,
  );
  assert.deepEqual(calls, ["eth_chainId"]);
});

test("a known chain switches once to Robinhood Chain Testnet", async () => {
  const { provider, calls } = createProvider("0x1");

  await ensureRobinhoodTestnet(provider);

  assert.deepEqual(calls, [
    "eth_chainId",
    "wallet_switchEthereumChain",
    "eth_chainId",
  ]);
});

test("an unknown chain is added and then selected", async () => {
  const { provider, calls } = createProvider("0x1", { unknownOnFirstSwitch: true });

  await ensureRobinhoodTestnet(provider);

  assert.deepEqual(calls, [
    "eth_chainId",
    "wallet_switchEthereumChain",
    "wallet_addEthereumChain",
    "wallet_switchEthereumChain",
    "eth_chainId",
  ]);
});
