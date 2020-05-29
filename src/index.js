const clone = require('clone')
const os = require('os')
const UUID = require('uuid').v4
const { logger } = require('./Logger-Loader')

const KNOWN_TRANSPORTERS = {
  SQS: {
    detector: (conf) => !!conf.aws,
    implClass: require('./SQS-Manager').SQSTransporter
  },
  AMQP: {
    detector: (conf) => !!conf.amqp,
    implClass: require('./AMQP-Manager').AMQPTransporter
  }
}

var PoloMessaging = class PoloMessaging {
  constructor(config) {
    config = this.checkConfiguration(config);
    this.transporter = null

    // tries do identify queue handler or get in configuration
    if(config.transporter) {
      if(typeof config.transporter === 'string') {
        const Transporter = KNOWN_TRANSPORTERS[config.transporter].implClass
        this.transporter = new Transporter()
      }
      else
        this.transporter = config.transporter
    } else {
      const transportersFound = Object.entries(KNOWN_TRANSPORTERS)
        .filter(entry => {
          const detect = entry[1].detector
          return detect(config)
        })

      if(transportersFound.length === 0)
        throw new Error("No message transporter found")

      if(transportersFound.length > 1)
        logger.warn("Multiple compatible transporters. Using " + transportersFound[0][0])

      const Transporter = transportersFound[0][1].implClass
      this.transporter = new Transporter()
    }

    // Check transporters configuration
    this.transporter.verify(config)

    // Initialize transporter
    this.transporter.initialize(config, this)
    this.config = config;


    this.requestHandlers = {};
    this.responseHandlers = {}
  }

  checkConfiguration(config) {
    if(config == null)
      throw new Error("No configuration was set.");

    if(typeof(config) === "string") {
      config = require(config);
    }

    if(config.app == null)
      throw new Error("No App Identifier was set.");
    
    if(config.stage == null) {
      if(process.env.current_stage == null)
          throw new Error("Application Stage not set.");
      else {
          config.stage = process.env.current_stage;
          logger.info("Stage set to " + config.stage)
      }
    }

    if(config.worker == null) {
      var workerId = os.hostname() + "_" + process.pid;
      logger.warn("Worker Id not set. Assuming " + workerId);
      config.worker = workerId;
    }
    return config
  }

  initializeQueue() {
    return this.transporter.initializeQueue(this.config)
  }

  onRequest(service, handler) {
      this.requestHandlers[service] = handler;
  }

  onResponse(service, handler) {
      this.responseHandlers[service] = handler;
  }

  sendRequest(destApp, service, body, payload, conversationId) {
    // Verifica se o aplicativo é capaz de receber respostas do serviço.
    if(this.responseHandlers[service] == null) {
      return new Promise((res, rej) => rej(new Error("Can't send to service " + service + " without a response handler registered.")));
    }

    if(conversationId == null)
      conversationId = UUID();

    // Prepare message
    const message = {
      id: UUID(),
      conversation: conversationId,
      type: "request",
      sentBy: {
        application: this.config.app,
        instance: this.config.worker,
      },
      service: service,
      body: body,
      payload: payload,
      timestamp: new Date()
    }

    // Retira o payload caso não tenha conteúdo algum
    if((payload && payload==="") || (payload && payload == null)) delete data.payload;

    return this.transporter.sendMessage(destApp, message)
  }

  sendAsyncResponse(originalMessage, answer) {
    // Remove functions from originalMessage
    Object.entries(originalMessage)
      .filter(e => typeof e[1] === 'function' || e[0] === '_apiRef')
      .forEach(e => {
        delete originalMessage[e[0]]
      })
    
    var replyMsg = {
      conversation: originalMessage.conversation,
      id: UUID(),
      type: "response",
      sentBy: {
          application: this.config.app,
          instance: this.config.worker,
      },
      service: originalMessage.service,
      body: answer,
      success: true,
      payload: originalMessage.payload,
      timestamp: new Date(),
      originalMessage: originalMessage
    }
    if(replyMsg.payload == null || replyMsg.payload === "") delete replyMsg.payload;
    return this.transporter.sendDirect(originalMessage.sentBy.callback, replyMsg)
  }

  sendAsyncForward(originalMessage, destination) {
    var forwardMsg = {
      conversation: originalMessage.conversation,
      id: UUID(),
      type: "request",
      sentBy: originalMessage.sentBy,
      forwardedBy: {
        application: this.config.app,
        instance: this.config.worker,
      },
      service: originalMessage.service,
      body: originalMessage.body,
      payload: originalMessage.payload,
      timestamp: new Date()
    }
    if(forwardMsg.payload == null || forwardMsg.payload === "") delete forwardMsg.payload;

    return this.transporter.sendMessage(destination, forwardMsg, originalMessage.sentBy.callback)
    // return findQueue(this.awsAPIs.sqs, destination, this.config.aws.sqs.create)
    //         .then(queue => sendToQueue(this.awsAPIs.sqs, queue, forwardMsg))
  }

  sendAsyncReplyError(originalMessage, error) {
    var replyMsg = {
      type: "response",
      sentBy: {
        application: this.config.app,
        instance: this.config.worker,
      },
      service: originalMessage.service,
      body: {error: error},
      success: false,
      payload: originalMessage.payload,
      originalMessage: originalMessage
    }
    if(replyMsg.payload == null || replyMsg.payload === "") delete replyMsg.payload;

    return this.transporter.sendDirect(originalMessage.sentBy.callback, replyMsg)
  }
  
  processMessage(message) {
    logger.debug('Processing incoming message ' + message.Body)
    var messageBody = JSON.parse(message.Body);
    var handlerMap = null;
    var messageWrapper = clone(messageBody);
    messageWrapper._apiRef = this;

    // Identifica o mapa de handler que será utilizado e atualiza os métodos injetados
    // de acordo com o tipo de mensagem
    if(messageBody.type === "request") {
      handlerMap = this.requestHandlers;
      messageWrapper.reply = createReplyMethod(this, messageBody, message);
      messageWrapper.replyError = createReplyErrorMethod(this, messageBody, message);
      messageWrapper.forward = createForwardMethod(this, messageBody, message);
    }
    else if(messageBody.type === "response") {
      handlerMap = this.responseHandlers;
    }
    else {
      // Mensagem recebida tem um tipo incompatível.
      logger.error("Invalid message received. Type should be request|response");
      logger.info("Message will be removed.");
      // TODO: deveria eliminar a mensagem
      
      // resolve(); // não lança exception porque outras mensagens devem ser processadas.
      return new Promise((resolve, reject) => {
          reject("Incompatible message type");
      })
    }
    messageWrapper.done = createDoneMethod(this, message);
    messageWrapper.dismiss = createDismissMethod(this, message);

    // Procura o handler
    var handlerFnc = handlerMap[messageBody.service];
    if(handlerFnc == null) {
      if(messageBody.type === "request")
        // Se não tem handler registrado é porque o serviço não é suportado.
        return replyError(this, messageBody, message, "Service '" + messageBody.service + "' not supported.");
      else {
        // O serviço originalmente enviou uma mensagem errada.
        // Como no retorno da mensagem não tem muito o que fazer apenas loga
        // TODO: dá pra pensar em ter um handler genérico para erros.. avaliar no futuro
        logger.error("An invalid request was sent to " + messageBody.sentBy.application + " by this application (" + this.config.app + ")");
        logger.error("or there's no response handler for service " + messageBody.service + " (although it was able to send this message at some time).");
        return new Promise((res, rej) => {rej();})
      }
    }

    try {
      var handlerPromise = handlerFnc(messageWrapper);
      // Ops, não retornou uma promise... rejeita
      if(handlerPromise == null || handlerPromise.then == null) {
        return new Promise((res, rej) => {
          logger.warn("Handler should be a Promise returning message.<action>(...)");
          // Since it's not a promise, the handlerPromise is, actually, the result, so return it
          res(handlerPromise);
        })
      }
      return handlerPromise;
    } catch(err) {
      return new Promise((res, rej) => {
        logger.error("** Handler has thrown an exception:", err);
        // Since it's not a promise, the handlerPromise is, actually, the result, so return it
        rej(handlerPromise);
      })
    }
  }

  readMessages(params) {
    return this.transporter.readMessages(params, this.processMessage.bind(this))
  }

  close() {
    if(this.transporter) this.transporter.close()
  }
}

function createReplyMethod(apiRef, messageBody, originalMessage) {
  return function(answer) {
    return apiRef.sendAsyncResponse(messageBody, answer)
      .then(_ => apiRef.transporter.deleteMessage(originalMessage))
  }
}

function createReplyErrorMethod(apiRef, messageBody, originalMessage) {
  return function(errorMessage) {
    return replyError(apiRef, messageBody, originalMessage, errorMessage);
  }
}

function createForwardMethod(apiRef, messageBody, originalMessage) {
  return function(destination) {
    return apiRef.sendAsyncForward(messageBody, destination)
      .then(_ => apiRef.transporter.deleteMessage(originalMessage))
  }
}

function replyError(apiRef, messageBody, originalMessage, errorInfo) {
  return apiRef.sendAsyncReplyError(messageBody, errorInfo)
    .then(apiRef.transporter.deleteMessage(originalMessage))
}

function createDoneMethod(apiRef, originalMessage) {
  return function() {
    return apiRef.transporter.deleteMessage(originalMessage)
  }
}

function createDismissMethod(apiRef, originalMessage) {
  return function() {
    return apiRef.transporter.keepMessage(originalMessage)
  }
}

module.exports = PoloMessaging;