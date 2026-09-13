// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Script, console } from "forge-std/Script.sol";
import { SessionManager } from "../src/session/SessionManager.sol";
import { TerraAccountFactory } from "../src/account/TerraAccountFactory.sol";
import { RwaAssetRegistry } from "../src/registry/RwaAssetRegistry.sol";
import { V4Venue } from "../src/venue/V4Venue.sol";
import { MockERC3643 } from "../src/token/MockERC3643.sol";

contract DeployScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envOr(
            "DEPLOYER_PRIVATE_KEY",
            uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80) // Default Anvil key #0
        );

        address deployer = vm.addr(deployerPrivateKey);
        console.log("Deploying Terra Wallet contracts with account:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        SessionManager sessionManager = new SessionManager();
        console.log("SessionManager deployed at:", address(sessionManager));

        TerraAccountFactory factory = new TerraAccountFactory(address(sessionManager));
        console.log("TerraAccountFactory deployed at:", address(factory));

        RwaAssetRegistry registry = new RwaAssetRegistry(
            deployer,
            deployer,
            bytes32(0)
        );
        console.log("RwaAssetRegistry deployed at:", address(registry));

        V4Venue venue = new V4Venue();
        console.log("V4Venue deployed at:", address(venue));

        MockERC3643 mockNvda = new MockERC3643("Tokenized NVIDIA", "NVDA", deployer);
        console.log("Mock NVDA Token deployed at:", address(mockNvda));

        vm.stopBroadcast();
    }
}
