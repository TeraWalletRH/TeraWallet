// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title V4Venue
 * @notice Adapter interface providing uniform buy, sell, and yield claim operations for RWAs.
 */
contract V4Venue is ReentrancyGuard {
    using SafeERC20 for IERC20;

    event Bought(address indexed buyer, address indexed token, uint256 amountOut, uint256 cost);
    event Sold(address indexed seller, address indexed token, uint256 amountIn, uint256 received);
    event YieldClaimed(address indexed account, address indexed token, uint256 amount);

    receive() external payable {}

    /**
     * @notice Purchases a target RWA token.
     * @param token Address of the RWA token.
     * @param amountOut Expected amount of RWA tokens to acquire.
     */
    function buy(
        address token,
        uint256 amountOut
    ) external payable nonReentrant returns (uint256 cost) {
        require(amountOut > 0, "Zero amount");
        cost = msg.value;

        // If mock venue holds token, transfer to buyer
        if (IERC20(token).balanceOf(address(this)) >= amountOut) {
            IERC20(token).safeTransfer(msg.sender, amountOut);
        }

        emit Bought(msg.sender, token, amountOut, cost);
    }

    /**
     * @notice Sells an RWA token back to the venue.
     */
    function sell(
        address token,
        uint256 amountIn,
        uint256 minAmountOut
    ) external nonReentrant returns (uint256 payout) {
        require(amountIn > 0, "Zero amount");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amountIn);
        payout = minAmountOut;

        if (address(this).balance >= payout && payout > 0) {
            (bool success, ) = msg.sender.call{value: payout}("");
            require(success, "Payout transfer failed");
        }

        emit Sold(msg.sender, token, amountIn, payout);
    }

    /**
     * @notice Claims accrued dividends or yield for an RWA asset.
     */
    function claimYield(address token) external nonReentrant returns (uint256 claimed) {
        claimed = 100 * 1e6; // Mock distribution amount (e.g. 100 USDC)
        emit YieldClaimed(msg.sender, token, claimed);
    }
}
