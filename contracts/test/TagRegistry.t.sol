// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { TagRegistry } from "../src/registry/TagRegistry.sol";

contract TagRegistryTest is Test {
    TagRegistry internal registry;

    address internal admin = address(0x111);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal relayer = address(0x2E1A4);

    uint256 internal ownerKey = 0xA11CE5EED;
    address internal signer;

    bytes32 internal constant CLAIM_TYPEHASH =
        keccak256("Claim(string tag,address owner,uint256 nonce,uint256 deadline)");
    bytes32 internal constant RELEASE_TYPEHASH =
        keccak256("Release(address owner,uint256 nonce,uint256 deadline)");

    function setUp() public {
        registry = new TagRegistry(admin);
        signer = vm.addr(ownerKey);

        string[] memory reserved = new string[](2);
        reserved[0] = "support";
        reserved[1] = "tera";
        vm.prank(admin);
        registry.setReserved(reserved, true);
    }

    // --- Claiming ----------------------------------------------------------

    function test_ClaimResolvesBothWays() public {
        vm.prank(alice);
        registry.claim("astra");

        assertEq(registry.resolve("astra"), alice);
        assertEq(registry.tagOf(alice), "astra");
    }

    function test_UnclaimedTagResolvesToZero() public view {
        assertEq(registry.resolve("astra"), address(0));
    }

    function test_UncanonicalInputDoesNotMatch() public {
        // The contract never guesses at casing. Surfaces normalise first.
        vm.prank(alice);
        registry.claim("astra");
        assertEq(registry.resolve("Astra"), address(0));
    }

    function test_ClaimRejectsUppercase() public {
        vm.prank(alice);
        vm.expectRevert(TagRegistry.TagMalformed.selector);
        registry.claim("Astra");
    }

    function test_ClaimRejectsBadShapes() public {
        vm.startPrank(alice);
        vm.expectRevert(TagRegistry.TagTooShort.selector);
        registry.claim("as");
        vm.expectRevert(TagRegistry.TagTooLong.selector);
        registry.claim("aaaaaaaaaaaaaaaaaaaaa");
        vm.expectRevert(TagRegistry.TagMalformed.selector);
        registry.claim("1astra");
        vm.expectRevert(TagRegistry.TagMalformed.selector);
        registry.claim("astra_");
        vm.expectRevert(TagRegistry.TagMalformed.selector);
        registry.claim("as__tra");
        vm.expectRevert(TagRegistry.TagMalformed.selector);
        registry.claim("as-tra");
        vm.stopPrank();
    }

    function test_TwentyCharactersIsTheLimitAndIsAllowed() public {
        vm.prank(alice);
        registry.claim("aaaaaaaaaaaaaaaaaaaa");
        assertEq(registry.resolve("aaaaaaaaaaaaaaaaaaaa"), alice);
    }

    function test_TakenTagCannotBeClaimedTwice() public {
        vm.prank(alice);
        registry.claim("astra");
        vm.prank(bob);
        vm.expectRevert(TagRegistry.TagTaken.selector);
        registry.claim("astra");
    }

    function test_ConfusableTagIsRefused() public {
        vm.prank(alice);
        registry.claim("astra");

        // Same skeleton: a hurried owner reads both as the same name.
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(TagRegistry.ConfusableTaken.selector, keccak256(bytes("astra")))
        );
        registry.claim("a5tra");

        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(TagRegistry.ConfusableTaken.selector, keccak256(bytes("astra")))
        );
        registry.claim("as_tra");
    }

    function test_DistinctNamesStillFit() public {
        vm.prank(alice);
        registry.claim("astra");
        vm.prank(bob);
        registry.claim("astrid");
        assertEq(registry.resolve("astrid"), bob);
    }

    function test_ReservedNameIsRefusedIncludingItsLookalikes() public {
        vm.prank(alice);
        vm.expectRevert(TagRegistry.TagReserved.selector);
        registry.claim("support");

        vm.prank(alice);
        vm.expectRevert(TagRegistry.TagReserved.selector);
        registry.claim("supp0rt");
    }

    function test_OnlyOwnerReserves() public {
        string[] memory tags = new string[](1);
        tags[0] = "astra";
        vm.prank(alice);
        vm.expectRevert();
        registry.setReserved(tags, true);
    }

    function test_ReservationCanBeLifted() public {
        string[] memory tags = new string[](1);
        tags[0] = "support";
        vm.prank(admin);
        registry.setReserved(tags, false);
        vm.prank(alice);
        registry.claim("support");
        assertEq(registry.resolve("support"), alice);
    }

    // --- Changing and releasing --------------------------------------------

    function test_ClaimingASecondTagReleasesTheFirstAtomically() public {
        vm.startPrank(alice);
        registry.claim("astra");
        registry.claim("astrid");
        vm.stopPrank();

        assertEq(registry.tagOf(alice), "astrid");
        assertEq(registry.resolve("astra"), address(0));
        assertEq(registry.resolve("astrid"), alice);

        // The released name — and its lookalikes — are free again.
        vm.prank(bob);
        registry.claim("a5tra");
        assertEq(registry.resolve("a5tra"), bob);
    }

    function test_ReleaseClearsEverything() public {
        vm.startPrank(alice);
        registry.claim("astra");
        registry.release();
        vm.stopPrank();

        assertEq(registry.resolve("astra"), address(0));
        assertEq(registry.tagOf(alice), "");
    }

    function test_ReleaseWithoutATagReverts() public {
        vm.prank(alice);
        vm.expectRevert(TagRegistry.NoTagHeld.selector);
        registry.release();
    }

    // --- Relayed claims ----------------------------------------------------

    function test_RelayerPaysGasButCannotChooseTheName() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature = _signClaim("astra", signer, 0, deadline);

        vm.prank(relayer);
        registry.claimFor("astra", signer, deadline, signature);

        assertEq(registry.resolve("astra"), signer);
        assertEq(registry.nonces(signer), 1);

        // The same signature will not carry a different name.
        uint256 next = block.timestamp + 2 hours;
        bytes memory forAstra = _signClaim("astra", signer, 1, next);
        vm.prank(relayer);
        vm.expectRevert(TagRegistry.BadSignature.selector);
        registry.claimFor("astrid", signer, next, forAstra);
    }

    function test_RelayedClaimCannotBeReplayed() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature = _signClaim("astra", signer, 0, deadline);

        vm.prank(relayer);
        registry.claimFor("astra", signer, deadline, signature);

        vm.prank(relayer);
        vm.expectRevert(TagRegistry.BadSignature.selector);
        registry.claimFor("astra", signer, deadline, signature);
    }

    function test_ExpiredSignatureIsRefused() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature = _signClaim("astra", signer, 0, deadline);
        vm.warp(deadline + 1);

        vm.prank(relayer);
        vm.expectRevert(TagRegistry.SignatureExpired.selector);
        registry.claimFor("astra", signer, deadline, signature);
    }

    function test_SomeoneElsesSignatureDoesNotClaimForYou() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature = _signClaim("astra", signer, 0, deadline);

        vm.prank(relayer);
        vm.expectRevert(TagRegistry.BadSignature.selector);
        registry.claimFor("astra", bob, deadline, signature);
    }

    function test_RelayedRelease() public {
        uint256 deadline = block.timestamp + 1 hours;
        vm.prank(relayer);
        registry.claimFor("astra", signer, deadline, _signClaim("astra", signer, 0, deadline));

        bytes32 structHash = keccak256(abi.encode(RELEASE_TYPEHASH, signer, uint256(1), deadline));
        bytes memory signature = _sign(structHash);

        vm.prank(relayer);
        registry.releaseFor(signer, deadline, signature);
        assertEq(registry.resolve("astra"), address(0));
    }

    function test_AClaimSignatureIsNotAReleaseSignature() public {
        uint256 deadline = block.timestamp + 1 hours;
        vm.prank(relayer);
        registry.claimFor("astra", signer, deadline, _signClaim("astra", signer, 0, deadline));

        // Built before the expectation: the helper reads domainSeparator(), and
        // a cheatcode set first would catch that staticcall instead of the call
        // under test.
        bytes memory claimSignature = _signClaim("astra", signer, 1, deadline);

        vm.prank(relayer);
        vm.expectRevert(TagRegistry.BadSignature.selector);
        registry.releaseFor(signer, deadline, claimSignature);
    }

    // --- Views -------------------------------------------------------------

    function test_AvailableNeverRevertsAndTracksState() public {
        assertTrue(registry.available("astra"));
        assertFalse(registry.available("as"));
        assertFalse(registry.available("astra_"));
        assertFalse(registry.available("Astra"));
        assertFalse(registry.available("support"));

        vm.prank(alice);
        registry.claim("astra");
        assertFalse(registry.available("astra"));
        assertFalse(registry.available("a5tra"));
    }

    function test_SkeletonHashMatchesTheSharedFold() public view {
        assertEq(registry.skeletonHash("astr0"), registry.skeletonHash("astro"));
        assertEq(registry.skeletonHash("as_tra"), registry.skeletonHash("astra"));
        assertEq(registry.skeletonHash("l1sa"), registry.skeletonHash("lisa"));
        // Fixed against the value tags.js produces, so a change to either fold
        // has to be made in both places deliberately.
        assertEq(registry.skeletonHash("a5tr4"), keccak256(bytes("astra")));
    }

    // --- Helpers -----------------------------------------------------------

    function _signClaim(string memory tag, address owner_, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        return _sign(
            keccak256(abi.encode(CLAIM_TYPEHASH, keccak256(bytes(tag)), owner_, nonce, deadline))
        );
    }

    function _sign(bytes32 structHash) internal view returns (bytes memory) {
        bytes32 digest = keccak256(
            abi.encodePacked(bytes1(0x19), bytes1(0x01), registry.domainSeparator(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
