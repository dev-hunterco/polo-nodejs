const clone = require('clone')
var amqp = require('amqplib');

const { logger } = require('./Logger-Loader')

class AMQPTransporter {
  constructor() {
  }

  verify(config) {
  }

  initialize(config) {
    this.config = config
  }

  async initializeQueue() {
    this.connection = await amqp.connect(this.config.amqp.address)
    await this.createChannel()

    this.queueName = `${this.config.app}_${this.config.stage}`
    return this.channel.assertQueue(this.queueName, { durable: true }) 
  }

  async createChannel() {
    this.channel = await this.connection.createChannel()
    this.channel.prefetch(this.config.amqp.MaxNumberOfMessages || 10)
    this.channelState = 'ready'

    this.channel.on('drain', function() {
      logger.info("#### Channel is ready again !!!!!")
      this.channelState = 'ready'
    })
  }

  sendMessage(destApp, message, overrideCallback) {
    message.sentBy.callback = overrideCallback || this.queueName

    const destinationQueue = `${destApp}_${this.config.stage}`

    let chain = Promise.resolve()
    if(!this.config.amqp.create) {
      chain = chain.then(_ => this.channel.checkQueue(destinationQueue))
        .catch(error => {
          // restore broken connection
          return this.close()
            .then(_ => this.initializeQueue())
            .then(_ => {
              throw new Error("No queue found for app: " + destApp)
            }) 
          
        })
    }
    chain = chain.then(_ => this.channel.assertQueue(destinationQueue, { durable: true }))

    return chain.then(_ => this.sendDirect(destinationQueue, message))
  }

  sendDirect(queueAddress, message) {
    const msgBuffer = Buffer.from(JSON.stringify(message))

    const _self = this
    const sendPromise = (waitingTime) => new Promise((resolve, reject) => {
      setTimeout(function() {
        if(_self.channelState === 'ready') {
          const sent = _self.channel.sendToQueue(queueAddress, msgBuffer)
          if(sent) {
            logger.debug(`AMQP Message sent: ${message.type}:${message.service}`)
            resolve(sent)
          }
          else {
            logger.warn('AMQP Drained channel, waiting to send again')
            this.channelState = 'busy'
            return sendPromise(500)
          }
        }
      }, waitingTime)
    });

    return sendPromise(0)
  }

  readMessages(params, consumer) {
    logger.debug("AMQP reading messages..")
    const preConsumer = (msg) => {
      return consumer({Body: msg.content.toString(), _source: msg})
    }

    if(this.config.amqp.readingMode === 'rpc') {
      return this.channel.get(this.queueName)
        .then(msg => {
          if(msg) preConsumer(msg)
          else Promise.resolve([])
        })
    }
    else return this.channel.consume(this.queueName, preConsumer)
  }

  deleteMessage(message) {
    logger.debug("# Deleting message")
    return Promise.resolve(this.channel.ack(message._source))
  }

  keepMessage(message) {
    logger.debug("# Keeping message")
    return Promise.resolve(this.channel.nack(message._source))
  }

  close() {
    return this.connection.close()
  }
}

module.exports = { AMQPTransporter } 