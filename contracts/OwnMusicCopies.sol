// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title OwnMusic numbered copies
/// @notice One token per numbered copy of an album. Token id = the copy's id in OwnMusic.
/// Holders can't move tokens themselves: every change of hands goes through OwnMusic's
/// market (the contract owner), so the artist's and platform's resale cut is always taken.
contract OwnMusicCopies is ERC721, Ownable {
    string private baseUri;

    error TradeThroughOwnMusic();

    constructor(string memory baseUri_) ERC721("OwnMusic Copies", "OWNM") Ownable(msg.sender) {
        baseUri = baseUri_;
    }

    function mint(address to, uint256 tokenId) external onlyOwner {
        _mint(to, tokenId);
    }

    /// @notice Record a sale made on the OwnMusic market.
    function marketTransfer(address from, address to, uint256 tokenId) external onlyOwner {
        _transfer(from, to, tokenId);
    }

    function setBaseURI(string calldata baseUri_) external onlyOwner {
        baseUri = baseUri_;
    }

    function _baseURI() internal view override returns (string memory) {
        return baseUri;
    }

    // _mint and _transfer pass no authoriser; transferFrom and safeTransferFrom pass the caller.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        if (auth != address(0)) revert TradeThroughOwnMusic();
        return super._update(to, tokenId, auth);
    }

    function approve(address, uint256) public pure override {
        revert TradeThroughOwnMusic();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert TradeThroughOwnMusic();
    }
}
