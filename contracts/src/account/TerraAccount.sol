// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IERC1271 } from "../interfaces/IERC1271.sol";
import { SessionManager } from "../session/SessionManager.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title TerraAccount
 * @notice Self-custodial smart wallet for supervised RWA workflows on Robinhood Chain.
 * @dev Supports direct EOA owner execution, EIP-712 meta-transactions, and scoped session keys.
 */
contract TerraAccount is IERC1271, EIP712, ReentrancyGuard {
    using ECDSA for bytes32;

    address public owner;
    SessionManager public immutable sessionManager;
    uint256 public nonce;

    // Deduplication of action hashes
    mapping(bytes32 => bool) public executedActionHashes;

    bytes32 private constant EXECUTE_TYPEHASH = keccak256(
        "Execute(address target,uint256 value,bytes data,uint256 nonce,uint256 deadline,bytes32 actionHash)"
    );

    event Executed(address indexed target, uint256 value, bytes data);
    event BatchExecuted(uint256 operationsCount);
    event SessionActionExecuted(address indexed sessionKey, address indexed target, uint256 value);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ActionHashBurned(bytes32 indexed actionHash);

    error NotOwner();
    error NotAuthorizedSessionKey();
    error ExecutionFailed(bytes reason);
    error InvalidNonce(uint256 expected, uint256 actual);
    error TransactionExpired(uint256 deadline, uint256 currentTimestamp);
    error ActionAlreadyExecuted(bytes32 actionHash);
    error InvalidSignature();
    error ArrayLengthMismatch();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _owner, address _sessionManager) EIP712("TerraAccount", "1") {
        require(_owner != address(0), "Invalid owner");
        require(_sessionManager != address(0), "Invalid session manager");
        owner = _owner;
        sessionManager = SessionManager(_sessionManager);
    }

    receive() external payable {}
    fallback() external payable {}

    // =========================================================================
    // Direct Owner Execution (User pays gas from wallet popup)
    // =========================================================================

    /**
     * @notice Executes a single transaction directly by the owner.
     * @param target Contract or address to call.
     * @param value Native token value (ETH/gas token) to send.
     * @param data Calldata payload.
     */
    function execute(
        address target,
        uint256 value,
        bytes calldata data
    ) external payable onlyOwner nonReentrant returns (bytes memory result) {
        result = _call(target, value, data);
        emit Executed(target, value, data);
    }

    /**
     * @notice Executes a batch of calls atomically by the owner.
     */
    function executeBatch(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata datas
    ) external payable onlyOwner nonReentrant returns (bytes[] memory results) {
        if (targets.length != values.length || targets.length != datas.length) {
            revert ArrayLengthMismatch();
        }

        results = new bytes[](targets.length);
        for (uint256 i = 0; i < targets.length; i++) {
            results[i] = _call(targets[i], values[i], datas[i]);
            emit Executed(targets[i], values[i], datas[i]);
        }
        emit BatchExecuted(targets.length);
    }

    // =========================================================================
    // Scoped Session Key Execution (Agent automated tasks)
    // =========================================================================

    /**
     * @notice Allows an authorized session key to execute within defined scope.
     * @param target The target contract address.
     * @param value Native value to pass.
     * @param data Calldata to execute.
     * @param valueUsd Estimated USD value (in cents) for daily limit verification.
     */
    function executeBySession(
        address target,
        uint256 value,
        bytes calldata data,
        uint256 valueUsd
    ) external payable nonReentrant returns (bytes memory result) {
        address sessionKey = msg.sender;

        // SessionManager verifies validity, expiration, target, selector, and spend limit
        sessionManager.validateAndRecordExecution(sessionKey, target, data, valueUsd);

        result = _call(target, value, data);
        emit SessionActionExecuted(sessionKey, target, value);
    }

    /**
     * @notice Registers a new session key with the SessionManager.
     */
    function registerSession(
        address sessionKey,
        uint48 validAfter,
        uint48 validUntil,
        uint256 dailyLimitUsd,
        address[] calldata targets,
        bytes4[] calldata selectors
    ) external onlyOwner {
        sessionManager.registerSession(sessionKey, validAfter, validUntil, dailyLimitUsd, targets, selectors);
    }

    /**
     * @notice Instantly revokes a session key.
     */
    function revokeSession(address sessionKey) external onlyOwner {
        sessionManager.revokeSession(sessionKey);
    }

    // =========================================================================
    // Meta-Transaction Execution (Prepared Transaction with EIP-712 signature)
    // =========================================================================

    /**
     * @notice Executes a transaction signed by the owner off-chain.
     */
    function executeWithSignature(
        address target,
        uint256 value,
        bytes calldata data,
        uint256 _nonce,
        uint256 deadline,
        bytes32 actionHash,
        bytes calldata signature
    ) external payable nonReentrant returns (bytes memory result) {
        if (block.timestamp > deadline) revert TransactionExpired(deadline, block.timestamp);
        if (_nonce != nonce) revert InvalidNonce(nonce, _nonce);

        if (actionHash != bytes32(0)) {
            if (executedActionHashes[actionHash]) revert ActionAlreadyExecuted(actionHash);
            executedActionHashes[actionHash] = true;
            emit ActionHashBurned(actionHash);
        }

        bytes32 structHash = keccak256(
            abi.encode(
                EXECUTE_TYPEHASH,
                target,
                value,
                keccak256(data),
                _nonce,
                deadline,
                actionHash
            )
        );

        bytes32 digest = _hashTypedDataV4(structHash);
        address recoveredSigner = digest.recover(signature);
        if (recoveredSigner != owner) revert InvalidSignature();

        nonce++;
        result = _call(target, value, data);
        emit Executed(target, value, data);
    }

    // =========================================================================
    // ERC-1271 & Admin
    // =========================================================================

    /**
     * @notice Validates a signature according to ERC-1271 standard.
     * @dev Supports both raw hashes and personal_sign prefixed hashes.
     */
    function isValidSignature(
        bytes32 hash,
        bytes calldata signature
    ) external view override returns (bytes4) {
        (address signer, ECDSA.RecoverError err, ) = hash.tryRecover(signature);
        if (err == ECDSA.RecoverError.NoError && signer == owner) {
            return IERC1271.isValidSignature.selector;
        }

        bytes32 ethSignedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", hash)
        );
        (address ethSigner, ECDSA.RecoverError ethErr, ) = ethSignedHash.tryRecover(signature);
        if (ethErr == ECDSA.RecoverError.NoError && ethSigner == owner) {
            return IERC1271.isValidSignature.selector;
        }

        return 0xffffffff;
    }

    /**
     * @notice Transfers wallet ownership to a new address.
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "New owner is zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function _call(address target, uint256 value, bytes memory data) internal returns (bytes memory) {
        (bool success, bytes memory result) = target.call{value: value}(data);
        if (!success) {
            revert ExecutionFailed(result);
        }
        return result;
    }
}
