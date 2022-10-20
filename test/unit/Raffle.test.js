const { assert, expect } = require("chai")
const { network, getNamedAccounts, ethers } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Raffle Unit Tests", function () {
          //when using let you dont have to initalize it right away
          let raffle, vrfCoordinatorV2Mock, deployer, raffleEntranceFee, interval
          const chainId = network.config.chainId
          beforeEach(async function () {
              //await keyword means stop until this function is complete; use when promise is returned
              deployer = (await getNamedAccounts()).deployer
              //this deploys all contracts b/c both deploy scripts have module.exports.tags["all"]
              await deployments.fixture(["all"])
              raffle = await ethers.getContract("Raffle", deployer)
              vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer)
              //add consumer to subscription
              const subscriptionId = await raffle.getSubscriptionId()
              await vrfCoordinatorV2Mock.addConsumer(subscriptionId, raffle.address)

              raffleEntranceFee = await raffle.getEntranceFee()
              interval = await raffle.getRaffleInterval()
          })

          describe("constructor", function () {
              //Ideally we want 1 assert per it statement
              it("initializes the raffle state correctly", async function () {
                  const raffleState = await raffle.getRaffleState()
                  //dont need the .toString() to pass test
                  //most numbers you are getting from contract will be BigNumber and .toString() will make them readable for us
                  assert.equal(raffleState.toString(), "0")
              })
              it("initializes the raffle interval correctly", async function () {
                  assert.equal(interval.toString(), networkConfig[chainId]["interval"])
              })
              it("initializes the vrfCoordinatorV2Mock correctly", async function () {
                  const response = await raffle.getVRFCoordinator()
                  //dont need .address on response b/c it is interface so it is shown as an address
                  assert.equal(response, vrfCoordinatorV2Mock.address)
              })
          })
          describe("enterRaffle", function () {
              it("reverts when you dont pay enough", async function () {
                  await expect(raffle.enterRaffle()).to.be.revertedWith(
                      "Raffle__NotEnoughETHEntered"
                  )
              })
              it("records players when they enter", async function () {
                  //entering raffle with deployer since we didnt specify new account
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  const response = await raffle.getPlayer(0)
                  assert.equal(response, deployer)
              })
              it("emits event on enter", async function () {
                  await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.emit(
                      raffle,
                      "RaffleEnter"
                  )
              })
              it("doesnt allow entrance when raffle is calculating", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  //simulate time increase and block mine
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  //pretend to be chainlink keeper
                  await raffle.performUpkeep([])
                  await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.be.revertedWith(
                      "Raffle__NotOpen"
                  )
              })
          })
          describe("checkUpkeep", function () {
              it("returns false if people haven't sent any ETH", async function () {
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  //call static simulates a transaction (calling a function) and seeing what it returns without actually calling the function
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])
                  assert.equal(upkeepNeeded, false)
              })
              it("returns false if raffle isn't open", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  //you can send a blank bytes objects with [] or "0x"
                  await raffle.performUpkeep([])
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])
                  assert.equal(upkeepNeeded, false)
              })
              it("returns false if enough time hasn't passed", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() - 5])
                  //same as the await network.provider.send("evm_mine", [])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x")
                  //same as assert.equal(upkeepNeeded, false)
                  assert(!upkeepNeeded)
              })
              it("returns true if enough time has passed, has players, eth, and is open", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x") // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                  assert(upkeepNeeded)
              })
          })
          describe("performUpkeep", function () {
              it("it can only run if checkUpkeep is true", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  const txResponse = await raffle.performUpkeep("0x")
                  //if tx doesnt work then assert(tx) will fail
                  assert(txResponse)
              })
              it("reverts when checkUpkeep is false", async function () {
                  //if you want to be super specific you can have it print the exactly the values the revert is looking for
                  await expect(raffle.performUpkeep("0x")).to.be.revertedWith(
                      "Raffle__UpkeepNotNeeded"
                  )
              })
              it("emits an event and calls the vrf coordinator", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  const txResponse = await raffle.performUpkeep("0x")
                  const txReceipt = await txResponse.wait(1)
                  //events[1] because our custom event is the second event emitted after the one emitted when .requestRandomwords() is called
                  const requestId = txReceipt.events[1].args.requestId
                  //dont need the .toNumber() for logic to work but makes it more readable
                  assert(requestId.toNumber() > 0)
              })
              it("updates the raffle state", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  await raffle.performUpkeep("0x")
                  const raffleState = await raffle.getRaffleState()
                  //dont need .toString()
                  assert(raffleState.toString() == "1")
              })
          })
          describe("fulfullRandomWords", function () {
              beforeEach(async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
              })
              it("can only be called after performUpkeep", async function () {
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.address)
                  ).to.be.revertedWith("nonexistent request")
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.address)
                  ).to.be.revertedWith("nonexistent request")
              })
              //this test should actually be broken up into a buncha tests
              it("picks a winner, resets the lottery, and sends money", async function () {
                  const additionalEntrants = 3
                  const startingAccountIndex = 1 //since deployer = 0
                  const accounts = await ethers.getSigners()
                  for (
                      let i = startingAccountIndex;
                      i < additionalEntrants + startingAccountIndex;
                      i++
                  ) {
                      const accountConnectRaffle = raffle.connect(accounts[i])
                      await accountConnectRaffle.enterRaffle({ value: raffleEntranceFee })
                  }
                  const startingTimeStamp = await raffle.getLatestTimeStamp()
                  // call preformUpkeep (mock being chainlink keepers) which will call fulfillRandomWords (mock being chainlink VRF)
                  // we have to wait for fulfullRandomWords to be called so we set up a listener for the WinnerPicked event to be emitted
                  // we dont want the test to finish before our listener is done listening so we need to create a new promise
                  await new Promise(async (resolve, reject) => {
                      //setting up listener; basically saying listen for the WinnerPicked event to be emitted then do some stuff
                      raffle.once("WinnerPicked", async () => {
                          console.log("Found the event!")
                          try {
                              const recentWinner = await raffle.getRecentWinner()
                              const raffleState = await raffle.getRaffleState()
                              const endingTimeStamp = await raffle.getLatestTimeStamp()
                              const numPlayers = await raffle.getNumberOfPlayers()
                              const winnerEndingBalance = await accounts[1].getBalance()
                              assert.equal(numPlayers.toString(), "0")
                              assert.equal(raffleState.toString(), "0")
                              assert(endingTimeStamp > startingTimeStamp)

                              assert.equal(
                                  winnerEndingBalance.toString(),
                                  winnerStartingBalance.add(
                                      raffleEntranceFee
                                          .mul(additionalEntrants)
                                          .add(raffleEntranceFee)
                                          .toString()
                                  )
                              )
                              resolve()
                          } catch (e) {
                              reject(e)
                          }
                      })
                      //mocking chainlink keepers
                      const tx = await raffle.performUpkeep([])
                      const txReceipt = await tx.wait(1)

                      const winnerStartingBalance = await accounts[1].getBalance()
                      //mocking chainlink vrf and emitting WinnerPicked event i guess
                      await vrfCoordinatorV2Mock.fulfillRandomWords(
                          txReceipt.events[1].args.requestId,
                          raffle.address
                      )
                  })
              })
          })
      })
