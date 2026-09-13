// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IERC3643 } from "../interfaces/IERC3643.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockERC3643
 * @notice Mock implementation of an ERC-3643 compliant RWA token for testing.
 */
contract MockERC3643 is ERC20, Ownable, IERC3643 {
    bool private _isPaused;
    bool private _defaultCanTransfer = true;

    mapping(address => bool) private _frozenAddresses;
    address private _identityRegistry;
    address private _compliance;

    constructor(
        string memory name_,
        string memory symbol_,
        address owner_
    ) ERC20(name_, symbol_) Ownable(owner_) {
        _identityRegistry = address(0x1111111111111111111111111111111111111111);
        _compliance = address(0x2222222222222222222222222222222222222222);
    }

    function name() public view virtual override(ERC20, IERC3643) returns (string memory) {
        return super.name();
    }

    function symbol() public view virtual override(ERC20, IERC3643) returns (string memory) {
        return super.symbol();
    }

    function decimals() public view virtual override(ERC20, IERC3643) returns (uint8) {
        return super.decimals();
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function setPaused(bool paused_) external onlyOwner {
        _isPaused = paused_;
        if (paused_) {
            emit Paused(msg.sender);
        } else {
            emit Unpaused(msg.sender);
        }
    }

    function setAddressFrozen(address user, bool frozen) external onlyOwner {
        _frozenAddresses[user] = frozen;
        emit AddressFrozen(user, frozen, msg.sender);
    }

    function setDefaultCanTransfer(bool canTransfer_) external onlyOwner {
        _defaultCanTransfer = canTransfer_;
    }

    function canTransfer(address to, uint256 /* value */) external view override returns (bool) {
        if (_isPaused) return false;
        if (_frozenAddresses[msg.sender] || _frozenAddresses[to]) return false;
        return _defaultCanTransfer;
    }

    function isFrozen(address userAddress) external view override returns (bool) {
        return _frozenAddresses[userAddress];
    }

    function paused() external view override returns (bool) {
        return _isPaused;
    }

    function identityRegistry() external view override returns (address) {
        return _identityRegistry;
    }

    function compliance() external view override returns (address) {
        return _compliance;
    }
}
