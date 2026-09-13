// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { TerraAccount } from "../src/account/TerraAccount.sol";
import { SessionManager } from "../src/session/SessionManager.sol";
import { V4Venue } from "../src/venue/V4Venue.sol";
import { MockERC3643 } from "../src/token/MockERC3643.sol";

contract SessionManagerTest is Test {
    TerraAccount public account;
    SessionManager public sessionManager;
    V4Venue public venue;
    MockERC3643 public token;

    address internal owner = address(0x111);
    address internal sessionKey = address(0x222);
    address internal unapprovedKey = address(0x333);

    function setUp() public {
        sessionManager = new SessionManager();
        account = new TerraAccount(owner, address(sessionManager));
        venue = new V4Venue();
        token = new MockERC3643("Tokenized Stock", "NVDA", owner);

        vm.deal(address(account), 10 ether);
        vm.deal(owner, 10 ether);
        vm.deal(sessionKey, 1 ether);
    }

    function test_RegisterAndExecuteSession() public {
        address[] memory targets = new address[](1);
        targets[0] = address(venue);

        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = venue.claimYield.selector;

        uint48 validAfter = uint48(block.timestamp);
        uint48 validUntil = uint48(block.timestamp + 24 hours);
        uint256 dailyLimitUsd = 50000; // $500 in cents

        // Owner registers session key
        vm.prank(owner);
        account.registerSession(sessionKey, validAfter, validUntil, dailyLimitUsd, targets, selectors);

        (SessionManager.SessionScope memory scope, bool isActive) = sessionManager.getSession(
            address(account),
            sessionKey
        );
        assertTrue(isActive);
        assertEq(scope.dailyLimitUsd, dailyLimitUsd);

        // Session key executes claimYield
        bytes memory data = abi.encodeWithSelector(venue.claimYield.selector, address(token));
        vm.prank(sessionKey);
        account.executeBySession(address(venue), 0, data, 1000); // $10 value
    }

    function test_SessionTargetNotAllowedReverts() public {
        address[] memory targets = new address[](1);
        targets[0] = address(venue);

        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = venue.claimYield.selector;

        vm.prank(owner);
        account.registerSession(
            sessionKey,
            uint48(block.timestamp),
            uint48(block.timestamp + 24 hours),
            50000,
            targets,
            selectors
        );

        // Attempt to call unallowed target contract
        address unallowedTarget = address(token);
        bytes memory data = abi.encodeWithSelector(token.transfer.selector, owner, 10);

        vm.prank(sessionKey);
        vm.expectRevert();
        account.executeBySession(unallowedTarget, 0, data, 100);
    }

    function test_SessionSelectorNotAllowedReverts() public {
        address[] memory targets = new address[](1);
        targets[0] = address(venue);

        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = venue.claimYield.selector;

        vm.prank(owner);
        account.registerSession(
            sessionKey,
            uint48(block.timestamp),
            uint48(block.timestamp + 24 hours),
            50000,
            targets,
            selectors
        );

        // Attempt to call unallowed selector (buy instead of claimYield)
        bytes memory data = abi.encodeWithSelector(venue.buy.selector, address(token), 100);

        vm.prank(sessionKey);
        vm.expectRevert();
        account.executeBySession(address(venue), 0, data, 100);
    }

    function test_SessionDailyLimitExceededReverts() public {
        address[] memory targets = new address[](1);
        targets[0] = address(venue);

        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = venue.claimYield.selector;

        uint256 dailyLimitUsd = 1000; // $10.00 in cents

        vm.prank(owner);
        account.registerSession(
            sessionKey,
            uint48(block.timestamp),
            uint48(block.timestamp + 24 hours),
            dailyLimitUsd,
            targets,
            selectors
        );

        bytes memory data = abi.encodeWithSelector(venue.claimYield.selector, address(token));

        // First call within limit succeeds
        vm.prank(sessionKey);
        account.executeBySession(address(venue), 0, data, 800); // $8.00

        // Second call exceeding remaining $2.00 reverts
        vm.prank(sessionKey);
        vm.expectRevert();
        account.executeBySession(address(venue), 0, data, 500); // $5.00 > $2.00 remaining
    }

    function test_InstantSessionRevocation() public {
        address[] memory targets = new address[](1);
        targets[0] = address(venue);

        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = venue.claimYield.selector;

        vm.prank(owner);
        account.registerSession(
            sessionKey,
            uint48(block.timestamp),
            uint48(block.timestamp + 24 hours),
            50000,
            targets,
            selectors
        );

        // Owner revokes session with one tap
        vm.prank(owner);
        account.revokeSession(sessionKey);

        (, bool isActive) = sessionManager.getSession(address(account), sessionKey);
        assertFalse(isActive);

        // Subsequent call by session key fails immediately
        bytes memory data = abi.encodeWithSelector(venue.claimYield.selector, address(token));
        vm.prank(sessionKey);
        vm.expectRevert();
        account.executeBySession(address(venue), 0, data, 100);
    }
}
