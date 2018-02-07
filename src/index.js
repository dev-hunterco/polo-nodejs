const logger = require('winston')
const AWS = require('aws-sdk')
const clone = require('clone')
const os = require('os')
const UUID = require('uuid')

var PoloMessaging = class PoloMessaging {
    constructor(config) {
        this.checkConfiguration(config);
        this.awsAPIs = {}

        this.cachedURLs = {}

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
        this.config = config;
        if(this.config.aws != null && this.config.aws.api != null) {
            AWS.config.update(this.config.aws.api)
        }
    }

    initializeSQS() {
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
        return new Promise(function(resolve,reject){
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
                    logger.info("Creating queue...");
                    var params = {
                        QueueName: self.queueName
                    };
                    self.awsAPIs.sqs.createQueue(params, function(err, data) {
                        if (err) reject(err); 
                        else {
                            logger.info(`Queue created: ${JSON.stringify(data.QueueUrl)}`)
                            self.queueURL = data.QueueUrl;
                            resolve()
                        }           
                    });
                }
                else {
                    logger.error("Queue not found...");
                    reject("Queue " + self.queueName + " not found...");
                }
            })
        })
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

        // Cria um chain de promises para processar a mensagem
        var self = this;
        var promise = null;
        var destQueue = this.cachedURLs[destApp];
        if(destQueue == null) {
            var targetQueue = destApp + "_" + this.config.stage; // sempre usa o mesmo stage do app
            promise = findQueue(this.awsAPIs.sqs, targetQueue)
                        .then(queue => {
                            return queue
                        })
                        .catch(_ => {
                            return null;
                        })
        }
        else 
            promise = new Promise((rs, rj) => rs(destQueue));

        return promise
            .then(destQueue => { 
                if(destQueue == null) {
                    throw new Error("No queue found for app: " + destApp);
                }
                else {
                    var data = {
                        id: UUID(),
                        conversation: conversationId,
                        type: "request",
                        sentBy: {
                            application: self.config.app,
                            instance: self.config.worker,
                            callback: self.queueURL,
                        },
                        service: service,
                        body: body,
                        payload: payload,
                        timestamp: new Date()
                    }
                
                    // Retira o payload caso não tenha conteúdo algum
                    if((payload && payload==="") || (payload && payload == null)) delete data.payload;

                    return sendToQueue(self.awsAPIs.sqs, destQueue, data);
                    // resolve(sendToQueue(self.awsAPIs.sqs, destQueue, data));
                }
            });
    }

    processMessage(message) {
        var messageBody = JSON.parse(message.Body);
        var handlerMap = null;

        var messageWrapper = clone(messageBody);
        messageWrapper._apiRef = this;

        // Identifica o mapa de handler que será utilizado e atualiza os métodos injetados
        // de acordo com o tipo de mensagem
        if(messageBody.type === "request") {
            handlerMap = this.requestHandlers;
            messageWrapper.reply = createReplyMethod(this, messageBody, message.ReceiptHandle);
        }
        else if(messageBody.type === "response") {
            handlerMap = this.responseHandlers;
            messageWrapper.done = createDoneMethod(this, message.ReceiptHandle);
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
        messageWrapper.dismiss = createDismissMethod(this, message.ReceiptHandle);

        // Procura o handler
        var handlerFnc = handlerMap[messageBody.service];
        if(handlerFnc == null) {
            if(messageBody.type === "request")
                // Se não tem handler registrado é porque o serviço não é suportado.
                return replyError(this, messageBody, message.ReceiptHandle, "Service '" + messageBody.service + "' not supported.");
            else {
                // O serviço originalmente enviou uma mensagem errada.
                // Como no retorno da mensagem não tem muito o que fazer apenas loga
                // TODO: dá pra pensar em ter um handler genérico para erros.. avaliar no futuro
                logger.error("An invalid request was sent to " + messageBody.sentBy.application + " by this application (" + this.config.app + ")");
                logger.error("or there's no response handler for service " + messageBody.service + " (although it was able to send this message at some time).");
                return new Promise((res, rej) => {rej();})
            }
        }

        var handlerPromise = handlerFnc(messageWrapper);
        // Ops, não retornou uma promise... rejeita
        if(handlerPromise.then == null) {
            return new Promise((res, rej) => {
                rej(new Error("Handler for " + messageBody.service + " must return a promise."));
            })
        }
        return handlerPromise;
    }

    readMessages() {
        var numOfMessages = 0;
        return getMessages(this.awsAPIs.sqs, this.queueURL)
            .then(messages => {
                if(messages == null)
                    messages = [];
                numOfMessages = messages.length;
                return Promise.all(messages.map(m => this.processMessage(m)))
            })
            .then(_ => numOfMessages);
    }
}

