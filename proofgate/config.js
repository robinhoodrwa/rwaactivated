// Proof-to-Capital / RWA ProofGate — deployment configuration.
// If CONTRACTS.proofGate is ever set to null (e.g. during a redeploy), the UI
// reports the contract as unavailable; it never simulates chain state.

export const NETWORK = Object.freeze({
  chainId: 46630,
  chainHex: "0xb626",
  chainName: "Robinhood Chain Testnet",
  nativeCurrency: Object.freeze({ name: "Robinhood ETH", symbol: "ETH", decimals: 18 }),
  rpcUrls: Object.freeze(["https://rpc.testnet.chain.robinhood.com"]),
  explorerUrl: "https://explorer.testnet.chain.robinhood.com",
});

export const CONTRACTS = Object.freeze({
  // ObjectPassportRegistry — live on testnet 46630.
  registry: "0x6EC006ef985a8eD13B78E5c4099910CBB6F56FF2",
  // Test USDG settlement token (6 decimals, fixed supply, explorer-verified).
  settlementToken: "0x41219a0a9C0b86ED81933c788a6B63Dfef8f17eE",
  // RwaProofGate facility contract — deployed 2026-07-18, immutable wiring to
  // the registry and test USDG above (deploy tx 0x494da15aa2e7b3addb31c49170bd9e3b7044f4c5e9884f52cdb79c9a7859dfb3).
  proofGate: "0x1d460d731Bd5a0fF2cA07309dAEB8641a7b175A1",
});

export const SETTLEMENT = Object.freeze({
  symbol: "tUSDG",
  decimals: 6,
});

// A real anchor that exists on the live testnet registry. Used only to
// prefill the passport lookup with something resolvable — every value shown
// for it is read from chain at request time, never from this file.
export const DEMO_PASSPORT = Object.freeze({
  passportId: "0x92857a9052df816248310bc7c46b44442274449ce75d31d3206d7cb9e7f33530",
  physicalId: "0x6b382cc8810798473ecd31ce7a28eb942357fc8864bd49c728af00c99df873bc",
});

// Canonical claim-type labels. On-chain claim types are bytes32 values chosen
// by the lender at facility creation; the convention is keccak256(label).
// Unknown bytes32 types still render as raw hex — nothing is hidden.
export const CLAIM_TYPE_LABELS = Object.freeze([
  Object.freeze({ label: "rwa.proofgate.claim.delivery", title: "Delivery confirmation", hint: "Carrier or site agent attests the equipment arrived where the facility says it should." }),
  Object.freeze({ label: "rwa.proofgate.claim.title-legal", title: "Title / legal opinion", hint: "Counsel attests a title and lien review was completed and documented offchain." }),
  Object.freeze({ label: "rwa.proofgate.claim.inspection", title: "Inspection report", hint: "Independent inspector attests condition and serial identity were checked." }),
  Object.freeze({ label: "rwa.proofgate.claim.insurance", title: "Insurance certificate", hint: "Broker or insurer attests coverage is bound for the facility term." }),
  Object.freeze({ label: "rwa.proofgate.claim.custody", title: "Custody / possession", hint: "Custodian or site controller attests who holds the equipment today." }),
]);

export const FACILITY_STATES = Object.freeze([
  "None",
  "Created",
  "Funded",
  "Drawn",
  "Closed",
  "Cancelled",
]);

// DrawReason enum — stable API reason codes from RwaProofGate.canDraw.
export const DRAW_REASONS = Object.freeze([
  Object.freeze({ code: "Ready", text: "All gates are satisfied. Drawdown can execute to the pre-approved payee." }),
  Object.freeze({ code: "FacilityNotFound", text: "No facility exists under this ID." }),
  Object.freeze({ code: "InvalidState", text: "The facility is not in the Funded state, so the gate is closed." }),
  Object.freeze({ code: "NotFullyFunded", text: "Escrow has not received the full principal from the lender." }),
  Object.freeze({ code: "DeliveryNotAccepted", text: "The borrower has not accepted delivery against the passport yet." }),
  Object.freeze({ code: "PassportNotFound", text: "The referenced passport has no anchored version in the registry." }),
  Object.freeze({ code: "PassportRevoked", text: "The latest passport anchor is revoked in the registry." }),
  Object.freeze({ code: "PassportPhysicalIdMismatch", text: "The passport's current physical ID no longer matches the facility." }),
  Object.freeze({ code: "BorrowerNotPassportController", text: "The borrower is not the passport controller in the registry." }),
  Object.freeze({ code: "MissingClaims", text: "One or more required claims are missing, expired, revoked, or from the wrong issuer." }),
]);

