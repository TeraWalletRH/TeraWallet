// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title IERC1271
 * @notice Standard interface for verifying signatures on behalf of smart contracts.
 */
interface IERC1271 {
    /**
     * @dev Should return whether the signature provided is valid for the provided hash
     * @param _hash      Hash of the data to be signed
     * @param _signature Signature byte array associated with _hash
     *
     * MUST return the bytes4 magic value 0x1626ba7e when function passes.
     * MUST NOT modify state (using STATICCALL for implementation)
     * MUST allow external calls
     */
    function isValidSignature(bytes32 _hash, bytes calldata _signature) external view returns (bytes4 magicValue);
}
