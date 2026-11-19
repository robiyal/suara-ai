// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";

/// @notice Computes (and logs) the CREATE2 address SuaraAI will land on when
/// deployed through the deterministic deployment proxy on BSC.
/// Reference only — this script never broadcasts anything.
contract PredictAddress is Script {
    /// @notice Deterministic deployment proxy (Arachnid), same address on BSC.
    /// NOTE: the task brief listed this address as
    /// 0x4e59b44847b379578588920cA78FbF26c0B3B3, which has only 38 hex digits
    /// and is not a valid address. The canonical address below (from the
    /// Arachnid deterministic-deployment-proxy README) was verified live on
    /// BSC before use — see DEPLOY.md.
    address constant PROXY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    function run() external {
        bytes memory initCode = vm.getCode("SuaraAI.sol:SuaraAI");
        bytes32 salt = keccak256("suara-ai-v1");
        bytes32 hash = keccak256(
            abi.encodePacked(bytes1(0xff), PROXY, salt, keccak256(initCode))
        );
        address predicted = address(uint160(uint256(hash)));
        console.log("salt (keccak256(\"suara-ai-v1\")):");
        console.logBytes32(salt);
        console.log("init code hash:");
        console.logBytes32(keccak256(initCode));
        console.log("predicted CREATE2 address:");
        console.log(predicted);
    }
}
