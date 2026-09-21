// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { BuildAnchor } from "../src/registry/BuildAnchor.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

contract BuildAnchorTest is Test {
    BuildAnchor internal anchor;

    address internal owner = address(0x111);
    address internal stranger = address(0x222);

    // The real file hash of release r-84b83f4cdd75, so the test exercises the property the
    // whole design rests on: a release id is the first six bytes of its code hash.
    bytes32 internal constant CODE_HASH =
        0x84b83f4cdd75522b916fec573d46f14532bca5949937a406f778e72aaa624191;
    bytes32 internal constant MODEL_HASH = keccak256("model");
    bytes6 internal constant RELEASE = bytes6(CODE_HASH);

    function setUp() public {
        vm.warp(1_770_000_000);
        anchor = new BuildAnchor(owner);
    }

    function _anchorCurrent() internal returns (bytes6) {
        vm.prank(owner);
        return anchor.anchorBuild(CODE_HASH, MODEL_HASH);
    }

    function test_ReleaseIdIsDerivedFromTheCodeHash() public {
        bytes6 release = _anchorCurrent();
        assertEq(release, RELEASE);
        // There is no call that anchors a release id against some other build's files.
        BuildAnchor.Anchor memory record = anchor.anchorOf(release);
        assertEq(record.codeHash, CODE_HASH);
        assertEq(record.modelHash, MODEL_HASH);
        assertEq(record.anchoredAt, uint64(block.timestamp));
        assertEq(record.withdrawnAt, 0);
    }

    function test_AnchoredBuildVerifies() public {
        _anchorCurrent();
        (BuildAnchor.Status status, uint64 anchoredAt, uint64 withdrawnAt) = anchor.verifyReceipt(
            RELEASE,
            CODE_HASH
        );
        assertEq(uint8(status), uint8(BuildAnchor.Status.Anchored));
        assertEq(anchoredAt, uint64(block.timestamp));
        assertEq(withdrawnAt, 0);
    }

    function test_AReceiptWithNoFileHashAsksAboutPublicationAlone() public {
        _anchorCurrent();
        (BuildAnchor.Status status, , ) = anchor.verifyReceipt(RELEASE, bytes32(0));
        assertEq(uint8(status), uint8(BuildAnchor.Status.Anchored));
    }

    function test_UnknownReleaseIsNotAPass() public view {
        (BuildAnchor.Status status, uint64 anchoredAt, ) = anchor.verifyReceipt(
            bytes6(0xaabbccddeeff),
            bytes32(0)
        );
        assertEq(uint8(status), uint8(BuildAnchor.Status.Unknown));
        assertEq(anchoredAt, 0);
    }

    function test_WrongCodeHashIsAMismatch() public {
        _anchorCurrent();
        (BuildAnchor.Status status, , ) = anchor.verifyReceipt(RELEASE, keccak256("other"));
        assertEq(uint8(status), uint8(BuildAnchor.Status.Mismatch));
    }

    /// A release is anchored once. Re-anchoring is how `anchoredAt` would become movable.
    function test_AnchoringIsAppendOnly() public {
        _anchorCurrent();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(BuildAnchor.AlreadyAnchored.selector, RELEASE));
        anchor.anchorBuild(CODE_HASH, MODEL_HASH);
    }

    function test_OnlyTheOwnerAnchors() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        anchor.anchorBuild(CODE_HASH, MODEL_HASH);
    }

    function test_EmptyCodeHashIsRefused() public {
        vm.prank(owner);
        vm.expectRevert(BuildAnchor.EmptyCodeHash.selector);
        anchor.anchorBuild(bytes32(0), bytes32(0));
    }

    /// Un-publishing a build in one transaction is the attack this timelock exists for.
    function test_WithdrawalCannotBeImmediate() public {
        _anchorCurrent();
        vm.prank(owner);
        anchor.proposeWithdrawal(RELEASE, "a signing bug");

        uint64 readyAt = anchor.withdrawalReadyAt(RELEASE);
        assertEq(readyAt, uint64(block.timestamp + anchor.WITHDRAWAL_DELAY()));

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(BuildAnchor.WithdrawalNotReady.selector, RELEASE, readyAt)
        );
        anchor.executeWithdrawal(RELEASE);
    }

    function test_WithdrawalNeedsAProposalFirst() public {
        _anchorCurrent();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(BuildAnchor.NoWithdrawalProposed.selector, RELEASE));
        anchor.executeWithdrawal(RELEASE);
    }

    /// Withdrawal adds a timestamp. It never deletes the one that says the build was published.
    function test_WithdrawalIsAdditive() public {
        _anchorCurrent();
        uint64 publishedAt = uint64(block.timestamp);

        vm.prank(owner);
        anchor.proposeWithdrawal(RELEASE, "a signing bug");
        vm.warp(block.timestamp + anchor.WITHDRAWAL_DELAY());
        vm.prank(owner);
        anchor.executeWithdrawal(RELEASE);

        (BuildAnchor.Status status, uint64 anchoredAt, uint64 withdrawnAt) = anchor.verifyReceipt(
            RELEASE,
            CODE_HASH
        );
        assertEq(uint8(status), uint8(BuildAnchor.Status.Withdrawn));
        assertEq(anchoredAt, publishedAt);
        assertEq(withdrawnAt, uint64(block.timestamp));
        assertEq(anchor.withdrawalReadyAt(RELEASE), 0);
    }

    function test_AProposedWithdrawalCanBeCancelled() public {
        _anchorCurrent();
        vm.startPrank(owner);
        anchor.proposeWithdrawal(RELEASE, "on reflection, no");
        anchor.cancelWithdrawal(RELEASE);
        vm.stopPrank();

        assertEq(anchor.withdrawalReadyAt(RELEASE), 0);
        vm.warp(block.timestamp + anchor.WITHDRAWAL_DELAY());
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(BuildAnchor.NoWithdrawalProposed.selector, RELEASE));
        anchor.executeWithdrawal(RELEASE);
    }

    function test_CannotWithdrawWhatWasNeverAnchored() public {
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(BuildAnchor.NotAnchored.selector, bytes6(0xaabbccddeeff))
        );
        anchor.proposeWithdrawal(bytes6(0xaabbccddeeff), "nothing here");
    }

    /**
     * The timestamp that separates "never published" from "the record has not caught up".
     * Without it, every receipt older than the first anchoring reads as a forgery.
     */
    function test_LatestAnchoredAtTracksTheNewestBuild() public {
        assertEq(anchor.latestAnchoredAt(), 0);
        _anchorCurrent();
        assertEq(anchor.latestAnchoredAt(), uint64(block.timestamp));

        vm.warp(block.timestamp + 1 days);
        vm.prank(owner);
        anchor.anchorBuild(keccak256("second build"), bytes32(0));
        assertEq(anchor.latestAnchoredAt(), uint64(block.timestamp));
        assertEq(anchor.releaseCount(), 2);
        assertEq(anchor.releaseAt(0), RELEASE);
    }
}
