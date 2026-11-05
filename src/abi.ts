// Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
import { parseAbi } from 'viem';
export const tokenAbi = parseAbi([
  'function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)',
  'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)',
]);
export const messengerAbi = parseAbi([
  'function depositForBurn(uint256 amount,uint32 destinationDomain,bytes32 mintRecipient,address burnToken,bytes32 destinationCaller,uint256 maxFee,uint32 minFinalityThreshold)',
  'function depositForBurnWithHook(uint256 amount,uint32 destinationDomain,bytes32 mintRecipient,address burnToken,bytes32 destinationCaller,uint256 maxFee,uint32 minFinalityThreshold,bytes hookData)',
]);
export const transmitterAbi = parseAbi([
  'function receiveMessage(bytes message,bytes attestation) returns (bool)',
  'function usedNonces(bytes32 nonce) view returns (uint256)', 'event MessageSent(bytes message)',
]);
