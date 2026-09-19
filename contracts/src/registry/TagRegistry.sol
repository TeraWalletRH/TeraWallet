// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { SignatureChecker } from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

// The tag registry.
//
// A wallet that resolves `@astra` against a service is trusting that service
// not to answer with somebody else's address. The whole point of putting the
// mapping here is that the answer comes from a place the service cannot
// rewrite, and that every change to it leaves a permanent, public trace.
//
// The grammar is enforced on-chain rather than in the app, because a rule that
// only the app applies is not a rule: anyone can call this contract directly.
// It is a byte-for-byte match of `public/tera/core/tags.js`, and the two are
// held together by tests on both sides.
//
// Two things this deliberately does:
//
//   Confusable names collide. `astr0` folds to the same skeleton as `astro`,
//   and only one of them can exist. The fold throws away exactly the
//   distinctions that a hurried reader misses.
//
//   Claims can be relayed. `claimFor` takes the owner's EIP-712 signature and
//   lets anybody pay the gas, so a new owner holding only USDG is not shut out
//   of the feature. The relayer chooses whether to pay; it cannot choose the
//   name or the address, and a signature it never received is one it cannot
//   forge. `SignatureChecker` is used rather than `ECDSA` so a TerraAccount
//   can claim through ERC-1271 exactly as an EOA does.
//
// What it does not do: name anything on another chain. A record here is one
// address on this chain, which is why the wallet refuses tags as bridge
// destinations.

/**
 * @title TagRegistry
 * @notice Names an owner claims, and the Robinhood Chain address each one stands for.
 * @dev This contract is the registry, not a cache of one. See the notes above.
 */
