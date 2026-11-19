// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/SuaraAI.sol";

/// @notice Minimal stand-in for the Agent ID registry: balances are settable.
/// The real registry lives at 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F on BSC;
/// in tests its code is etched onto that address so SuaraAI talks to the mock.
contract MockRegistry {
    mapping(address => uint256) public balances;

    function setBalance(address account, uint256 balance) external {
        balances[account] = balance;
    }

    function balanceOf(address account) external view returns (uint256) {
        return balances[account];
    }
}

contract SuaraAITest is Test {
    SuaraAI public suara;
    MockRegistry public mock;

    address public constant REGISTRY = 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F;

    address public holder = makeAddr("holder");
    address public holder2 = makeAddr("holder2");
    address public nonHolder = makeAddr("nonHolder");

    string[] public twoOptions;

    function setUp() public {
        mock = new MockRegistry();
        // Put the mock's code at the real registry address.
        vm.etch(REGISTRY, address(mock).code);
        // Balances are set through the etched address (its storage starts empty).
        MockRegistry(REGISTRY).setBalance(holder, 1);
        MockRegistry(REGISTRY).setBalance(holder2, 1);
        MockRegistry(REGISTRY).setBalance(nonHolder, 0);

        suara = new SuaraAI();

        twoOptions.push("Ya");
        twoOptions.push("Tidak");
    }

    function _deadline(uint256 daysOut) internal view returns (uint256) {
        return block.timestamp + daysOut * 1 days;
    }

    function _createPoll() internal returns (uint256) {
        vm.prank(holder);
        return suara.createPoll("Apakah ini berguna?", twoOptions, _deadline(7));
    }

    // --- happy path ---

    function testHolderCanCreatePoll() public {
        vm.prank(holder);
        uint256 id = suara.createPoll("Apakah ini berguna?", twoOptions, _deadline(7));
        assertEq(id, 0);
        assertEq(suara.pollCount(), 1);

        (string memory q, string[] memory opts, uint256[] memory votes, uint256 dl, address creator, uint256 total)
            = suara.getPoll(0);
        assertEq(q, "Apakah ini berguna?");
        assertEq(opts.length, 2);
        assertEq(opts[0], "Ya");
        assertEq(opts[1], "Tidak");
        assertEq(votes[0], 0);
        assertEq(votes[1], 0);
        assertEq(dl, _deadline(7));
        assertEq(creator, holder);
        assertEq(total, 0);
    }

    function testHolderCanVote() public {
        uint256 id = _createPoll();
        vm.prank(holder);
        suara.vote(id, 0);
        assertTrue(suara.hasVoted(id, holder));

        (,,,,, uint256 total) = suara.getPoll(id);
        assertEq(total, 1);

        vm.prank(holder2);
        suara.vote(id, 1);

        (, , uint256[] memory votes, , , uint256 total2) = suara.getPoll(id);
        assertEq(votes[0], 1);
        assertEq(votes[1], 1);
        assertEq(total2, 2);
    }

    function testFourOptionsWork() public {
        string[] memory opts = new string[](4);
        opts[0] = "A";
        opts[1] = "B";
        opts[2] = "C";
        opts[3] = "D";
        vm.prank(holder);
        uint256 id = suara.createPoll("Pilih satu", opts, _deadline(1));
        (, string[] memory got, , , ,) = suara.getPoll(id);
        assertEq(got.length, 4);
    }

    // --- access control ---

    function testNonHolderCannotCreate() public {
        vm.prank(nonHolder);
        vm.expectRevert(SuaraAI.NotAgentIDHolder.selector);
        suara.createPoll("Apakah ini berguna?", twoOptions, _deadline(7));
    }

    function testNonHolderCannotVote() public {
        uint256 id = _createPoll();
        vm.prank(nonHolder);
        vm.expectRevert(SuaraAI.NotAgentIDHolder.selector);
        suara.vote(id, 0);
    }

    // --- vote rules ---

    function testDoubleVoteReverts() public {
        uint256 id = _createPoll();
        vm.prank(holder);
        suara.vote(id, 0);
        vm.prank(holder);
        vm.expectRevert(SuaraAI.AlreadyVoted.selector);
        suara.vote(id, 1);
    }

    function testExpiredPollReverts() public {
        uint256 id = _createPoll();
        vm.warp(block.timestamp + 8 days);
        vm.prank(holder);
        vm.expectRevert(SuaraAI.PollClosed.selector);
        suara.vote(id, 0);
    }

    function testVoteAtExactDeadlineStillWorks() public {
        uint256 id = _createPoll();
        vm.warp(_deadline(7));
        vm.prank(holder);
        suara.vote(id, 0); // block.timestamp == deadline is still open
        assertTrue(suara.hasVoted(id, holder));
    }

    function testVoteInvalidOptionReverts() public {
        uint256 id = _createPoll();
        vm.prank(holder);
        vm.expectRevert(SuaraAI.InvalidOptionIndex.selector);
        suara.vote(id, 2);
    }

    function testVoteNonexistentPollReverts() public {
        vm.prank(holder);
        vm.expectRevert(SuaraAI.PollNotFound.selector);
        suara.vote(99, 0);
    }

    function testGetNonexistentPollReverts() public {
        vm.expectRevert(SuaraAI.PollNotFound.selector);
        suara.getPoll(0);
    }

    function testHasVotedNonexistentPollReverts() public {
        vm.expectRevert(SuaraAI.PollNotFound.selector);
        suara.hasVoted(0, holder);
    }

    // --- create validation ---

    function testOneOptionReverts() public {
        string[] memory opts = new string[](1);
        opts[0] = "Satu";
        vm.prank(holder);
        vm.expectRevert(SuaraAI.InvalidOptionCount.selector);
        suara.createPoll("Pilih satu", opts, _deadline(7));
    }

    function testFiveOptionsRevert() public {
        string[] memory opts = new string[](5);
        opts[0] = "A";
        opts[1] = "B";
        opts[2] = "C";
        opts[3] = "D";
        opts[4] = "E";
        vm.prank(holder);
        vm.expectRevert(SuaraAI.InvalidOptionCount.selector);
        suara.createPoll("Pilih satu", opts, _deadline(7));
    }

    function testEmptyQuestionReverts() public {
        vm.prank(holder);
        vm.expectRevert(SuaraAI.InvalidQuestion.selector);
        suara.createPoll("", twoOptions, _deadline(7));
    }

    function testOverlongQuestionReverts() public {
        string memory longQ = new string(201);
        // Fill with 'a' (new string() is zero bytes; use a repeated char via bytes).
        bytes memory b = bytes(longQ);
        for (uint256 i = 0; i < b.length; i++) b[i] = "a";
        vm.prank(holder);
        vm.expectRevert(SuaraAI.InvalidQuestion.selector);
        suara.createPoll(string(b), twoOptions, _deadline(7));
    }

    function testEmptyOptionReverts() public {
        string[] memory opts = new string[](2);
        opts[0] = "Ya";
        opts[1] = "";
        vm.prank(holder);
        vm.expectRevert(SuaraAI.InvalidOption.selector);
        suara.createPoll("Pilih", opts, _deadline(7));
    }

    function testOverlongOptionReverts() public {
        bytes memory b = new bytes(81);
        for (uint256 i = 0; i < b.length; i++) b[i] = "a";
        string[] memory opts = new string[](2);
        opts[0] = "Ya";
        opts[1] = string(b);
        vm.prank(holder);
        vm.expectRevert(SuaraAI.InvalidOption.selector);
        suara.createPoll("Pilih", opts, _deadline(7));
    }

    function testPastDeadlineReverts() public {
        vm.prank(holder);
        vm.expectRevert(SuaraAI.InvalidDeadline.selector);
        suara.createPoll("Pilih", twoOptions, block.timestamp - 1);
    }

    function testDeadlineTooFarReverts() public {
        vm.prank(holder);
        vm.expectRevert(SuaraAI.InvalidDeadline.selector);
        suara.createPoll("Pilih", twoOptions, block.timestamp + 31 days);
    }

    function testDeadlineExactly30DaysWorks() public {
        vm.prank(holder);
        uint256 id = suara.createPoll("Pilih", twoOptions, block.timestamp + 30 days);
        assertEq(id, 0);
    }
}
