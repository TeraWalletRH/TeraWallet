// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title RwaAssetRegistry
 * @notice Merkle-backed registry of verified real-world assets, token contracts, and venues.
 * @dev Supports governance root updates and instant guardian circuit breaker suspension.
 */
contract RwaAssetRegistry is Ownable {
    bytes32 public merkleRoot;
    address public guardian;

    // Emergency suspension flags (asset address => isSuspended)
    mapping(address => bool) public suspendedAssets;

    event MerkleRootUpdated(bytes32 indexed oldRoot, bytes32 indexed newRoot);
    event GuardianUpdated(address indexed oldGuardian, address indexed newGuardian);
    event AssetSuspensionChanged(address indexed asset, bool indexed isSuspended);

    error AssetIsSuspended(address asset);
    error NotGuardianOrOwner();

    modifier onlyGuardianOrOwner() {
        if (msg.sender != guardian && msg.sender != owner()) {
            revert NotGuardianOrOwner();
        }
        _;
    }

    constructor(address _owner, address _guardian, bytes32 _initialRoot) Ownable(_owner) {
        require(_guardian != address(0), "Invalid guardian");
        guardian = _guardian;
        merkleRoot = _initialRoot;
    }

    /**
     * @notice Updates the root hash of the approved asset Merkle tree.
     */
    function setMerkleRoot(bytes32 newRoot) external onlyOwner {
        emit MerkleRootUpdated(merkleRoot, newRoot);
        merkleRoot = newRoot;
    }

    /**
     * @notice Updates the emergency guardian address.
     */
    function setGuardian(address newGuardian) external onlyOwner {
        require(newGuardian != address(0), "Invalid guardian");
        emit GuardianUpdated(guardian, newGuardian);
        guardian = newGuardian;
    }

    /**
     * @notice Emergency circuit breaker to pause/unpause trading of a specific asset.
     */
    function setAssetSuspended(address asset, bool suspended) external onlyGuardianOrOwner {
        suspendedAssets[asset] = suspended;
        emit AssetSuspensionChanged(asset, suspended);
    }

    /**
     * @notice Verifies that an asset is part of the approved registry and is not suspended.
     */
    function verifyAsset(
        address asset,
        bytes32 leaf,
        bytes32[] calldata proof
    ) external view returns (bool) {
        if (suspendedAssets[asset]) revert AssetIsSuspended(asset);
        if (merkleRoot == bytes32(0)) return false;
        return MerkleProof.verify(proof, merkleRoot, leaf);
    }

    /**
     * @notice Checks whether an asset is currently suspended by guardian or governance.
     */
    function isSuspended(address asset) external view returns (bool) {
        return suspendedAssets[asset];
    }
}
