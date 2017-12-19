
var Promise = require('promise')

module.exports = class API{
    constructor(config){
        var self = this;
        this.initialize = function(){ 
            return new Promise((resolve,reject)=>{
                try {                    
                    initLogger(self)
                        .then(configureErrors)
                        .then(setUpAPI)
                        .then(configAWS)
                        .then(resolve)
                        .catch(reject)
                    
                } catch (error) {
                    reject(error)
                }
            })
        }
        if(typeof config === 'string'){
            require('colors')
            // console.log(`Configuring using path string`)
            this.configuration = Object.assign({},require(config));
        }else if(typeof config === 'object'){
            this.configuration = config;
        }else if(config || config==null){
            throw new Error('ConfigurationError: Could not handle configuration')
        }

        
        
        
        
        
    }
}
function initLogger(self){
    return new Promise(function(resolve,reject){
        try {
            require('colors')
            if(self.configuration.log && self.configuration.log.debug){ console.log('Initializing logger'.gray)}
            class Logger{
                constructor(tag,color,active){
                    this.tag = tag;
                    this.color = color;
                    this.active = active;
                    this.log = function(message){
                        if(this.active){
                            var dt = new Date();
                            var D = dt.getDate(),
                                M = dt.getMonth(),
                                Y = dt.getFullYear(),
                                h = dt.getHours(),
                                m = dt.getMinutes(),
                                s = dt.getSeconds(),
                                ms = dt.getMilliseconds();
                            console.log(`[${D}/${M}/${Y} - ${h}:${m}:${s}:${ms}][${this.tag}][${self.configuration.worker}] ${message}`[this.color])
                        }
                    }
                }
            }

            var logger = {}
            logger.debug =  new Logger('debug','magenta'  , self.configuration.log && (typeof self.configuration.log.debug !== 'undefined')? self.configuration.log.debug :false);
            logger.info  =  new Logger('info','green'     , self.configuration.log && (typeof self.configuration.log.info  !== 'undefined')? self.configuration.log.info  :true);
            logger.warn  =  new Logger('warn','orange'    , self.configuration.log && (typeof self.configuration.log.warn  !== 'undefined')? self.configuration.log.warn  :true);
            logger.err   =  new Logger('error','red'      , self.configuration.log && (typeof self.configuration.log.err   !== 'undefined')? self.configuration.log.err   :true);
            logger.err.log = function(error){
                if(this.active){
                    var dt = new Date();
                    var D = dt.getDate(),
                        M = dt.getMonth(),
                        Y = dt.getFullYear(),
                        h = dt.getHours(),
                        m = dt.getMinutes(),
                        s = dt.getSeconds(),
                        ms = dt.getMilliseconds();
                    console.log(`[${D}/${M}/${Y} - ${h}:${m}:${s}:${ms}][${this.tag}][${self.configuration.worker}] ${error.message} ${error.stack}`[this.color])
                }
                
            }
            self._logger = logger;
            resolve(self);
        } catch (error) {
            reject(error)
        }
    })
}


function setUpAPI(self){
    return new Promise(function(resolve,reject){
        try {
            self._logger.debug.log('Initializing API')
            // self.service = {}
            self.startup = new Date();
            // self.service.name = self.configuration.app;
            if(!self.configuration.worker) {
                reject(self._errors.AppWithoutId())
            }else{
                self.onRequest = onRequest;
                self.onResponse = onResponse;
                self.readMessages = readMessages;
                self.removeListeners = removeListeners;
                self.sendRequest = sendRequest
                resolve(self)            
            }
            
        } catch (error) {
            reject(error)
        }
    })
}

function configureErrors(self){
    return new Promise(function(resolve,reject){
        try {
            self._logger.debug.log('Initializing errors')
            self._errors = {};
            self._errors.AppNotRegistered = _=> new Error('AppNotRegisteredError: App must be registered with an valid identifier.')
            self._errors.sqsNotInitialized = _=> new Error('SqsNotInitializedError: call \'api.initialize()\' first.')
            self._errors.WrongAppId = _=> new Error('WrongAppIdError: Incorrect number of queues, App identification is not valid for this API.')
            self._errors.AppWithoutId = _=> new Error('AppWithoutIdError: App must be registered with an identifier.')
            self._errors.ServiceNotFound = _=> new Error('ServiceNotFoundError: Sending Request to an Inexistent app')
            resolve(self)            
        } catch (error) {
            reject(error)
        }
    })
}

