export const ROBINHOOD_TESTNET = Object.freeze({
  chainId: 46630,
  chainHex: "0xb626",
  chainName: "Robinhood Chain Testnet",
  nativeCurrency: Object.freeze({ name: "Robinhood ETH", symbol: "ETH", decimals: 18 }),
  rpcUrls: Object.freeze(["https://rpc.testnet.chain.robinhood.com"]),
  explorerUrl: "https://explorer.testnet.chain.robinhood.com",
});

export const WALLETCONNECT = Object.freeze({
  projectId: "84d147bbe6e6696df845ff69dfeed5a7",
});

export const PROTOCOL_CONTRACTS = Object.freeze({
  registry: "0x6EC006ef985a8eD13B78E5c4099910CBB6F56FF2",
  threeDPassClaimCodec: "0x74d146f4e9FF154804917f40055336027f6F6A3c",
});

export const PROTOCOL_ORIGIN = "https://rwaactivated.com";
