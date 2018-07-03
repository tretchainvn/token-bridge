require('dotenv').config()
const Web3 = require('web3')
const { signatureToVRS } = require('../utils/message')

const { HOME_RPC_URL, FOREIGN_RPC_URL, VALIDATOR_ADDRESS } = process.env

function processCollectedSignaturesBuilder(config) {
  const homeProvider = new Web3.providers.HttpProvider(HOME_RPC_URL)
  const web3Home = new Web3(homeProvider)
  const homeBridge = new web3Home.eth.Contract(config.homeBridgeAbi, config.homeBridgeAddress)

  const foreignProvider = new Web3.providers.HttpProvider(FOREIGN_RPC_URL)
  const web3Foreign = new Web3(foreignProvider)
  const foreignBridge = new web3Foreign.eth.Contract(
    config.foreignBridgeAbi,
    config.foreignBridgeAddress
  )

  return async function processCollectedSignatures(signatures) {
    const txToSend = []
    const callbacks = signatures.map(async (colSignature, indexSig) => {
      const {
        authorityResponsibleForRelay,
        messageHash,
        NumberOfCollectedSignatures
      } = colSignature.returnValues

      if (authorityResponsibleForRelay === web3Home.utils.toChecksumAddress(VALIDATOR_ADDRESS)) {
        const message = await homeBridge.methods.message(messageHash).call()

        const requiredSignatures = []
        requiredSignatures.length = NumberOfCollectedSignatures
        requiredSignatures.fill(0)

        const [v, r, s] = [[], [], []]
        const signaturePromises = requiredSignatures.map(async (el, index) => {
          const signature = await homeBridge.methods.signature(messageHash, index).call()
          const recover = signatureToVRS(signature)
          v.push(recover.v)
          r.push(recover.r)
          s.push(recover.s)
        })

        await Promise.all(signaturePromises)

        let gasEstimate
        try {
          gasEstimate = await foreignBridge.methods
            .executeSignatures(v, r, s, message)
            .estimateGas()
        } catch (e) {
          console.log(indexSig + 1, ' # already processed col sig', colSignature.transactionHash)
          return
        }
        const data = await foreignBridge.methods.executeSignatures(v, r, s, message).encodeABI()
        txToSend.push({
          data,
          gasEstimate,
          transactionReference: colSignature.transactionHash,
          to: config.foreignBridgeAddress
        })
      }
    })

    await Promise.all(callbacks)

    return txToSend
  }
}

module.exports = processCollectedSignaturesBuilder
