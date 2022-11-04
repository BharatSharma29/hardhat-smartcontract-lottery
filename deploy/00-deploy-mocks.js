const {developmentChains} = require("../helper-hardhat-config");

const BASE_FEE = ethers.utils.parseEther("0.25"); // 0.25 is the premium. It costs 0.25 LINK per request.
const GAS_PRICE_LINK = 1e9 //=1000000000 //link per gas. calculated value based on the gas price of the chain.

//suppose the Eth price sky rockted to ^$1,000,000,000
//When chainlink nodes responds chainlink nodes pay the gas fee to give us the randomness & do external execution
//So they change price of requests change based on the price of the gas

module.exports = async function ({getNamedAccounts, deployments}) {
    const {deploy, log} = deployments;
    const {deployer} = await getNamedAccounts();
    //const chainId = network.config.chainId;
    const args = [BASE_FEE, GAS_PRICE_LINK];
    
    if(developmentChains.includes(network.name)){
        log("Local network detected! Deploying mocks...");
        //Deploy a mock vrf coordinator.
        await deploy("VRFCoordinatorV2Mock", {
            from: deployer,
            log: true,
            args: args,
        })
        log("Mocks Deployed");
        log("-------------------------00-Mocks-------------------------");
    }
}

module.exports.tags = ["all", "mocks"];