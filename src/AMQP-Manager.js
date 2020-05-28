const clone = require('clone')
var amqp = require('amqplib');

const { logger } = require('./Logger-Loader')

class AMQPTransporter {
  constructor() {
    
  }

  verify(config) {
    // logger.info("Checking AWS Configuration...")

    // if(config.aws == null) {
    //   logger.warn("AWS Credentials not set. Environment set?");
    // } else {
    //   if(config.aws.sqs == null) {
    //     logger.warn("SQS configuration not set.");
    //   }
    //   if(config.aws.sns == null) {
    //     logger.warn("SNS configuration not set.");
    //   }
    // }
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
      console.log("#### Channel is ready again !!!!!")
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

// // ==============================
// // Inner, private functions
// // ==============================
// function findQueue(sqsAPI, queueName, autoCreate) {
//   return new Promise((resolve, reject) => {
//     sqsAPI.listQueues({QueueNamePrefix: queueName}, function(err, data) {
//       if(err)
//         reject(err);
//       else if(data.QueueUrls == null || data.QueueUrls.length == 0)
//         if(autoCreate) {
//           createQueue(sqsAPI, queueName).then(resolve);
//         }
//         else
//           reject("No queue found for " + queueName);
//       else
//         resolve(data.QueueUrls[0]);
//     });
//   })
// }

// function createQueue(sqsAPI, queueName) {
//   logger.info("Creating queue... ", sqsAPI != null);
//   var params = {
//     QueueName: queueName
//   };
//   return new Promise((res, rej) => {
//     sqsAPI.createQueue(params, function(err, data) {
//       if (err) rej(err); 
//       else {
//         logger.info(`Queue created: ${JSON.stringify(data.QueueUrl)}`)
//         res(data.QueueUrl)
//       }           
//     });
//   })
// }

// function sendToQueue(sqsAPI, queueUrl, data) {
//   var send_params = {
//     MessageBody: JSON.stringify(data),
//     QueueUrl: queueUrl,
//     DelaySeconds: 0
//   };

//   logger.debug("Sending message to queue: " + queueUrl);

//   return new Promise((resolve, reject) => {
//     sqsAPI.sendMessage(send_params, function(err, data) {
//       if (err) {
//         reject(err)
//       } else {
//         logger.debug("Message sent!");
//         resolve(data)
//       }
//     });
//   });
// }

// function getMessages(sqsAPI, queueUrl, params) {
//   var realParams = clone(params);
//   realParams.QueueUrl = queueUrl;

//   return new Promise((resolve, reject) => {
//     sqsAPI.receiveMessage(realParams, function(err, data) {
//       if (err) reject(err)
//       else resolve(data.Messages)
//     });
//   })
// }

// function removeFromQueue(sqsAPI, queueUrl, receipt){
//   return new Promise((resolve,reject) => {
//     sqsAPI.deleteMessage({QueueUrl: queueUrl, ReceiptHandle: receipt }, 
//       function(err, data) {
//         if (err) reject(err);
//         else {
//             resolve();
//         }
//     });
//   })
// }

module.exports = { AMQPTransporter } 