contract TagRegistry is EIP712, Ownable {
    uint256 public constant MIN_LENGTH = 3;
    uint256 public constant MAX_LENGTH = 20;

    bytes32 private constant CLAIM_TYPEHASH =
        keccak256("Claim(string tag,address owner,uint256 nonce,uint256 deadline)");
    bytes32 private constant RELEASE_TYPEHASH =
        keccak256("Release(address owner,uint256 nonce,uint256 deadline)");

    mapping(bytes32 tagHash => address owner) private _ownerOfTag;
    mapping(bytes32 skeletonHash => bytes32 tagHash) private _tagOfSkeleton;
    mapping(address owner => string tag) private _tagOfOwner;
    mapping(bytes32 skeletonHash => bool isReserved) private _reserved;

    /// @notice Relay nonce per owner. Incremented by every accepted signature.
    mapping(address owner => uint256 nonce) public nonces;

    event TagClaimed(bytes32 indexed tagHash, address indexed owner, string tag);
    event TagReleased(bytes32 indexed tagHash, address indexed owner, string tag);
    event ReservationChanged(bytes32 indexed skeletonHash, bool isReserved);

    error TagTooShort();
    error TagTooLong();
    error TagMalformed();
    error TagReserved();
    error TagTaken();
    error ConfusableTaken(bytes32 heldBy);
    error NoTagHeld();
    error SignatureExpired();
    error BadSignature();

    constructor(address initialOwner) EIP712("Tera Wallet Tags", "1") Ownable(initialOwner) { }

    // --- Reading -----------------------------------------------------------

    /**
     * @notice The address `tag` stands for, or the zero address if unclaimed.
     * @dev Takes the canonical form: lowercase, no leading `@`. An uncanonical
     *      string simply does not match, which is the safe direction — this
     *      never guesses at what the caller meant.
     */
    function resolve(string calldata tag) external view returns (address) {
        return _ownerOfTag[keccak256(bytes(tag))];
    }

    /// @notice The tag held by `owner`, or the empty string.
    function tagOf(address owner_) external view returns (string memory) {
        return _tagOfOwner[owner_];
    }

    /// @notice Whether `tag` is well formed, unreserved, and free of collisions.
    function available(string calldata tag) external view returns (bool) {
        bytes memory raw = bytes(tag);
        if (_shape(raw) != 0) return false;
        bytes32 folded = _skeletonHash(raw);
        if (_reserved[folded]) return false;
        if (_ownerOfTag[keccak256(raw)] != address(0)) return false;
        return _tagOfSkeleton[folded] == bytes32(0);
    }

    /// @notice Whether this name is withheld from claiming.
    function isReserved(string calldata tag) external view returns (bool) {
        return _reserved[_skeletonHash(bytes(tag))];
    }

    /// @notice The collision key for `tag`. Exposed so an indexer agrees with the chain.
    function skeletonHash(string calldata tag) external pure returns (bytes32) {
        return _skeletonHash(bytes(tag));
    }

    // --- Writing -----------------------------------------------------------

    /// @notice Claim `tag` for the caller, who pays the gas.
    function claim(string calldata tag) external {
        _claim(tag, msg.sender);
    }

    /**
     * @notice Claim `tag` for `owner_` against their signature, paid for by the caller.
     * @dev The nonce is read from storage rather than passed in, so a caller
     *      cannot select which of several outstanding signatures to submit.
     */
    function claimFor(
        string calldata tag,
        address owner_,
        uint256 deadline,
        bytes calldata signature
    ) external {
        if (block.timestamp > deadline) revert SignatureExpired();
        bytes32 structHash = keccak256(
            abi.encode(CLAIM_TYPEHASH, keccak256(bytes(tag)), owner_, nonces[owner_]++, deadline)
        );
        if (!SignatureChecker.isValidSignatureNow(owner_, _hashTypedDataV4(structHash), signature)) {
            revert BadSignature();
        }
        _claim(tag, owner_);
    }

    /// @notice Give up the caller's tag, returning the name to the pool.
    function release() external {
        _release(msg.sender);
    }

    /// @notice Give up `owner_`'s tag against their signature, paid for by the caller.
    function releaseFor(address owner_, uint256 deadline, bytes calldata signature) external {
        if (block.timestamp > deadline) revert SignatureExpired();
        bytes32 structHash =
            keccak256(abi.encode(RELEASE_TYPEHASH, owner_, nonces[owner_]++, deadline));
        if (!SignatureChecker.isValidSignatureNow(owner_, _hashTypedDataV4(structHash), signature)) {
            revert BadSignature();
        }
        _release(owner_);
    }

    /**
     * @notice Withhold or return names: support, tera and the rest.
     * @dev Folded to skeletons, so reserving `support` also withholds `supp0rt`.
     *      Seeded at deployment from the same list the wallet ships.
     */
    function setReserved(string[] calldata tags, bool value) external onlyOwner {
        for (uint256 i; i < tags.length; ++i) {
            bytes32 folded = _skeletonHash(bytes(tags[i]));
            _reserved[folded] = value;
            emit ReservationChanged(folded, value);
        }
    }

    /// @notice The EIP-712 domain separator, for a client building the digest itself.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // --- Internals ---------------------------------------------------------

    function _claim(string calldata tag, address owner_) private {
        bytes memory raw = bytes(tag);
        uint8 shape = _shape(raw);
        if (shape == 1) revert TagTooShort();
        if (shape == 2) revert TagTooLong();
        if (shape == 3) revert TagMalformed();

        bytes32 tagHash = keccak256(raw);
        bytes32 folded = _skeletonHash(raw);
        if (_reserved[folded]) revert TagReserved();
        if (_ownerOfTag[tagHash] != address(0)) revert TagTaken();

        bytes32 held = _tagOfSkeleton[folded];
        if (held != bytes32(0)) revert ConfusableTaken(held);

        // One tag per address. Changing name is a single transaction rather
        // than a release the owner can forget to follow with a claim.
        if (bytes(_tagOfOwner[owner_]).length != 0) _release(owner_);

        _ownerOfTag[tagHash] = owner_;
        _tagOfSkeleton[folded] = tagHash;
        _tagOfOwner[owner_] = tag;
        emit TagClaimed(tagHash, owner_, tag);
    }

    function _release(address owner_) private {
        string memory existing = _tagOfOwner[owner_];
        bytes memory raw = bytes(existing);
        if (raw.length == 0) revert NoTagHeld();

        bytes32 tagHash = keccak256(raw);
        delete _ownerOfTag[tagHash];
        delete _tagOfSkeleton[_skeletonHash(raw)];
        delete _tagOfOwner[owner_];
        emit TagReleased(tagHash, owner_, existing);
    }

    /**
     * @dev 0 well formed, 1 too short, 2 too long, 3 malformed.
     *
     * A code rather than a revert so `available` can ask the same question
     * without the caller having to catch. The rule is the one in `tags.js`:
     * lowercase ASCII letters, digits and underscore; begins with a letter;
     * does not end with an underscore; no two underscores in a row.
     */
    function _shape(bytes memory raw) private pure returns (uint8) {
        uint256 length = raw.length;
        if (length < MIN_LENGTH) return 1;
        if (length > MAX_LENGTH) return 2;

        bytes1 first = raw[0];
        if (first < 0x61 || first > 0x7a) return 3;

        bytes1 last = raw[length - 1];
        bool lastOk = (last >= 0x61 && last <= 0x7a) || (last >= 0x30 && last <= 0x39);
        if (!lastOk) return 3;

        for (uint256 i = 1; i < length - 1; ++i) {
            bytes1 character = raw[i];
            bool allowed = (character >= 0x61 && character <= 0x7a)
                || (character >= 0x30 && character <= 0x39) || character == 0x5f;
            if (!allowed) return 3;
            if (character == 0x5f && raw[i - 1] == 0x5f) return 3;
        }
        return 0;
    }

    /**
     * @dev The collision key: underscores dropped, lookalike digits folded to
     *      the letters they are read as. Must stay identical to `skeleton()`
     *      in `public/tera/core/tags.js`.
     */
    function _skeletonHash(bytes memory raw) private pure returns (bytes32) {
        bytes memory folded = new bytes(raw.length);
        uint256 written;
        for (uint256 i; i < raw.length; ++i) {
            bytes1 character = raw[i];
            if (character == "_") continue;
            if (character == "0") character = "o";
            else if (character == "1" || character == "i") character = "l";
            else if (character == "3") character = "e";
            else if (character == "4") character = "a";
            else if (character == "5") character = "s";
            else if (character == "7") character = "t";
            else if (character == "8") character = "b";
            else if (character == "9") character = "g";
            folded[written++] = character;
        }
        assembly {
            mstore(folded, written)
        }
        return keccak256(folded);
    }
}
