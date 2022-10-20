const { network } = require("hardhat")
const { developmentChains } = require("../helper-hardhat-config")

const BASE_FEE = ethers.utils.parseEther("0.25") // 0.25 is the premium. It costs 0.25 LINK per request according to chainlink docs
//chainlink nodes are the ones paying the gas fee for our requests
//the price of the request is based on the price of the gas
const GAS_PRICE_LINK = 1e9

module.exports = async ({ getNamedAccounts, deployments }) => {
    const { deploy, log } = deployments
    const { deployer } = await getNamedAccounts()

    if (developmentChains.includes(network.name)) {
        log("Local network detected! Deploying mocks...")
        const args = [BASE_FEE, GAS_PRICE_LINK]
        await deploy("VRFCoordinatorV2Mock", {
            from: deployer,
            //get args params from looking at contract on github
            args: args,
            log: true,
        })
        log("mocks deployed!")
        log("--------------------------------------------------")
    }
}

module.exports.tags = ["all", "mocks"]