function findQueue(sqsAPI, queueName) {
    return new Promise((resolve, reject) => {
        sqsAPI.listQueues({QueueNamePrefix: queueName}, function(err, data) {
            if(err)
                reject(err);
            else if(data.QueueUrls == null || data.QueueUrls.length == 0)
                reject("No queue found for " + queueName);
            else
                resolve(data.QueueUrls[0]);
        });
    })
}

function sendToQueue(sqsAPI, queueUrl, data) {
    var send_params = {
        MessageBody: JSON.stringify(data),
        QueueUrl: queueUrl,
        DelaySeconds: 0
    };
    return new Promise((resolve, reject) => {
        sqsAPI.sendMessage(send_params, function(err, data) {
            if (err) {
                reject(err)
            } else {
                resolve(data)
            }
        });
    });
}

function getMessages(sqsAPI, queueUrl) {
    return new Promise((resolve, reject) => {
        sqsAPI.receiveMessage({QueueUrl:queueUrl}, function(err, data) {
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

function createReplyMethod(apiRef, messageBody, receipt) {
    return function(answer) {
        var replyMsg = {
            conversation: messageBody.conversation,
            id: UUID(),
            type: "response",
            sentBy: {
                application: apiRef.config.app,
                instance: apiRef.config.worker,
            },
            service: messageBody.service,
            body: answer,
            success: true,
            payload: messageBody.payload,
            timestamp: new Date(),
            originalMessage: messageBody
        }
        if(replyMsg.payload == null || replyMsg.payload === "") delete replyMsg.payload;

        return sendToQueue(apiRef.awsAPIs.sqs, messageBody.sentBy.callback, replyMsg)
                .then(removeFromQueue(apiRef.awsAPIs.sqs, apiRef.queueURL, receipt))
    }
}

function replyError(apiRef, messageBody, receipt, errorInfo) {
    var replyMsg = {
        type: "response",
        sentBy: {
            application: apiRef.config.app,
            instance: apiRef.config.worker,
        },
        service: messageBody.service,
        body: {error: errorInfo},
        success: false,
        payload: messageBody.payload,
        originalMessage: messageBody
    }
    if(replyMsg.payload == null || replyMsg.payload === "") delete replyMsg.payload;
    return sendToQueue(apiRef.awsAPIs.sqs, messageBody.sentBy.callback, replyMsg)
            .then(removeFromQueue(apiRef.awsAPIs.sqs, apiRef.queueURL, receipt))
}

function createDoneMethod(apiRef, receipt) {
    return function() {
        return removeFromQueue(apiRef.awsAPIs.sqs, apiRef.queueURL, receipt)
    }
}

function createDismissMethod(apiRef, receipt) {
    return function() {
        return new Promise((res, rej) => {
            // Na verdade, não faz nada com a mensagem, só vai ficar "travada" até expirar o tempo de processamento..
            // Dá pra mudar o timeout pra liberar ela de imediato mas não é obrigatório
            res();
        });
    }
}

module.exports = PoloMessaging;