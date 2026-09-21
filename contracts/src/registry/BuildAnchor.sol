// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Ownable, Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * @title BuildAnchor
 * @notice The approved-build registry, anchored where Tera cannot rewrite it quietly.
 * @dev
 * `registry.json` already lists every release Tera has published, signed and dated. Its
 * weakness is not the signature; it is that Tera serves the file. A list that can be
 * replaced silently establishes what Tera says today, not what Tera said last month,
 * and the only thing standing against a quiet edit is that readers kept their own copies.
 *
 * This is the same list where an edit leaves a trace. Three properties are what it adds,
 * and nothing here should ever be described as adding a fourth:
 *
 *   Append-only. A release is anchored once. `anchorBuild` reverts on a second attempt
 *   for the same release, whatever hash it carries, so `anchoredAt` means the first and
 *   only time that build was published and cannot be moved.
 *
 *   The release id cannot disagree with the code it names. A release id is the first six
 *   bytes of the sha256 over the build's canonical file list, so it is derived here from
 *   the hash rather than supplied beside it. There is no call that anchors `r-aaaa...`
 *   against some other build's files.
 *
 *   Withdrawal is timelocked and additive. Un-publishing a build is how a valid receipt
 *   would be turned into evidence of forgery, so it cannot happen in one transaction:
 *   `proposeWithdrawal` emits, `executeWithdrawal` works only after WITHDRAWAL_DELAY, and
 *   what it writes is a second timestamp beside the first. The anchor is never deleted, so
 *   a receipt written before the withdrawal still checks out against the record as it was.
 *
 * What it does not add, which matters more:
 *
 *   It does not establish that any particular page was running an anchored build. Nothing
 *   on chain can: the page reporting its release is the page being asked about. Anchoring
 *   makes the published list tamper-evident, and that is the whole of the claim.
 *
 *   There is no TCB or attestation field. Tera runs no enclave, and a zero-filled field
 *   named for one would read to anybody scanning the storage as an attestation Tera does
 *   not have. If confidential inference ever ships, that is a different anchor with a
 *   different verifier behind it.
 *
 *   The owner is a key Tera holds. This stops a rewrite going unnoticed; it does not stop
 *   the owner anchoring whatever they like. `Ownable2Step` is used so a handover cannot be
 *   completed by a typo'd address.
 */
