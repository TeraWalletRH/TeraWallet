// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { TerraAccount } from "./TerraAccount.sol";
import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";

/**
 * @title TerraAccountFactory
 * @notice Factory for deploying deterministic TerraAccount smart wallets using CREATE2.
 */
contract TerraAccountFactory {
    address public immutable sessionManager;

    event AccountCreated(address indexed account, address indexed owner, bytes32 salt);

    constructor(address _sessionManager) {
        require(_sessionManager != address(0), "Invalid session manager");
        sessionManager = _sessionManager;
    }

    /**
     * @notice Deploys a new TerraAccount using CREATE2.
     * @param owner EOA address of the account owner.
     * @param salt Deterministic deployment salt.
     */
    function createAccount(address owner, bytes32 salt) external returns (address account) {
        bytes memory bytecode = abi.encodePacked(
            type(TerraAccount).creationCode,
            abi.encode(owner, sessionManager)
        );

        bytes32 finalSalt = _getFinalSalt(owner, salt);
        account = Create2.computeAddress(finalSalt, keccak256(bytecode));

        if (account.code.length == 0) {
            account = Create2.deploy(0, finalSalt, bytecode);
            emit AccountCreated(account, owner, salt);
        }
    }

    /**
     * @notice Computes the deterministic counterfactual address of a TerraAccount before deployment.
     */
    function getAddress(address owner, bytes32 salt) external view returns (address) {
        bytes memory bytecode = abi.encodePacked(
            type(TerraAccount).creationCode,
            abi.encode(owner, sessionManager)
        );
        return Create2.computeAddress(_getFinalSalt(owner, salt), keccak256(bytecode));
    }

    function _getFinalSalt(address owner, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(owner, salt));
    }
}
