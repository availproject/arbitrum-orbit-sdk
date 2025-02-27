import { Address, PublicClient, Transport, Chain, maxInt256 } from 'viem';

import { approvePrepareTransactionRequest } from './utils/erc20';

import { Prettify } from './types/utils';
import { validateParentChain } from './types/ParentChain';
import { WithTokenBridgeCreatorAddressOverride } from './types/createTokenBridgeTypes';
import { getTokenBridgeCreatorAddress } from './utils/getTokenBridgeCreatorAddress';

export type CreateTokenBridgePrepareCustomFeeTokenApprovalTransactionRequestParams<
  TChain extends Chain | undefined,
> = Prettify<
  WithTokenBridgeCreatorAddressOverride<{
    amount?: bigint;
    nativeToken: Address;
    owner: Address;
    publicClient: PublicClient<Transport, TChain>;
  }>
>;

export async function createTokenBridgePrepareCustomFeeTokenApprovalTransactionRequest<
  TChain extends Chain | undefined,
>({
  amount = maxInt256,
  nativeToken,
  owner,
  publicClient,
  tokenBridgeCreatorAddressOverride,
}: CreateTokenBridgePrepareCustomFeeTokenApprovalTransactionRequestParams<TChain>) {
  const chainId = validateParentChain(publicClient);

  const request = await approvePrepareTransactionRequest({
    address: nativeToken,
    owner,
    spender: tokenBridgeCreatorAddressOverride ?? getTokenBridgeCreatorAddress(publicClient),
    amount,
    publicClient,
  });

  return { ...request, chainId };
}