function configAWS(self){
    return new Promise((resolve,reject)=>{
        try {
            self._logger.debug.log('Initializing aws')
        
            self.AWS = require('aws-sdk');
            // self.AWS.config.loadFromPath(self.configuration.aws);
            self.AWS.config = new self.AWS.Config(self.configuration.aws.api);
            initializeAWSServices(self).then(resolve).catch(reject)
        } catch (error) {
            reject(error)
        }
        
    })
}


function initializeAWSServices(self){
    return new Promise(function(resolve,reject){
        self.aws = {
            sqs:{
                api:null,
                urls:[],
                queue:{}
            },
            sns:{
                api:null
            }
        }

        initializeSQS(self)
            .then(initializeSNS)
            .then(resolve)
            .catch(reject);
    })
}

function initializeSNS(self){
    return new Promise(function(resolve,reject){
        try {
            if( self.configuration.aws &&
                self.configuration.aws.sns && 
                self.configuration.aws.sns.endpoint ){
                    self._logger.debug.log('Inititalizing sns with custom configuration');
                    self.aws.sns.api = new self.AWS.SNS(self.configuration.aws.sns);
            }else{
                self._logger.debug.log('Inititalizing sns with default configuration');
                self.aws.sns.api = new self.AWS.SNS({ apiVersion: '2010-03-31' });
            }
            resolve(self)
        } catch (error) {
            reject(error)
        }
    })
    
}

function initializeSQS(self){
    return new Promise(function(resolve,reject){
        try {
            if(self.configuration.aws &&
                self.configuration.aws.sqs ){
                    self._logger.debug.log('Initializing sqs using custom configuration')
                    self.aws.sqs.api = new self.AWS.SQS(self.configuration.aws.sqs);
                    
            }else{
                self._logger.debug.log('Initializing sqs using default configuration')
                self.aws.sqs.api = new self.AWS.SQS({ apiVersion: '2012-11-05' });
            }
            updateQueuesUrlsFromServer(self)
                .then(createQueuesIfDontExist)
                .then(getRegisteredSQSAttibutes)
                .then(resolve)
                .catch(reject)            
        } catch (error) {
            reject(error)
        }
        

    })
    
}

function updateQueuesUrlsFromServer(self){
    return new Promise(function(resolve,reject){
        self._logger.debug.log('Initializing Queues')
        
        self.aws.sqs.api.listQueues({}, function(err, data) {
            if(err) reject(err);
            else {
                
                if(data.QueueUrls){
                    self.aws.sqs.urls = data.QueueUrls;
                    self._logger.debug.log(`Listing service URLs`)
                    self.aws.sqs.urls.forEach(url => {
                        self._logger.debug.log(`url: ${url};`)
                    });
                }
                resolve(self)
            }
        })
    })
}

function getSQSarns(self){
    return new Promise(function(resolve,reject){
        try {
            self._logger.debug.log('Initializing Queues')
            var params = {
                QueueNamePrefix: self.service.name
            };
            self.aws.sqs.api.listQueues(params, function(err, data) {
                if (err) {
                    reject(err)
                } else {
                    if(!data.QueueUrls) {
                        if(self.configuration.aws.sqs.create){
                            createQueues(self)
                                .then(resolve)
                                .catch(reject);
                        }else{
                            reject(self._errors.AppNotRegistered())
                        }
                    }else{
                        furls = data.QueueUrls.filter(url=>url.indexOf(self.service.name)>=0)
                        if(furls.length==0){
                            if(!self.configuration.aws.sqs.create){
                                reject(self._errors.AppNotRegistered());
                            }else{
                                createQueues(self).then(resolve).catch(reject);
                            }
                        }
                        else if(furls.length!=2){
                            self._logger.debug.log(furls)
                            if(!self.configuration.aws.sqs.create){
                                reject(self._errors.WrongAppId())
                            }else{ 
                                Promise.all(furls.map(url => deleteQueue(self,url)))
                                    .then(createQueues)
                                    .then(resolve)
                                    .catch(reject)
    
                            }
                        }
                    }       
                }
            });
        } catch (error) {
            reject(error)
        }
    })
}

