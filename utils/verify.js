const { run } = require("hardhat");

async function verify(contractAddress, agrs) {
    console.log("Verifying, please wait...");
    try {
        await run("verify:verify", {
            address: contractAddress,
            constructorArguments: agrs,
        });
    } catch (e) {
        if (e.message.toLowerCase().includes("already verified")) {
            console.log("Already Verified!!!");
        } else {
            console.log(e);
        }
    }
}
module.exports = { verify };