export const PROOFGATE_ABI = Object.freeze([
  "function passportRegistry() view returns (address)",
  "function settlementToken() view returns (address)",
  "function nextFacilityId() view returns (uint256)",
  "function MAX_REQUIRED_CLAIMS() view returns (uint256)",
  "function facilities(uint256 facilityId) view returns (address lender, address borrower, address payee, bytes32 passportId, bytes32 physicalId, uint256 principal, bytes32 policyHash, uint8 state, uint256 funded, uint256 drawn, uint256 repaid)",
  "function deliveryAccepted(uint256 facilityId) view returns (bool)",
  "function activeFacilityByPhysicalId(bytes32 physicalId) view returns (uint256)",
  "function requirementCount(uint256 facilityId) view returns (uint256)",
  "function getRequirement(uint256 facilityId, uint256 index) view returns (tuple(bytes32 claimType, address issuer))",
  "function getClaim(uint256 facilityId, bytes32 claimType) view returns (tuple(address issuer, bytes32 digest, uint64 expiresAt, bool revoked))",
  "function canDraw(uint256 facilityId) view returns (bool ready, uint8 reason, uint256 missingClaimsBitmap)",
  "function createFacility(address borrower, address payee, bytes32 passportId, bytes32 physicalId, uint256 principal, bytes32 policyHash, bytes32[] claimTypes, address[] issuers) returns (uint256 facilityId)",
  "function fundFacility(uint256 facilityId, uint256 amount)",
  "function publishClaim(uint256 facilityId, bytes32 claimType, bytes32 digest, uint64 expiresAt)",
  "function revokeClaim(uint256 facilityId, bytes32 claimType)",
  "function acceptDelivery(uint256 facilityId)",
  "function draw(uint256 facilityId)",
  "function repay(uint256 facilityId, uint256 amount)",
  "function cancelFacility(uint256 facilityId)",
  "function releaseFacility(uint256 facilityId)",
  "event FacilityCreated(uint256 indexed facilityId, address indexed lender, address indexed borrower, address payee, bytes32 passportId, bytes32 physicalId, uint256 principal, bytes32 policyHash)",
  "event FacilityFunded(uint256 indexed facilityId, uint256 amount, uint256 totalFunded)",
  "event ClaimPublished(uint256 indexed facilityId, bytes32 indexed claimType, address indexed issuer, bytes32 digest, uint64 expiresAt)",
  "event ClaimRevoked(uint256 indexed facilityId, bytes32 indexed claimType, address indexed issuer, bytes32 digest)",
  "event DeliveryAccepted(uint256 indexed facilityId, bytes32 indexed passportId, uint64 passportVersion)",
  "event FacilityDrawn(uint256 indexed facilityId, address indexed payee, uint256 amount)",
  "event FacilityCancelled(uint256 indexed facilityId, uint256 refunded)",
  "event FacilityRepaid(uint256 indexed facilityId, address indexed payer, uint256 amount, uint256 totalRepaid)",
  "event FacilityClosed(uint256 indexed facilityId)",
  "event FacilityReleased(uint256 indexed facilityId, uint256 amountReleased)",
  "error AmountExceedsOutstanding(uint256 amount, uint256 outstanding)",
  "error ClaimNotFound(uint256 facilityId, bytes32 claimType)",
  "error DrawNotReady(uint8 reason, uint256 missingClaimsBitmap)",
  "error DuplicateClaimType(bytes32 claimType)",
  "error DuplicatePhysicalId(bytes32 physicalId, uint256 activeFacilityId)",
  "error FacilityNotFound(uint256 facilityId)",
  "error InvalidAddress()",
  "error InvalidAmount()",
  "error InvalidClaim(bytes32 claimType, address issuer)",
  "error InvalidClaimExpiry(uint64 expiresAt)",
  "error InvalidDigest()",
  "error InvalidFacilityState(uint256 facilityId, uint8 actual)",
  "error InvalidPassport(bytes32 passportId, bytes32 physicalId)",
  "error NotBorrower(address caller)",
  "error NotLender(address caller)",
  "error NotPassportController(address caller, bytes32 passportId)",
  "error PassportAnchorRevoked(bytes32 passportId, uint64 version)",
  "error PhysicalIdMismatch(bytes32 expected, bytes32 actual)",
  "error TooManyRequiredClaims(uint256 supplied, uint256 maximum)",
  "error UnauthorizedIssuer(address caller, address approvedIssuer)",
]);

export const REGISTRY_ABI = Object.freeze([
  "function resolve(bytes32 passportId) view returns (uint64 version, tuple(bytes32 manifestHash, bytes32 physicalId, bytes32 physicalMethod, uint64 anchoredAt, address anchoredBy, bool revoked, string uri) current)",
  "function getAnchor(bytes32 passportId, uint64 version) view returns (tuple(bytes32 manifestHash, bytes32 physicalId, bytes32 physicalMethod, uint64 anchoredAt, address anchoredBy, bool revoked, string uri) result)",
  "function latestVersion(bytes32 passportId) view returns (uint64)",
  "function controllerOf(bytes32 passportId) view returns (address)",
]);

export const ERC20_ABI = Object.freeze([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
