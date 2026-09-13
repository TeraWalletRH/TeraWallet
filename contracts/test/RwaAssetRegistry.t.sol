// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { RwaAssetRegistry } from "../src/registry/RwaAssetRegistry.sol";

contract RwaAssetRegistryTest is Test {
    RwaAssetRegistry public registry;

    address internal owner = address(0x111);
    address internal guardian = address(0x222);
    address internal asset1 = address(0xAAA);
    address internal asset2 = address(0xBBB);

    bytes32 internal leaf1;
    bytes32 internal leaf2;
    bytes32 internal root;

    function setUp() public {
        leaf1 = keccak256(abi.encodePacked(asset1, "NVDA"));
        leaf2 = keccak256(abi.encodePacked(asset2, "AAPL"));

        // Minimal 2-leaf Merkle tree
        if (leaf1 <= leaf2) {
            root = keccak256(abi.encodePacked(leaf1, leaf2));
        } else {
            root = keccak256(abi.encodePacked(leaf2, leaf1));
        }

        registry = new RwaAssetRegistry(owner, guardian, root);
    }

    function test_VerifyApprovedAsset() public view {
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = leaf2;

        bool verified = registry.verifyAsset(asset1, leaf1, proof);
        assertTrue(verified);
    }

    function test_VerifyInvalidProofFails() public view {
        bytes32[] memory badProof = new bytes32[](1);
        badProof[0] = keccak256("bogus");

        bool verified = registry.verifyAsset(asset1, leaf1, badProof);
        assertFalse(verified);
    }

    function test_GuardianEmergencyCircuitBreaker() public {
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = leaf2;

        // Guardian suspends asset immediately
        vm.prank(guardian);
        registry.setAssetSuspended(asset1, true);

        assertTrue(registry.isSuspended(asset1));

        // Attempting to verify suspended asset reverts
        vm.expectRevert(abi.encodeWithSelector(RwaAssetRegistry.AssetIsSuspended.selector, asset1));
        registry.verifyAsset(asset1, leaf1, proof);

        // Governance unsuspends asset
        vm.prank(owner);
        registry.setAssetSuspended(asset1, false);
        assertFalse(registry.isSuspended(asset1));

        assertTrue(registry.verifyAsset(asset1, leaf1, proof));
    }
}