function createQueuesIfDontExist(self){
    self._logger.debug.log('Creating queues for this app if not exists.')
    return new Promise((resolve,reject)=>{
        if(self.configuration.aws.sqs.create){
            Promise.all(
                [
                    self.configuration.app+'_request'
                    ,self.configuration.app+'_response'
                ]
                .filter(function(url){
                    if(self.aws.sqs.urls) return self.aws.sqs.urls.filter(surl=>url===surl).length==0;
                    else false;
                })
                .map(function(name){
                    return createQueue(self,name);
                })).then(_=>resolve(self)).catch(reject)
        }else{
            if(self.aws.sqs.urls
                .filter(url=>
                    new RegExp(`^${self.configuration.app}_(request|response)`).test(url))
                .length==2){
                resolve(self);
            }else{
                reject(self._errors.AppNotRegistered());
            }

        }
    })
                
}

function createQueue(self,name){
    return new Promise(function(resolve,reject){
        try {
            self._logger.debug.log(`Creating queue: ${name}`)
            var params = {
                QueueName: name, /* required */                            
            };
            self.aws.sqs.api.createQueue(params, function(err, data) {
                if (err) reject(err); 
                else {
                    self._logger.debug.log(`Queue created: ${JSON.stringify(data.QueueUrl)}`)
                    self.aws.sqs.urls.push(data.QueueUrl)
                    resolve(self)
                }           
            });
        } catch (error) {
            reject(error)
        }
    })
}



function getRegisteredSQSAttibutes(self){
    return new Promise(function(resolve,reject){
        try {
            self._logger.debug.log('Getting all queues attributes')
            Promise.all(self.aws.sqs.urls.map(url => getQueueAttributes(self,url)))
                .then(_=>resolve(self)).catch(reject);
        } catch (error) {
            reject(error)
        }
        
    })
}


function readMessages(){
    var self = this;
    return new Promise(function(resolve,reject){
        self._logger.debug.log('Read Messages')
        Promise.all(self.aws.sqs.urls.filter(
            url=>new RegExp(self.configuration.app).test(url))
            .map(url=>consumeSQS(self,url))).then(_=>resolve(self)).catch(reject);
        })

            
}


function consumeSQS(self,url) {
    return new Promise(function(resolve,reject){
        self._logger.debug.log('Consume queue: '+url)
        
        params = Object.assign({QueueUrl:url}, self.configuration.aws.sqs.consume);
        self.aws.sqs.api.receiveMessage(params, function(err, data) {
            if (err) {
                self._logger.err.log(err);
            } else {
                if (data.Messages && data.Messages.length > 0) {
                    self._logger.info.log(`Received ${data.Messages.length} message(s) from queue ${url}.`);
                    Promise.all(data.Messages.map(m => {
                        m.data = JSON.parse(m.Body);
                        if(/_request$/i.test(url)){
                            return handleRequest(self,m).then(message=>deleteMessage(url,message));
                        } else if(/_response$/i.test(url)){
                            return handleResponse(self,m).then(message=>deleteMessage(url,message));
                        } else {
                            self._logger.err.log(new Error('UnknownUrl: urls can\'t ben set manually'));
                            return false;
                        }
                    })).then(_=>resolve(self)).catch(reject);
                    
                }else{
                    self._logger.debug.log(`No message received from queue ${url}.`);
                    resolve(self)
                }

            }
        })
    })
}

function deleteMessage(queue,message){
    return new Promise(function(resolve,reject){
        var entries = data.Messages.map(m => { return { Id: m.MessageId, ReceiptHandle: m.ReceiptHandle } })
        self.aws.sqs.api.deleteMessage({
            QueueUrl:queue , 
            ReceiptHandle:message.ReceiptHandle }, function(err, data) {
                if (err) reject(err);
                else { 
                    self._logger.info.log(`Message deleted: ${JSON.stringify(message,undefined,3)}`)
                    resolve()
                }
        });
    })
}

function handleResponse(self,message){
    return new Promise(function(resolve,reject){
        try {
            self._logger.debug.log(`Response => ${message.data.service}`);
            self._handler.response[message.data.service](message,resolve,reject)
            resolve(self)
        } catch (error) {
            reject(error)
        }
    })
}

