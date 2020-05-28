const clone = require('clone')
const AWS = require('aws-sdk')
const { logger } = require('./Logger-Loader')

class SQSTransporter {
  constructor() {
    this.awsAPIs = {}
    this.cachedURLs = {}
  }

  verify(config) {
    logger.info("Checking AWS Configuration...")

    if(config.aws == null) {
      logger.warn("AWS Credentials not set. Environment set?");
    } else {
      if(config.aws.sqs == null) {
        logger.warn("SQS configuration not set.");
      }
      if(config.aws.sns == null) {
        logger.warn("SNS configuration not set.");
      }
    }
  }

  initialize(config) {
    this.config = config
    if(config.aws != null && config.aws.api != null) {
      AWS.config.update(config.aws.api)
    }
  }

  initializeQueue() {
    if(this.config.aws && this.config.aws.sqs ) {
      logger.info('Initializing sqs using custom configuration...')
      this.awsAPIs.sqs = new AWS.SQS(this.config.aws.sqs);
    } else {
        logger.info('Initializing sqs using defaults')
        this.awsAPIs.sqs = new AWS.SQS({ apiVersion: '2012-11-05' });
    }

    // Define o nome da fila
    this.queueName = this.config.app + "_" + this.config.stage;
  
    var self = this;
    return new Promise((resolve,reject) => {
      self.awsAPIs.sqs.listQueues({QueueNamePrefix: self.queueName}, function(err, data) {
        if(err) {
          reject(err);
          return;
        }

        if(data.QueueUrls) {
          self.queueURL = data.QueueUrls[0]; // Não devem existir mais de uma fila
          logger.info("Found queue for " + self.config.app + ": " + self.queueURL);
          resolve()
        }
        else if (self.config.aws.sqs.create) {
          createQueue(self.awsAPIs.sqs, self.queueName).then(url => {
            self.queueURL = url;
            resolve()
          });
        }
        else {
          logger.error("Queue not found...");
          reject("Queue " + self.queueName + " not found...");
        }
      })
    })
  }

  sendMessage(destApp, message, overrideCallback) {
    // Add callback property to the message
    message.sentBy.callback = overrideCallback || this.queueURL

    // Creates a chain to process message to queue
    var self = this;
    var promise = null;
    var destQueue = this.cachedURLs[destApp];
    if(destQueue == null) {
      var targetQueue = destApp + "_" + this.config.stage; // sempre usa o mesmo stage do app
      promise = findQueue(this.awsAPIs.sqs, targetQueue, this.config.aws.sqs.create)
        .catch(_ => null)
    }
    else 
      promise = new Promise((rs, rj) => rs(destQueue));

    return promise
      .then(destQueue => { 
        if(destQueue == null) {
          throw new Error("No queue found for app: " + destApp);
        }
        else {
          return self.sendDirect(destQueue, message);
        }
      });
  }

  sendDirect(queueAddress, message) {
    return sendToQueue(this.awsAPIs.sqs, queueAddress, message);
  }

  readMessages(params, consumer) {
    // merge default parameters with requests, if any 
    var realParams = clone(this.config.aws.sqs.consume);
    if(params) {
      Object.keys(params).forEach(p => {
        realParams[key] = params[key];
      })
    }

    return getMessages(this.awsAPIs.sqs, this.queueURL, realParams)
      .then(messages => {
        if(!messages) return [Promise.resolve()]

        if(consumer.then) // Already a promise
          return messages.map(m => consumer(m))
        else
          return messages.map(m => new Promise((resolve, reject) => { consumer(m); resolve()} ))
      })
      .then(promises => Promise.all(promises))
  }

  deleteMessage(message) {
    return removeFromQueue(this.awsAPIs.sqs, this.queueURL, message.ReceiptHandle)
  }

  keepMessage(message) {
    return Promise.resolve()
  }

  close() {
    // should do something?
  }
    
}

// ==============================
// Inner, private functions
// ==============================
function findQueue(sqsAPI, queueName, autoCreate) {
  return new Promise((resolve, reject) => {
    sqsAPI.listQueues({QueueNamePrefix: queueName}, function(err, data) {
      if(err)
        reject(err);
      else if(data.QueueUrls == null || data.QueueUrls.length == 0)
        if(autoCreate) {
          createQueue(sqsAPI, queueName).then(resolve);
        }
        else
          reject("No queue found for " + queueName);
      else
        resolve(data.QueueUrls[0]);
    });
  })
}

function createQueue(sqsAPI, queueName) {
  logger.info("Creating queue... ", sqsAPI != null);
  var params = {
    QueueName: queueName
  };
  return new Promise((res, rej) => {
    sqsAPI.createQueue(params, function(err, data) {
      if (err) rej(err); 
      else {
        logger.info(`Queue created: ${JSON.stringify(data.QueueUrl)}`)
        res(data.QueueUrl)
      }           
    });
  })
}

function sendToQueue(sqsAPI, queueUrl, data) {
  var send_params = {
    MessageBody: JSON.stringify(data),
    QueueUrl: queueUrl,
    DelaySeconds: 0
  };

  logger.debug("Sending message to queue: " + queueUrl);

  return new Promise((resolve, reject) => {
    sqsAPI.sendMessage(send_params, function(err, data) {
      if (err) {
        reject(err)
      } else {
        logger.debug("Message sent!");
        resolve(data)
      }
    });
  });
}

function getMessages(sqsAPI, queueUrl, params) {
  var realParams = clone(params);
  realParams.QueueUrl = queueUrl;

  return new Promise((resolve, reject) => {
    sqsAPI.receiveMessage(realParams, function(err, data) {
      if (err) reject(err)
      else resolve(data.Messages)
    });
  })
}

function removeFromQueue(sqsAPI, queueUrl, receipt){
  return new Promise((resolve,reject) => {
    sqsAPI.deleteMessage({QueueUrl: queueUrl, ReceiptHandle: receipt }, 
      function(err, data) {
        if (err) reject(err);
        else {
            resolve();
        }
    });
  })
}

module.exports = { SQSTransporter } 