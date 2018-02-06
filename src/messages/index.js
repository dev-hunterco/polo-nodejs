const logger = require('winston')
const AWS = require('aws-sdk')
const clone = require('clone')
const os = require('os')

var HunterMessaging = class HunterMessaging {
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
            logger.info(process.env);
            logger.info(this.config.aws.sqs);
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

    sendRequest(destApp, service, body, payload) {
        // Cria um chain de promises para processar a mensagem
        var self = this;

        // Determina a fila
        return new Promise((resolve, reject) => {
            var destQueue = this.cachedURLs[destApp];
            if(destQueue == null) {
                var targetQueue = destApp + "_" + this.config.stage; // sempre usa o mesmo stage do app
                resolve(findQueue(this.awsAPIs.sqs, targetQueue));
            }
            else resolve(new Promise((rs, rj) => rs(destQueue)));
        })
        .then(destQueue => { 
            if(destQueue == null)
                throw new Error("No queue found for app: " + destApp);
            else {
                var data = {
                    type: "request",
                    sentBy: {
                        application: self.config.app,
                        instance: self.config.worker,
                        callback: self.queueURL,
                    },
                    service: service,
                    body: body,
                    payload: payload,
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
            logger.error("No handler found for service " + messageBody.service);
            logger.error("Message will be kept in queue");
            return new Promise((resolve, reject) => {
                resolve();
            })
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
            type: "response",
            sentBy: {
                application: apiRef.config.app,
                instance: apiRef.config.worker,
            },
            service: messageBody.service,
            body: answer,
            payload: messageBody.payload,
            originalMessage: messageBody
        }
        if(replyMsg.payload == null || replyMsg.payload === "") delete replyMsg.payload;

        return sendToQueue(apiRef.awsAPIs.sqs, messageBody.sentBy.callback, replyMsg)
                .then(removeFromQueue(apiRef.awsAPIs.sqs, apiRef.queueURL, receipt))
    }
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


///--------------------------------- pra baixo deve ser tudo eliminado

// function configAWS(self){
//     return new Promise((resolve,reject)=>{
//         try {
//             self._logger.debug.log('Initializing aws')
        
//             self.AWS = require('aws-sdk');
//             // self.AWS.config.loadFromPath(self.configuration.aws);
//             self.AWS.config = new self.AWS.Config(self.configuration.aws.api);
//             initializeAWSServices(self).then(resolve).catch(reject)
//         } catch (error) {
//             reject(error)
//         }
        
//     })
// }


// function initializeAWSServices(self){
//     return new Promise(function(resolve,reject){
//         self.aws = {
//             sqs:{
//                 api:null,
//                 urls:[],
//                 queue:{}
//             },
//             sns:{
//                 api:null
//             }
//         }

//         initializeSQS(self)
//             .then(initializeSNS)
//             .then(resolve)
//             .catch(reject);
//     })
// }

// function initializeSNS(self){
//     return new Promise(function(resolve,reject){
//         try {
//             if( self.configuration.aws &&
//                 self.configuration.aws.sns && 
//                 self.configuration.aws.sns.endpoint ){
//                     self._logger.debug.log('Inititalizing sns with custom configuration');
//                     self.aws.sns.api = new self.AWS.SNS(self.configuration.aws.sns);
//             }else{
//                 self._logger.debug.log('Inititalizing sns with default configuration');
//                 self.aws.sns.api = new self.AWS.SNS({ apiVersion: '2010-03-31' });
//             }
//             resolve(self)
//         } catch (error) {
//             reject(error)
//         }
//     })
    
// }



// // function getSQSarns(self){
// //     return new Promise(function(resolve,reject){
// //         try {
// //             self._logger.debug.log('Initializing Queues')
// //             var params = {
// //                 QueueNamePrefix: self.service.name
// //             };
// //             self.aws.sqs.api.listQueues(params, function(err, data) {
// //                 if (err) {
// //                     reject(err)
// //                 } else {
// //                     if(!data.QueueUrls) {
// //                         if(self.configuration.aws.sqs.create){
// //                             createQueues(self)
// //                                 .then(resolve)
// //                                 .catch(reject);
// //                         }else{
// //                             reject(self._errors.AppNotRegistered())
// //                         }
// //                     }else{
// //                         furls = data.QueueUrls.filter(url=>url.indexOf(self.service.name)>=0)
// //                         if(furls.length==0){
// //                             if(!self.configuration.aws.sqs.create){
// //                                 reject(self._errors.AppNotRegistered());
// //                             }else{
// //                                 createQueues(self).then(resolve).catch(reject);
// //                             }
// //                         }
// //                         else if(furls.length!=2){
// //                             self._logger.debug.log(furls)
// //                             if(!self.configuration.aws.sqs.create){
// //                                 reject(self._errors.WrongAppId())
// //                             }else{ 
// //                                 Promise.all(furls.map(url => deleteQueue(self,url)))
// //                                     .then(createQueues)
// //                                     .then(resolve)
// //                                     .catch(reject)
    
// //                             }
// //                         }
// //                     }       
// //                 }
// //             });
// //         } catch (error) {
// //             reject(error)
// //         }
// //     })
// // }

// function createQueuesIfDontExist(self){
//     self._logger.debug.log('Creating queues for this app if not exists.')
//     return new Promise((resolve,reject)=>{
//         if(self.configuration.aws.sqs.create){
//             Promise.all(
//                 [
//                     self.configuration.app + "_" + self.configuration.stage
//                 ]
//                 .filter(function(url){
//                     if(self.aws.sqs.urls) 
//                         return self.aws.sqs.urls.filter(surl=>{
//                             return new RegExp(url).test(surl)
//                         }).length==0;
//                     else true;
//                 })
//                 .map(function(name){
//                     return createQueue(self,name);
//                 })).then(_=>resolve(self)).catch(reject)
//         }else{
//             if(self.aws.sqs.urls
//                 .filter(url=>
//                     new RegExp(`${self.configuration.app}_${self.configuration.stage}`).test(url))
//                 .length==1){
//                 resolve(self);
//             }else{
//                 reject(self._errors.AppNotRegistered());
//             }

//         }
//     })
                
// }




// function getRegisteredSQSAttibutes(self){
//     return new Promise(function(resolve,reject){
//         try {
//             self._logger.debug.log('Getting all queues attributes')
//             Promise.all(self.aws.sqs.urls.map(url => getQueueAttributes(self,url)))
//                 .then(_=>resolve(self)).catch(reject);
//         } catch (error) {
//             reject(error)
//         }
        
//     })
// }


// function readMessages(){
//     var self = this;
//     return new Promise(function(resolve,reject){
//         self._logger.debug.log('Read Messages')
//         Promise.all(self.aws.sqs.urls.filter(
//                 url=>new RegExp(`${self.configuration.app}_${self.configuration.stage}`).test(url)
//             ).map(url=>{
//                 return consumeSQS(self,url)
//             })).then(_=>{
//                 resolve(self)
//             }).catch(reject);
//         })

            
// }


// function consumeSQS(self,url) {
//     return new Promise(function(resolve,reject){
//         self._logger.debug.log('Consume queue: '+url)
        
//         params = Object.assign({QueueUrl:url}, self.configuration.aws.sqs.consume);
//         self.aws.sqs.api.receiveMessage(params, function(err, data) {
//             if (err) {
//                 self._logger.err.log(err);
//             } else {
//                 if (data.Messages && data.Messages.length > 0) {
//                     self._logger.debug.log(`Received ${data.Messages.length} message(s) from queue ${url}.`);
//                     Promise.all(data.Messages.map(m => {
//                         m.data = JSON.parse(m.Body);
//                         var handlerFnc = (m.data.type === 'request')?handleRequest:handleResponse;
//                         if(/request|response/i.test(m.data.type)){
//                             return new Promise(function(resolve,reject){
//                                 handlerFnc(self,m).then(message=>{
//                                     /**
//                                      * Caso handlerFnc retorne uma mensagem enviar a mensagem processada.
//                                      * Caso contrário ele só deleta a mensagem processada.
//                                      */
//                                     if(message){ 
//                                         sendResponse(self,message).then(p =>{
//                                             deleteMessage(self,url,message).then(resolve).catch(reject)    
//                                         }).catch(reject);
//                                     }else{
//                                         deleteMessage(self,url,m).then(resolve).catch(reject)        
//                                     }
//                                 }).catch(err=>{
//                                     self._logger.error.log("Process handler function error: ",err)
                                    
//                                     // setMessageTimeout(self,message,0).then(p =>{resolve(message);rresolve(); }).catch(p=>{reject(p);rreject(p)});

//                                     resolve()
//                                 });
//                             }) 
//                         }else{
//                             self._logger.err.log(new Error(`UnknownDataType: message data.type should be "request" or "response", received: ${data.type}`));
//                             return false;
//                         }
//                     })).then(_=>resolve(self)).catch(reject);
                    
//                 }else{
//                     self._logger.debug.log(`No message received from queue ${url}.`);
//                     resolve(self)
//                 }

//             }
//         })
//     })
// }

// function deleteMessage(self,queue,message){

//     return new Promise(function(resolve,reject){
//         self._logger.debug.log(`Deleting message: ${message.ReceipHandle}`)
//         self.aws.sqs.api.deleteMessage({
//             QueueUrl:queue , 
//             ReceiptHandle:message.ReceiptHandle }, function(err, data) {
//                 if (err) reject(err);
//                 else { 
//                     self._logger.info.log(`Message deleted: ${JSON.stringify(message,undefined,3)}`)
//                     resolve()
//                 }
//         });
//     })
// }

// function handleResponse(self,message){
//     return new Promise(function(resolve,reject){
//         try {
//             self._logger.debug.log(`Response => ${message.data.service}`);
//             self._handler.response[message.data.service](message)
//             resolve()
//         } catch (error) {
//             console.error(error);
//             resolve()
//         }
//     })
// }

// function handleRequest(self,message){
//     return new Promise(function(resolve,reject){
//         var timeOut = setTimeout(() => {
//             if(!message._data){ reject(new Error(`HandlerTimeOutError: Handler method does not resolve provided message with message.reply or message.replyError. Trigger timeout after ${self.configuration.aws.sqs.consume.VisibilityTimeout} seconds.`)); }
//         }, self.configuration.aws.sqs.consume.VisibilityTimeout*1000);

//         message.reply = function(data){ //trocar para replyDone
//             clearTimeout(timeOut)
//             message._data = data;
//             resolve(message)
//         }

//         message.replyError = function(err){//trocar para replyError
//             clearTimeout(timeOut)
//             message._data = {error:{message:err.message}};
//             resolve(message)
//         }

        

//         self._logger.debug.log(`Request => ${message.data.service}`);
//         try {
//             self._handler.request[message.data.service](message);        
//         } catch (error) {
//             if(/.*is not a function$/.test(error.message)) { 
//                 message.replyError(new Error('UnknowMethodError: Service does not have required \'unknown\' service.')).then(resolve).catch(reject);
//             }else reject(error);
//         }

//     })
// }
// function removeListeners(event){
//     if(this._handler.request)  delete this._handler.request[event];
//     if(this._handler.response) delete this._handler.response[event];
// } 


// function setMessageTimeout(self,queue,message,time){
//     return new Promise(function(resolve,reject){

//         var params = {
//             QueueUrl: queue, /* required */
//             ReceiptHandle: message.ReceipHandle, /* required */
//             VisibilityTimeout: 0 /* required */
//           };
//         self.aws.sqs.api.changeMessageVisibility(params, function(err, data) {
//             if (err) console.log(err, err.stack); // an error occurred
//             else     console.log(data);           // successful response
//         });
//     })
// }

// function sendResponse(self,message){
//     return new Promise(function(resolve,reject){
//         try{
//             self._logger.info.log('Sending response to '+message.data.callback)
//             var response_service = message.data.callback
            
//             if(!response_service) reject(new Error('Can\'t Respond Message: Provided message does not have response service'))
//             if(!message._data) reject(new Error('UnprocessedMessageError: Make shure that message was resolved'))
//             var data = {
//                 response:message._data,
//                 payload:message.data.payload,
//                 service:message.data.service,
//                 type:"response"
//             }
            
//             var send_params = {
//                 MessageBody: JSON.stringify(data) /* required */ ,
//                 QueueUrl: response_service /* required */ ,
//                 DelaySeconds: 0
//             };
    
//             self.aws.sqs.api.sendMessage(send_params, function(err, data) {
//                 if (err) {
//                     reject(err)
//                 } else {
//                     self._logger.debug.log('Response sent')        
//                     resolve(message)   
//                 }
//             });

//         }catch(err){
//             reject(err)
//         }
//     })
// };

// function sendRequest(to,service,body,payload){
//     var self = this;
//     return new Promise(function(resolve,reject){
//         if(self.aws.sqs.api){
//             updateQueuesUrlsFromServer(self)
//                 .then(getRegisteredSQSAttibutes)
//                 .then(function(){
//                     try {   
//                         var request_service = self.aws.sqs.urls.filter(url=>new RegExp(`${to}_${self.configuration.stage}`).test(url))[0]
//                         var response_service = self.aws.sqs.urls.filter(url=>new RegExp(`${self.configuration.app}_${self.configuration.stage}$`).test(url))[0]
//                         if(!request_service) throw self._errors.ServiceNotFound() //new Error('ServiceNotFoundError: Sending Request to an Inexistent app')
//                         self._logger.info.log(`to: ${to}, service: ${service}, payload: ${payload}, url:${request_service}`)
//                         // var attrs = []; for( att in self.aws.sqs.queue[request_service]){attrs.push(att)}
//                         // self.aws.sqs.queue
//                         var data = {
//                             body:body,
//                             service:service,
//                             callback:response_service,
//                             payload:payload,
//                             type:"request"
//                         }

//                         if((payload && payload==="") || (payload && payload == null)) delete data.payload;                      
//                         var send_params = {
//                             MessageBody: JSON.stringify(data) /* required */ ,
//                             QueueUrl: request_service /* required */ ,
//                             DelaySeconds: 0
//                         };
//                         self.aws.sqs.api.sendMessage(send_params, function(err, data) {
//                             if (err) {
//                                 reject(err)
//                             } else {
//                                 self._logger.debug.log('message sent')
//                                 resolve(data)   
//                             }
//                         });
//                     } catch (error) {
//                         reject(error)
//                     }
//                 }).catch(reject)
            
//         }else{
//             reject(self._errors.sqsNotInitialized())
//         }
        
        

//     })
// };

// function onRequest(event,callback){
//     if(typeof event === 'string' && typeof callback === 'function'){
//         if(!this._handler) this._handler = {}
//         if(!this._handler.request) this._handler.request = {};
        
//         this._handler.request[event] = callback;
//         this._logger.debug.log(`registered onRequest callback on: ${event}.`)        
//     }else{
//         throw new Error('WrongParameterType: onEventRegister must receive event:string and callback:function respectively.')
//     }
// }

// function onResponse(event,callback){
//     if(typeof event === 'string' && typeof callback === 'function'){
//         if(!this._handler) this._handler = {}
//         if(!this._handler.response) this._handler.response = {};
        
//         this._handler.response[event] = callback;
//         this._logger.debug.log(`registered onResponse callback on: ${event}.`)              
//     }else{
//         throw new Error('IncorectParameters: Parameters must be event:string and callback:function.') 
//     }        
// }

// function getQueueAttributes(self,url){
//     return new Promise(function(resolve,reject){
//         self._logger.debug.log(`getting attributes for ${url}`)
//         var params = {
//                 QueueUrl: url,
//                 AttributeNames: [ "All" ]
//             };
//             self.aws.sqs.api.getQueueAttributes(params, function(err, data) {
//                 if (err) reject(err) 
//                 else{
//                     try {
//                         self._logger.debug.log(`got attributes for: ${url}`)
//                         self.aws.sqs.queue[url] = data.Attributes;
//                         resolve(self)
//                     } catch (error) {
//                         reject(error)
//                     }
//                 }  
                
//         });
//     })
// }


module.exports = HunterMessaging;