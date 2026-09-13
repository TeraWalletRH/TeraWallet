// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { TerraAccountFactory } from "../src/account/TerraAccountFactory.sol";
import { TerraAccount } from "../src/account/TerraAccount.sol";
import { SessionManager } from "../src/session/SessionManager.sol";

contract TerraAccountFactoryTest is Test {
    TerraAccountFactory public factory;
    SessionManager public sessionManager;

    address internal owner = address(0x1234);
    bytes32 internal salt = keccak256("test-salt-1");

    function setUp() public {
        sessionManager = new SessionManager();
        factory = new TerraAccountFactory(address(sessionManager));
    }

    function test_ComputeAndDeployAccount() public {
        address predictedAddress = factory.getAddress(owner, salt);

        // Code does not exist yet
        assertEq(predictedAddress.code.length, 0);

        address deployedAddress = factory.createAccount(owner, salt);

        assertEq(deployedAddress, predictedAddress);
        assertTrue(deployedAddress.code.length > 0);
        assertEq(TerraAccount(payable(deployedAddress)).owner(), owner);

        // Calling createAccount again returns existing address without reverting
        address reAddress = factory.createAccount(owner, salt);
        assertEq(reAddress, predictedAddress);
    }
}
