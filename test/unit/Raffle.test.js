const { assert, expect } = require("chai");
const { getNamedAccounts, deployments, ethers, network } = require("hardhat");
const { developmentChains, networkConfig } = require("../../helper-hardhat-config");

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Raffle unit test", function () {
          let raffle, vrfCoordinatorV2Mock, raffleEntranceFee, deployer, interval;
          const chainId = network.config.chainId;

          beforeEach(async function () {
              deployer = (await getNamedAccounts()).deployer;
              await deployments.fixture(["all"]);
              raffle = await ethers.getContract("Raffle", deployer);
              vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer);
              const subscriptionId = await raffle.getSubscriptionId();
              await vrfCoordinatorV2Mock.addConsumer(subscriptionId, raffle.address);
              raffleEntranceFee = await raffle.getEntranceFees();
              interval = await raffle.getInterval();
          });

          describe("constructor", function () {
              it("Initializes the raffle correctly", async function () {
                  //Ideally we make our test have only 1 assert per it.
                  const raffleState = await raffle.getRaffleState();
                  assert.equal(raffleState.toString(), "0");
                  assert.equal(interval.toString(), networkConfig[chainId]["interval"]);
              });
          });

          describe("enterRaffle", function () {
              it("should revert when you don't pay enough", async function () {
                  await expect(raffle.enterRaffle()).to.be.revertedWith(
                      "Raffle__NotEnoughETHEntered"
                  );
              });

              it("records players when enter", async function () {
                  //need enterance fee to enter raffle
                  await raffle.enterRaffle({ value: raffleEntranceFee });
                  const playerFromCotract = await raffle.getPlayer(0);
                  assert.equal(playerFromCotract, deployer);
              });

              it("emits an event", async function () {
                  await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.emit(
                      raffle,
                      "RaffleEnter"
                  );
              });

              it("doesn't allow entrance while calculating", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee });
                  network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  network.provider.send("evm_mine", []);
                  //We pretend to be chainLink keeper
                  await raffle.performUpkeep([]);
                  await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.revertedWith(
                      "Raffle__NotOpened"
                  );
              });
          });

          describe("checkUpkeep", function () {
              it("returns false if people havenn't send any Eth", async function () {
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.send("evm_mine", []);
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([]);
                  assert(!upkeepNeeded);
              });

              it("returns false if raffle isn't open", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee });
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.send("evm_mine", []);
                  await raffle.performUpkeep([]); //("0x")
                  const raffleState = await raffle.getRaffleState();
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([]);
                  assert.equal(raffleState, "1");
                  assert.equal(upkeepNeeded, false);
              });

              it("returns false if enough time hasn't passed", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee });
                  await network.provider.send("evm_increaseTime", [interval.toNumber() - 5]);
                  await network.provider.send("evm_mine", []);
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x");
                  assert(!upkeepNeeded);
              });

              it("returns true if enough time has passed, has players, Eth and is Open", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee });
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.send("evm_mine", []);
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x");
                  assert(upkeepNeeded);
              });
          });

          describe("performUpkeep", function () {
              it("it can only run if checkUpkeep is true", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee });
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.send("evm_mine", []);
                  const tx = await raffle.performUpkeep([]);
                  assert(tx);
              });

              it("reverts when checkUpkeep is false", async function () {
                  await expect(raffle.performUpkeep([])).to.be.revertedWith(
                      "Raffle__UpkeepNotNeeded"
                  );
              });

              it("updates the raffle state, emits and event, and calls the vrf coordinator", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee });
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.send("evm_mine", []);
                  const txResponse = await raffle.performUpkeep([]);
                  const txReceipt = await txResponse.wait(1);
                  const requestId = await txReceipt.events[1].args.requestId;
                  const raffleState = await raffle.getRaffleState();
                  assert(requestId.toNumber() > 0);
                  assert(raffleState.toString() == "1");
              });
          });

          describe("fulfillRandomWords", function () {
              beforeEach(async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee });
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.send("evm_mine", []);
              });

              it("can only be called after performUpkeep", async function () {
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.address)
                  ).to.be.revertedWith("nonexistent request");
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.address)
                  ).to.be.revertedWith("nonexistent request");
              });

              it("picks a winner, resets the lottery and sends money", async function () {
                  let additionalEntrants = 3;
                  let startingAccountIndex = 1; //deployer = 0
                  const account = await ethers.getSigners();
                  for (
                      let i = startingAccountIndex;
                      i < startingAccountIndex + additionalEntrants;
                      i++ // i = 2; i < 5; i=i+1
                  ) {
                      const accountConnectedRaffle = raffle.connect(account[i]); // Returns a new instance of the Raffle contract connected to player
                      await accountConnectedRaffle.enterRaffle({ value: raffleEntranceFee });
                  }
                  const startingTimeStamp = await raffle.getLatestTimeStamp(); // stores starting timestamp (before we fire our event)

                  // performUpkeep (mock being chainlink keepers)
                  // fulfillRandomWords (mock being the Chainlink VRF)
                  // We will have to wait for fulfillRandomWords to be called (not for local dev but we'll stimulate it)

                  // This will be more important for our staging tests...
                  await new Promise(async (resolve, reject) => {
                      raffle.once("WinnerPicked", async () => {
                          // event listener for WinnerPicked
                          console.log("Found the evnt!");
                          // assert throws an error if it fails, so we need to wrap
                          // it in a try/catch so that the promise returns event
                          // if it fails.
                          try {
                              const recentWinner = await raffle.getRecentWinner();
                              console.log(recentWinner);
                              //   console.log(account[0].address);
                              //   console.log(account[1].address);
                              //   console.log(account[2].address);
                              //   console.log(account[3].address);
                              const winnerEndingBalance = await account[1].getBalance();
                              const raffleState = await raffle.getRaffleState();
                              const endingTimeStamp = await raffle.getLatestTimeStamp();
                              const numPlayers = await raffle.getNumberOfPlayers();
                              // Comparisons to check if our ending values are correct:
                              assert.equal(numPlayers.toString(), "0");
                              assert.equal(raffleState.toString(), "0");
                              assert(endingTimeStamp > startingTimeStamp);
                              assert.equal(
                                  winnerEndingBalance.toString(),
                                  winnerStartingBalance // startingBalance + ( (raffleEntranceFee * additionalEntrances) + raffleEntranceFee )
                                      .add(
                                          raffleEntranceFee
                                              .mul(additionalEntrants)
                                              .add(raffleEntranceFee)
                                      )
                                      .toString()
                              );
                              resolve(); // if try passes, resolves the promise
                          } catch (e) {
                              reject(e); // if try fails, rejects the promise
                          }
                      });
                      // Setting up listener
                      // below, we will fire the event, and the listener will pick it up, and resolve

                      // kicking off the event by mocking the chainlink keepers and vrf coordinator
                      const tx = await raffle.performUpkeep("0x");
                      const txReceipt = await tx.wait(1);
                      const winnerStartingBalance = await account[1].getBalance();
                      await vrfCoordinatorV2Mock.fulfillRandomWords(
                          txReceipt.events[1].args.requestId,
                          raffle.address
                      );
                  });
              });
          });
      });