function handleRequest(self,message){
    return new Promise(function(resolve,reject){
        message.repply = function(data){

            return sendResponse(self,this,data).then(resolve).catch(reject);
        }
        message.sendError = function(err){
            return sendResponse(self,this,{error:{message:err.message}}).then(resolve).catch(reject);
        }
        self._logger.debug.log(`Request => ${message.data.service}`);
        try {
            self._handler.request[message.data.service](message);        
        } catch (error) {
            if(/.*is not a function$/.test(error.message)) { message.sendError(new Error('UnknowMethodError: Service does not have required \'unknown\' service.')).then(resolve).catch(reject);}
            else reject(error);
        }
        resolve(self)
    })
}
function removeListeners(event){
    if(this._handler.request)  delete this._handler.request[event];
    if(this._handler.response) delete this._handler.response[event];
} 


function sendResponse(self,message,response){
    return new Promise(function(resolve,reject){
        self._logger.info.log('Sending response to '+message.data.callback)
        var response_service = message.data.callback
        if(!response_service) reject(new Error('Can\'t Respond Message: Provided message does not have response service'))
        var data = {
            response:response,
            payload:message.data.payload,
            service:message.data.service
        }
        
        var send_params = {
            MessageBody: JSON.stringify(data) /* required */ ,
            QueueUrl: response_service /* required */ ,
            DelaySeconds: 0
        };

        self.aws.sqs.api.sendMessage(send_params, function(err, data) {
            if (err) {
                reject(err)
            } else {
                self._logger.debug.log('Response sent')        
                resolve(message)   
            }
        });
    })
};

function sendRequest(to,service,body,payload){
    var self = this;
    return new Promise(function(resolve,reject){
        if(self.aws.sqs.api){
            updateQueuesUrlsFromServer(self)
                .then(getRegisteredSQSAttibutes)
                .then(function(){
                    try {   
                        var request_service = self.aws.sqs.urls.filter(url=>new RegExp(`${to}_request$`).test(url))[0]
                        var response_service = self.aws.sqs.urls.filter(url=>new RegExp(`${self.configuration.app}_response$`).test(url))[0]
                        if(!request_service) throw self._errors.ServiceNotFound() //new Error('ServiceNotFoundError: Sending Request to an Inexistent app')
                        self._logger.info.log(`to: ${to}, service: ${service}, payload: ${payload}, url:${request_service}`)
                        // var attrs = []; for( att in self.aws.sqs.queue[request_service]){attrs.push(att)}
                        // self.aws.sqs.queue
                        var data = {
                            body:body,
                            service:service,
                            callback:response_service,
                            payload:payload
                        }
                        if((payload && payload==="") || (payload && payload == null)) delete data.payload;
                        var send_params = {
                            MessageBody: JSON.stringify(data) /* required */ ,
                            QueueUrl: request_service /* required */ ,
                            DelaySeconds: 0
                        };
                        self.aws.sqs.api.sendMessage(send_params, function(err, data) {
                            if (err) {
                                reject(err)
                            } else {
                                self._logger.debug.log('message sent')
                                resolve(data)   
                            }
                        });
                    } catch (error) {
                        reject(error)
                    }
                }).catch(reject)
            
        }else{
            reject(self._errors.sqsNotInitialized())
        }
        
        

    })
};

function onRequest(event,callback){
    if(typeof event === 'string' && typeof callback === 'function'){
        if(!this._handler) this._handler = {}
        if(!this._handler.request) this._handler.request = {};
        
        this._handler.request[event] = callback;
        this._logger.debug.log(`registered onRequest callback on: ${event}.`)        
    }else{
        throw new Error('WrongParameterType: onEventRegister must receive event:string and callback:function respectively.')
    }
}

function onResponse(event,callback){
    if(typeof event === 'string' && typeof callback === 'function'){
        if(!this._handler) this._handler = {}
        if(!this._handler.response) this._handler.response = {};
        
        this._handler.response[event] = callback;
        this._logger.debug.log(`registered onResponse callback on: ${event}.`)              
    }else{
        throw new Error('IncorectParameters: Parameters must be event:string and callback:function.') 
    }        
}

function getQueueAttributes(self,url){
    return new Promise(function(resolve,reject){
        self._logger.debug.log(`getting attributes for ${url}`)
        var params = {
                QueueUrl: url,
                AttributeNames: [ "All" ]
            };
            self.aws.sqs.api.getQueueAttributes(params, function(err, data) {
                if (err) reject(err) 
                else{
                    try {
                        self._logger.debug.log(`got attributes for: ${url}`)
                        self.aws.sqs.queue[url] = data.Attributes;
                        resolve(self)
                    } catch (error) {
                        reject(error)
                    }
                }  
                
        });
    })
}


