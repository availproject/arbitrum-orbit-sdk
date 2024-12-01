import { Chain, createPublicClient, http } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia } from 'viem/chains';
import { writeFile } from 'fs/promises';
import {
    FallbackS3Config,
    L3ChainConfig,
    ChainConfig,
    PrepareNodeConfigParams,
    prepareNodeConfig,
    prepareChainConfig,
    createRollupPrepareDeploymentParamsConfig,
    createRollup,
    CreateRollupResults,
} from '@avail-project/avail-orbit-sdk';
import { sanitizePrivateKey, generateChainId, getParentChainLayer } from '@avail-project/avail-orbit-sdk/utils';
import { config } from 'dotenv';
config();

function getRpcUrl(chain: Chain) {
    return chain.rpcUrls.default.http[0];
}

function validateForFallbackS3() {
    if (process.env.FALLBACKS3_ACCESS_KEY === 'undefined' || process.env.FALLBACKS3_SECRET_KEY === 'undefined' || process.env.FALLBACKS3_REGION === 'undefined' || process.env.FALLBACKS3_OBJECT_PREFIX === 'undefined' || process.env.FALLBACKS3_BUCKET === 'undefined') {
        throw new Error(`Please provide all details for fallback s3`)
    }
    return true
}

function withFallbackPrivateKey(privateKey: string | undefined): `0x${string}` {
    if (typeof privateKey === 'undefined' || privateKey === '') {
        return generatePrivateKey();
    }

    return sanitizePrivateKey(privateKey);
}

if (typeof process.env.DEPLOYER_PRIVATE_KEY === 'undefined') {
    throw new Error(`Please provide the "DEPLOYER_PRIVATE_KEY" environment variable`);
}

if (typeof process.env.PARENT_CHAIN_RPC === 'undefined' || process.env.PARENT_CHAIN_RPC === '') {
    console.warn(
        `Warning: you may encounter timeout errors while running the script with the default rpc endpoint. Please provide the "PARENT_CHAIN_RPC" environment variable instead.`,
    );
}

if (typeof process.env.AVAIL_ADDR_SEED === 'undefined' || typeof process.env.AVAIL_APP_ID === 'undefined') {
    throw new Error(`Please provide the Avail account seed and app id with "AVAIL_ADDR_SEED" and "AVAIL_APP_ID" enviornment variable respectively`)
}



// load or generate a random batch poster account
const batchPosterPrivateKey = withFallbackPrivateKey(process.env.BATCH_POSTER_PRIVATE_KEY);
const batchPoster = privateKeyToAccount(batchPosterPrivateKey).address;

// load or generate a random validator account
const validatorPrivateKey = withFallbackPrivateKey(process.env.VALIDATOR_PRIVATE_KEY);
const validator = privateKeyToAccount(validatorPrivateKey).address;

// set the parent chain and create a public client for it
const parentChain = arbitrumSepolia;
const parentChainPublicClient = createPublicClient({
    chain: parentChain,
    transport: http(process.env.PARENT_CHAIN_RPC),
});

// load the deployer account
const deployer = privateKeyToAccount(sanitizePrivateKey(process.env.DEPLOYER_PRIVATE_KEY));

async function main() {
    // generate a random chain id
    const chainId = generateChainId();

    const createRollupConfig = createRollupPrepareDeploymentParamsConfig(parentChainPublicClient, {
        chainId: BigInt(chainId),
        owner: deployer.address,
        chainConfig: prepareChainConfig({
            chainId,
            arbitrum: {
                InitialChainOwner: deployer.address,
                DataAvailabilityCommittee: false,
            },
        }),
    });

    try {
        const result: CreateRollupResults = await createRollup({
            params: {
                config: createRollupConfig,
                batchPosters: [batchPoster],
                validators: [validator],
            },
            account: deployer,
            parentChainPublicClient,
        });


        // get the chain config from the transaction inputs
        const chainConfig: ChainConfig = JSON.parse(result.transaction.getInputs()[0].config.chainConfig);
        // get the core contracts from the transaction receipt
        const coreContracts = result.coreContracts

        // Parse the value to a number
        const availAppId = Number(process.env.AVAIL_APP_ID);

        // Validate that it's a valid number
        if (isNaN(availAppId)) {
            throw new Error("AVAIL_APP_ID is not a valid number");
        }

        let fallbackS3Config: FallbackS3Config = {
            enable: false
        }
        if (process.env.FALLBACKS3_ENABLE?.toLowerCase() === 'true' && validateForFallbackS3()) {
            fallbackS3Config = {
                enable: true,
                accessKey: process.env.FALLBACKS3_ACCESS_KEY as `${string}`,
                secretKey: process.env.FALLBACKS3_SECRET_KEY as `${string}`,
                region: process.env.FALLBACKS3_REGION as `${string}`,
                objectPrefix: process.env.FALLBACKS3_OBJECT_PREFIX as `${string}`,
                bucket: process.env.FALLBACKS3_BUCKET as `${string}`
            }
        }

        // prepare the node config
        const nodeConfigParameters: PrepareNodeConfigParams = {
            chainName: 'My Orbit Chain',
            chainConfig,
            coreContracts,
            batchPosterPrivateKey: process.env.BATCH_POSTER_PRIVATE_KEY as `0x${string}`,
            validatorPrivateKey: process.env.VALIDATOR_PRIVATE_KEY as `0x${string}`,
            availAddressSeed: process.env.AVAIL_ADDR_SEED as ` ${string}`,
            fallbackS3Config: fallbackS3Config,
            availAppId,
            parentChainId: parentChain.id,
            parentChainRpcUrl: getRpcUrl(parentChain),
        };

        // For L2 Orbit chains settling to Ethereum mainnet or testnet
        if (getParentChainLayer(parentChainPublicClient.chain.id) === 1) {
            nodeConfigParameters.parentChainBeaconRpcUrl = process.env.ETHEREUM_BEACON_RPC_URL;
        }

        const nodeConfig = prepareNodeConfig(nodeConfigParameters);

        await writeFile('nodeConfig.json', JSON.stringify(nodeConfig, null, 2));


        const l3Config: L3ChainConfig = {
            'networkFeeReceiver': deployer.address,
            'infrastructureFeeCollector': deployer.address,
            'staker': validator,
            'batchPoster': batchPoster,
            'chainOwner': deployer.address,
            'chainId': chainConfig.chainId,
            'chainName': 'My Orbit Chain',
            'minL2BaseFee': 100000000,
            'parentChainId': parentChain.id,
            'parent-chain-node-url': getRpcUrl(parentChain),
            'utils': coreContracts.validatorUtils,
            ...coreContracts,
        };

        await writeFile('orbitSetupScriptConfig.json', JSON.stringify(l3Config, null, 2));

        console.log(`Node config and Orbit setup script written to "nodeConfig.json" and "orbitSetupScriptConfig.json" respectively`);

    } catch (error) {
        console.error(`Rollup creation failed with error: ${error}`);
    }
}

main();
