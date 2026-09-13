// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { TerraAccount } from "../src/account/TerraAccount.sol";
import { SessionManager } from "../src/session/SessionManager.sol";
import { MockERC3643 } from "../src/token/MockERC3643.sol";
import { IERC1271 } from "../src/interfaces/IERC1271.sol";

contract TerraAccountTest is Test {
    TerraAccount public account;
    SessionManager public sessionManager;
    MockERC3643 public token;

    uint256 internal ownerPrivateKey = 0xA11CE;
    address internal owner;
    address internal attacker = address(0x999);
    address internal recipient = address(0x777);

    bytes32 private constant EXECUTE_TYPEHASH = keccak256(
        "Execute(address target,uint256 value,bytes data,uint256 nonce,uint256 deadline,bytes32 actionHash)"
    );

    function setUp() public {
        owner = vm.addr(ownerPrivateKey);
        sessionManager = new SessionManager();
        account = new TerraAccount(owner, address(sessionManager));
        token = new MockERC3643("Tokenized Stock", "TSLA", owner);

        vm.deal(address(account), 10 ether);
        vm.deal(owner, 10 ether);
        vm.deal(attacker, 10 ether);

        vm.prank(owner);
        token.mint(address(account), 1000 * 1e18);
    }

    function test_DirectExecuteEthTransfer() public {
        uint256 balanceBefore = recipient.balance;

        vm.prank(owner);
        account.execute(recipient, 1 ether, "");

        assertEq(recipient.balance, balanceBefore + 1 ether);
    }

    function test_DirectExecuteTokenTransfer() public {
        bytes memory data = abi.encodeWithSelector(token.transfer.selector, recipient, 100 * 1e18);

        vm.prank(owner);
        account.execute(address(token), 0, data);

        assertEq(token.balanceOf(recipient), 100 * 1e18);
        assertEq(token.balanceOf(address(account)), 900 * 1e18);
    }

    function test_DirectExecuteNonOwnerReverts() public {
        vm.prank(attacker);
        vm.expectRevert(TerraAccount.NotOwner.selector);
        account.execute(recipient, 1 ether, "");
    }

    function test_BatchExecute() public {
        address[] memory targets = new address[](2);
        uint256[] memory values = new uint256[](2);
        bytes[] memory datas = new bytes[](2);

        targets[0] = recipient;
        values[0] = 0.5 ether;
        datas[0] = "";

        targets[1] = address(token);
        values[1] = 0;
        datas[1] = abi.encodeWithSelector(token.transfer.selector, recipient, 50 * 1e18);

        vm.prank(owner);
        account.executeBatch(targets, values, datas);

        assertEq(recipient.balance, 0.5 ether);
        assertEq(token.balanceOf(recipient), 50 * 1e18);
    }

    function test_ExecuteWithSignature() public {
        bytes memory data = abi.encodeWithSelector(token.transfer.selector, recipient, 200 * 1e18);
        uint256 nonce = account.nonce();
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 actionHash = keccak256("Intent-001");

        bytes32 structHash = keccak256(
            abi.encode(
                EXECUTE_TYPEHASH,
                address(token),
                0,
                keccak256(data),
                nonce,
                deadline,
                actionHash
            )
        );

        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("TerraAccount")),
                keccak256(bytes("1")),
                block.chainid,
                address(account)
            )
        );

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPrivateKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        // Attacker broadcasts validly signed payload; gas is paid by broadcaster but action is authorized
        vm.prank(attacker);
        account.executeWithSignature(address(token), 0, data, nonce, deadline, actionHash, signature);

        assertEq(token.balanceOf(recipient), 200 * 1e18);
        assertEq(account.nonce(), nonce + 1);
        assertTrue(account.executedActionHashes(actionHash));

        // Replay attempt must revert
        vm.prank(attacker);
        vm.expectRevert();
        account.executeWithSignature(address(token), 0, data, nonce, deadline, actionHash, signature);
    }

    function test_ExecuteWithSignatureExpiredReverts() public {
        bytes memory data = abi.encodeWithSelector(token.transfer.selector, recipient, 50 * 1e18);
        uint256 nonce = account.nonce();
        uint256 deadline = block.timestamp - 1; // Expired
        bytes32 actionHash = keccak256("Intent-Expired");

        bytes32 structHash = keccak256(
            abi.encode(
                EXECUTE_TYPEHASH,
                address(token),
                0,
                keccak256(data),
                nonce,
                deadline,
                actionHash
            )
        );

        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("TerraAccount")),
                keccak256(bytes("1")),
                block.chainid,
                address(account)
            )
        );

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPrivateKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.expectRevert();
        account.executeWithSignature(address(token), 0, data, nonce, deadline, actionHash, signature);
    }

    function test_ERC1271SignatureValidation() public {
        bytes32 messageHash = keccak256("VerifyMyIntent");
        bytes32 ethSignedMessageHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash)
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPrivateKey, ethSignedMessageHash);
        bytes memory signature = abi.encodePacked(r, s, v);

        bytes4 magicValue = account.isValidSignature(messageHash, signature);
        assertEq(magicValue, IERC1271.isValidSignature.selector);

        // Invalid signature from attacker returns failure magic
        (uint8 vBad, bytes32 rBad, bytes32 sBad) = vm.sign(0xBAD, ethSignedMessageHash);
        bytes memory badSignature = abi.encodePacked(rBad, sBad, vBad);
        assertEq(account.isValidSignature(messageHash, badSignature), bytes4(0xffffffff));
    }
}
