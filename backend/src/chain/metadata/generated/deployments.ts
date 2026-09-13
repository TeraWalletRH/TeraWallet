// Optimistic and configured deployment addresses on Robinhood Chain

export interface DeploymentAddresses {
  sessionManager: `0x${string}`;
  factory: `0x${string}`;
  registry: `0x${string}`;
  venue: `0x${string}`;
}

export const DEPLOYMENTS: Record<number, DeploymentAddresses> = {
  // Robinhood Chain Testnet
  46630: {
    sessionManager: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    factory: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    registry: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    venue: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
  },
  // Robinhood Chain Mainnet
  4663: {
    sessionManager: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    factory: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    registry: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    venue: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
  },
  // Local Hardhat / Anvil
  31337: {
    sessionManager: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    factory: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    registry: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    venue: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
  },
};

export function getDeployments(chainId: number): DeploymentAddresses {
  return (
    DEPLOYMENTS[chainId] ?? {
      sessionManager: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
      factory: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
      registry: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
      venue: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
    }
  );
}
