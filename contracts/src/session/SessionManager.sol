// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title SessionManager
 * @notice Manages scoped ephemeral session keys for Terra Wallet smart accounts.
 * @dev Enforces time bounds, target allowlists, selector allowlists, and daily spend limits.
 */
contract SessionManager {
    struct SessionScope {
        uint48 validAfter;
        uint48 validUntil;
        uint256 dailyLimitUsd;     // Spending cap in USD (cents, 2 decimals)
        uint256 spentTodayUsd;     // Cumulative spent today
        uint48 lastResetTimestamp; // Last time the daily cap was reset
        bool isRevoked;            // Emergency one-tap revocation
        bool anyTargetAllowed;     // Wildcard target flag
    }

    // smartAccount => sessionKey => SessionScope
    mapping(address => mapping(address => SessionScope)) private _sessions;

    // smartAccount => sessionKey => target => isAllowed
    mapping(address => mapping(address => mapping(address => bool))) private _allowedTargets;

    // smartAccount => sessionKey => selector => isAllowed
    mapping(address => mapping(address => mapping(bytes4 => bool))) private _allowedSelectors;

    // Events
    event SessionRegistered(
        address indexed account,
        address indexed sessionKey,
        uint48 validAfter,
        uint48 validUntil,
        uint256 dailyLimitUsd
    );
    event SessionRevoked(address indexed account, address indexed sessionKey);
    event SessionExecuted(
        address indexed account,
        address indexed sessionKey,
        address indexed target,
        bytes4 selector,
        uint256 valueUsd
    );

    // Custom errors
    error SessionDoesNotExist();
    error SessionAlreadyRevoked();
    error SessionNotYetActive(uint48 validAfter, uint256 currentTimestamp);
    error SessionExpired(uint48 validUntil, uint256 currentTimestamp);
    error TargetNotAllowed(address target);
    error SelectorNotAllowed(bytes4 selector);
    error DailySpendLimitExceeded(uint256 attempted, uint256 remaining);
    error InvalidTimeRange();

    /**
     * @notice Registers a new scoped session key for the calling smart account.
     * @param sessionKey The ephemeral public address of the session key.
     * @param validAfter Timestamp after which the session becomes valid.
     * @param validUntil Timestamp when the session expires.
     * @param dailyLimitUsd Maximum USD cents that can be executed per day.
     * @param allowedTargets List of contract addresses the session is permitted to call.
     * @param allowedSelectors List of 4-byte function selectors permitted.
     */
    function registerSession(
        address sessionKey,
        uint48 validAfter,
        uint48 validUntil,
        uint256 dailyLimitUsd,
        address[] calldata allowedTargets,
        bytes4[] calldata allowedSelectors
    ) external {
        if (validUntil <= validAfter || sessionKey == address(0)) {
            revert InvalidTimeRange();
        }

        address account = msg.sender;

        _sessions[account][sessionKey] = SessionScope({
            validAfter: validAfter,
            validUntil: validUntil,
            dailyLimitUsd: dailyLimitUsd,
            spentTodayUsd: 0,
            lastResetTimestamp: uint48(block.timestamp),
            isRevoked: false,
            anyTargetAllowed: allowedTargets.length == 0
        });

        for (uint256 i = 0; i < allowedTargets.length; i++) {
            _allowedTargets[account][sessionKey][allowedTargets[i]] = true;
        }

        for (uint256 i = 0; i < allowedSelectors.length; i++) {
            _allowedSelectors[account][sessionKey][allowedSelectors[i]] = true;
        }

        emit SessionRegistered(account, sessionKey, validAfter, validUntil, dailyLimitUsd);
    }

    /**
     * @notice Instantly revokes a session key.
     * @param sessionKey The session address to revoke.
     */
    function revokeSession(address sessionKey) external {
        address account = msg.sender;
        SessionScope storage session = _sessions[account][sessionKey];
        if (session.validUntil == 0) revert SessionDoesNotExist();
        if (session.isRevoked) revert SessionAlreadyRevoked();

        session.isRevoked = true;
        emit SessionRevoked(account, sessionKey);
    }

    /**
     * @notice Validates that a session key has permission to execute a specific call and updates quota.
     * @dev Called exclusively by the smart account during `executeBySession`.
     */
    function validateAndRecordExecution(
        address sessionKey,
        address target,
        bytes calldata data,
        uint256 valueUsd
    ) external {
        address account = msg.sender;
        SessionScope storage session = _sessions[account][sessionKey];

        if (session.validUntil == 0) revert SessionDoesNotExist();
        if (session.isRevoked) revert SessionAlreadyRevoked();
        if (block.timestamp < session.validAfter) {
            revert SessionNotYetActive(session.validAfter, block.timestamp);
        }
        if (block.timestamp > session.validUntil) {
            revert SessionExpired(session.validUntil, block.timestamp);
        }

        // Validate target
        if (!session.anyTargetAllowed && !_allowedTargets[account][sessionKey][target]) {
            revert TargetNotAllowed(target);
        }

        // Validate function selector
        bytes4 selector = bytes4(0);
        if (data.length >= 4) {
            selector = bytes4(data[:4]);
            if (!_allowedSelectors[account][sessionKey][selector]) {
                revert SelectorNotAllowed(selector);
            }
        }

        // Reset daily spend window if 24 hours elapsed
        if (block.timestamp >= session.lastResetTimestamp + 1 days) {
            session.spentTodayUsd = 0;
            session.lastResetTimestamp = uint48(block.timestamp);
        }

        // Validate daily spend limit
        if (session.dailyLimitUsd > 0) {
            if (session.spentTodayUsd + valueUsd > session.dailyLimitUsd) {
                revert DailySpendLimitExceeded(
                    valueUsd,
                    session.dailyLimitUsd - session.spentTodayUsd
                );
            }
            session.spentTodayUsd += valueUsd;
        }

        emit SessionExecuted(account, sessionKey, target, selector, valueUsd);
    }

    /**
     * @notice Returns session information and active status.
     */
    function getSession(
        address account,
        address sessionKey
    ) external view returns (SessionScope memory session, bool isActive) {
        session = _sessions[account][sessionKey];
        isActive = session.validUntil > 0 &&
            !session.isRevoked &&
            block.timestamp >= session.validAfter &&
            block.timestamp <= session.validUntil;
    }

    function isTargetAllowed(address account, address sessionKey, address target) external view returns (bool) {
        return _sessions[account][sessionKey].anyTargetAllowed || _allowedTargets[account][sessionKey][target];
    }

    function isSelectorAllowed(address account, address sessionKey, bytes4 selector) external view returns (bool) {
        return _allowedSelectors[account][sessionKey][selector];
    }
}
