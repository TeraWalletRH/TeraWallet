// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title IERC3643
 * @notice Interface for ERC-3643 (T-REX) Permissioned Real-World Asset tokens.
 */
interface IERC3643 is IERC20 {
    event AddressFrozen(address indexed userAddress, bool indexed isFrozen, address indexed owner);
    event Paused(address account);
    event Unpaused(address account);

    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);

    /**
     * @notice Returns true if a transfer from sender to receiver of value would succeed under compliance rules.
     */
    function canTransfer(address _to, uint256 _value) external view returns (bool);

    /**
     * @notice Returns whether a user wallet address is frozen.
     */
    function isFrozen(address _userAddress) external view returns (bool);

    /**
     * @notice Returns whether the token is currently paused.
     */
    function paused() external view returns (bool);

    /**
     * @notice Returns the address of the ONCHAINID Identity Registry.
     */
    function identityRegistry() external view returns (address);

    /**
     * @notice Returns the address of the modular compliance contract.
     */
    function compliance() external view returns (address);
}
