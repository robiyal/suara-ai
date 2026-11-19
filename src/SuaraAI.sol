// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Suara .ai — one-name-one-vote polling for Agent ID holders
/// @notice A poll is a question with 2-4 options. Only addresses holding an
/// Agent ID (a non-transferable .ai name on BNB Chain) can create polls or
/// vote, and each address gets exactly one vote per poll. No fees, no token,
/// no payments, no owner, no admin, no upgradeability.
/// @dev Agent ID is the SPACE ID registry on BNB Chain. balanceOf > 0 means
/// the address holds an Agent ID. handleOf is only used off-chain (frontend)
/// to display the .ai name; this contract never resolves names to addresses
/// and is NOT a name-lookup tool.
interface IAgentIDRegistry {
    function balanceOf(address account) external view returns (uint256);
}

contract SuaraAI {
    /// @notice SPACE ID Agent ID registry on BNB Chain (ERC-721, non-transferable).
    address public constant REGISTRY = 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F;

    uint256 public constant MIN_OPTIONS = 2;
    uint256 public constant MAX_OPTIONS = 4;
    uint256 public constant MAX_QUESTION_LENGTH = 200;
    uint256 public constant MAX_OPTION_LENGTH = 80;
    /// @notice A poll can run for at most 30 days.
    uint256 public constant MAX_DURATION = 30 days;

    struct Poll {
        string question;
        string[] options;
        uint256[] votes;
        uint256 deadline;
        address creator;
        uint256 totalVotes;
    }

    Poll[] private polls;
    mapping(uint256 => mapping(address => bool)) private voted;

    event PollCreated(
        uint256 indexed pollId,
        address indexed creator,
        string question,
        uint256 deadline
    );
    event Voted(
        uint256 indexed pollId,
        address indexed voter,
        uint256 indexed option,
        uint256 totalVotes
    );

    error NotAgentIDHolder();
    error InvalidOptionCount();
    error InvalidQuestion();
    error InvalidOption();
    error InvalidDeadline();
    error PollNotFound();
    error PollClosed();
    error AlreadyVoted();
    error InvalidOptionIndex();

    modifier onlyHolder() {
        if (IAgentIDRegistry(REGISTRY).balanceOf(msg.sender) == 0) {
            revert NotAgentIDHolder();
        }
        _;
    }

    /// @notice Create a poll. Only Agent ID holders.
    /// @param question The poll question (1-200 characters).
    /// @param options 2-4 answer options (each 1-80 characters).
    /// @param deadline Unix timestamp when voting closes (future, max 30 days out).
    /// @return pollId The id of the created poll.
    function createPoll(
        string calldata question,
        string[] calldata options,
        uint256 deadline
    ) external onlyHolder returns (uint256 pollId) {
        if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) {
            revert InvalidOptionCount();
        }
        bytes memory q = bytes(question);
        if (q.length == 0 || q.length > MAX_QUESTION_LENGTH) {
            revert InvalidQuestion();
        }
        for (uint256 i = 0; i < options.length; i++) {
            bytes memory o = bytes(options[i]);
            if (o.length == 0 || o.length > MAX_OPTION_LENGTH) {
                revert InvalidOption();
            }
        }
        if (deadline <= block.timestamp || deadline > block.timestamp + MAX_DURATION) {
            revert InvalidDeadline();
        }

        pollId = polls.length;
        polls.push();
        Poll storage p = polls[pollId];
        p.question = question;
        p.deadline = deadline;
        p.creator = msg.sender;
        for (uint256 i = 0; i < options.length; i++) {
            p.options.push(options[i]);
            p.votes.push(0);
        }

        emit PollCreated(pollId, msg.sender, question, deadline);
    }

    /// @notice Vote on a poll. Only Agent ID holders, one vote per address per poll.
    function vote(uint256 pollId, uint256 option) external onlyHolder {
        if (pollId >= polls.length) revert PollNotFound();
        Poll storage p = polls[pollId];
        if (block.timestamp > p.deadline) revert PollClosed();
        if (option >= p.options.length) revert InvalidOptionIndex();
        if (voted[pollId][msg.sender]) revert AlreadyVoted();

        voted[pollId][msg.sender] = true;
        p.votes[option] += 1;
        p.totalVotes += 1;

        emit Voted(pollId, msg.sender, option, p.totalVotes);
    }

    /// @notice Total number of polls created.
    function pollCount() external view returns (uint256) {
        return polls.length;
    }

    /// @notice Full poll data: question, options, vote counts, deadline, creator, total votes.
    function getPoll(uint256 pollId)
        external
        view
        returns (
            string memory question,
            string[] memory options,
            uint256[] memory votes,
            uint256 deadline,
            address creator,
            uint256 totalVotes
        )
    {
        if (pollId >= polls.length) revert PollNotFound();
        Poll storage p = polls[pollId];
        return (p.question, p.options, p.votes, p.deadline, p.creator, p.totalVotes);
    }

    /// @notice Whether `voter` already voted on `pollId`.
    function hasVoted(uint256 pollId, address voter) external view returns (bool) {
        if (pollId >= polls.length) revert PollNotFound();
        return voted[pollId][voter];
    }
}