contract BuildAnchor is Ownable2Step {
    /// @notice The answer to "was this receipt's build published, and does it still stand?".
    enum Status {
        Unknown, // No such release was ever anchored here.
        Anchored, // Anchored, and not withdrawn.
        Mismatch, // Anchored, but against different code than the caller named.
        Withdrawn // Anchored, and later withdrawn by governance.
    }

    struct Anchor {
        bytes32 codeHash; // sha256 over the build's canonical file list.
        bytes32 modelHash; // sha256 over the on-device model's file list, or zero.
        uint64 anchoredAt; // Block timestamp of the one call that anchored it.
        uint64 withdrawnAt; // Block timestamp of withdrawal, or zero.
    }

    /// @notice How long a proposed withdrawal must sit in public before it can take effect.
    uint256 public constant WITHDRAWAL_DELAY = 7 days;

    mapping(bytes6 release => Anchor) private _anchors;
    mapping(bytes6 release => uint64 readyAt) public withdrawalReadyAt;
    bytes6[] private _releases;

    /**
     * @notice When the most recent build was anchored here.
     * @dev Absence is the one answer a reader cannot interpret alone: a release missing from
     * this record was either never published, or published after the last time anyone anchored
     * anything. The first is evidence; the second is a record that has not caught up yet. This
     * is the timestamp that tells them apart, and it is stored rather than derived so making
     * that distinction costs one call instead of three.
     */
    uint64 public latestAnchoredAt;

    event BuildAnchored(
        bytes6 indexed release,
        bytes32 codeHash,
        bytes32 modelHash,
        uint64 anchoredAt
    );
    event WithdrawalProposed(bytes6 indexed release, uint64 readyAt, string reason);
    event WithdrawalCancelled(bytes6 indexed release);
    event BuildWithdrawn(bytes6 indexed release, uint64 withdrawnAt);

    error AlreadyAnchored(bytes6 release);
    error NotAnchored(bytes6 release);
    error AlreadyWithdrawn(bytes6 release);
    error NoWithdrawalProposed(bytes6 release);
    error WithdrawalNotReady(bytes6 release, uint64 readyAt);
    error EmptyCodeHash();

    constructor(address initialOwner) Ownable(initialOwner) {}

    /**
     * @notice Record a published build. The release id is derived, never supplied.
     * @param codeHash sha256 over the build's canonical file list — `filesHash` in the manifest.
     * @param modelHash sha256 over the on-device model's file list, or zero if the build ships none.
     * @return release The first six bytes of `codeHash`, which is the id a receipt names.
     */
    function anchorBuild(
        bytes32 codeHash,
        bytes32 modelHash
    ) external onlyOwner returns (bytes6 release) {
        if (codeHash == bytes32(0)) revert EmptyCodeHash();
        release = bytes6(codeHash);
        if (_anchors[release].anchoredAt != 0) revert AlreadyAnchored(release);

        _anchors[release] = Anchor({
            codeHash: codeHash,
            modelHash: modelHash,
            anchoredAt: uint64(block.timestamp),
            withdrawnAt: 0
        });
        _releases.push(release);
        latestAnchoredAt = uint64(block.timestamp);
        emit BuildAnchored(release, codeHash, modelHash, uint64(block.timestamp));
    }

    /**
     * @notice Announce an intention to withdraw a build, starting the timelock.
     * @dev The reason is on chain because a withdrawal is read by owners deciding whether to
     * trust a receipt, and "this build was withdrawn" without a reason is worse than useless.
     */
    function proposeWithdrawal(bytes6 release, string calldata reason) external onlyOwner {
        Anchor storage anchor = _anchors[release];
        if (anchor.anchoredAt == 0) revert NotAnchored(release);
        if (anchor.withdrawnAt != 0) revert AlreadyWithdrawn(release);

        uint64 readyAt = uint64(block.timestamp + WITHDRAWAL_DELAY);
        withdrawalReadyAt[release] = readyAt;
        emit WithdrawalProposed(release, readyAt, reason);
    }

    /// @notice Abandon a proposed withdrawal before it takes effect.
    function cancelWithdrawal(bytes6 release) external onlyOwner {
        if (withdrawalReadyAt[release] == 0) revert NoWithdrawalProposed(release);
        delete withdrawalReadyAt[release];
        emit WithdrawalCancelled(release);
    }

    /**
     * @notice Mark an anchored build as withdrawn, once its timelock has run.
     * @dev This adds a second timestamp; it never clears the first. A receipt written before
     * `withdrawnAt` names a build that was published at the time, and the record still says so.
     */
    function executeWithdrawal(bytes6 release) external onlyOwner {
        Anchor storage anchor = _anchors[release];
        if (anchor.anchoredAt == 0) revert NotAnchored(release);
        if (anchor.withdrawnAt != 0) revert AlreadyWithdrawn(release);

        uint64 readyAt = withdrawalReadyAt[release];
        if (readyAt == 0) revert NoWithdrawalProposed(release);
        if (block.timestamp < readyAt) revert WithdrawalNotReady(release, readyAt);

        anchor.withdrawnAt = uint64(block.timestamp);
        delete withdrawalReadyAt[release];
        emit BuildWithdrawn(release, anchor.withdrawnAt);
    }

    /**
     * @notice Check the release a receipt names against this record.
     * @param release The release id from the receipt, as six bytes.
     * @param codeHash The build's file hash, or zero when the caller has only a release id.
     * @dev A receipt carries a release id and no file hash, so zero is the ordinary case and
     * the answer is then about publication alone. A caller holding the manifest can pass the
     * hash and get the stronger answer, where `Mismatch` means the id and the code disagree.
     */
    function verifyReceipt(
        bytes6 release,
        bytes32 codeHash
    ) external view returns (Status status, uint64 anchoredAt, uint64 withdrawnAt) {
        Anchor storage anchor = _anchors[release];
        anchoredAt = anchor.anchoredAt;
        withdrawnAt = anchor.withdrawnAt;

        if (anchoredAt == 0) return (Status.Unknown, 0, 0);
        if (codeHash != bytes32(0) && anchor.codeHash != codeHash)
            return (Status.Mismatch, anchoredAt, withdrawnAt);
        if (withdrawnAt != 0) return (Status.Withdrawn, anchoredAt, withdrawnAt);
        return (Status.Anchored, anchoredAt, withdrawnAt);
    }

    /// @notice The full record for one release. `anchoredAt` is zero when there is none.
    function anchorOf(bytes6 release) external view returns (Anchor memory) {
        return _anchors[release];
    }

    /// @notice How many releases have ever been anchored here.
    function releaseCount() external view returns (uint256) {
        return _releases.length;
    }

    /// @notice One anchored release id, in the order it was published.
    function releaseAt(uint256 index) external view returns (bytes6) {
        return _releases[index];
    }
}
