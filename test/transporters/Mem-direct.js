const clone = require('clone')
const { logger } = require('../../src/Logger-Loader')

class MemDirectTransporter {
  constructor() {
  }

  verify(config) {
    return Promise.resolve()
  }

  initialize(config, parentApi) {
    this.config = config
    this.parentApi = parentApi
    return Promise.resolve()
  }

  async initializeQueue() {
    if(!global._SYNC_REFS) global._SYNC_REFS = {}
    global._SYNC_REFS[this.config.app] = this.parentApi

    return Promise.resolve()
  }

  sendMessage(destApp, message, overrideCallback) {
    message.sentBy.callback = overrideCallback || this.config.app

    return this.sendDirect(destApp, message)
  }
  
  sendDirect(queueAddress, message) {
    logger.debug(`${this.config.app} sending message to ${queueAddress}`)
    const wrappedMessage = {
      Body: JSON.stringify(message)
    }
    
    const targetApi = global._SYNC_REFS[queueAddress]
    if(!targetApi) return Promise.reject({message: `No queue found for app: ${queueAddress}`})
    
    return targetApi.processMessage(wrappedMessage)
  }

  readMessages(params, consumer) {
    // There's no need to read messages because they are all directly delivered 
    return Promise.resolve()
  }

  deleteMessage(message) {
    return Promise.resolve()
  }

  keepMessage(message) {
    return Promise.resolve()
  }

  close() {
    delete global._SYNC_REFS[this.config.app]
  }
}

module.exports = { MemDirectTransporter } 