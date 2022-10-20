// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

//this is so that we are able to test our Raffle.sol contract on our local blockchain
//instead of using the address of actual vrfcoordinatorv2 contract we import a mock contract into our repo
import "@chainlink/contracts/src/v0.8/mocks/VRFCoordinatorV2Mock.sol";
