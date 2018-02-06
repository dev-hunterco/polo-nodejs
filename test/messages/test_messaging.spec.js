require('should')
const logger = require('winston')
const clone = require('clone');
const HunterMessaging = require('../../src/main.js').messages;
// const aws_config_file_path = './config.development.json'
const localstackUtils = require('../utils/localstack')
const path = require('path')
const sleep = require('sleep')
const DEFAULT_CONF = path.resolve(__dirname, '../hapi.test.peoplesearch.worker.json')
const LOAD_LOCALSTACK = process.env.LOAD_LOCALSTACK != "false";

describe('Messaging Tests',function() {  
    // // Localstack initialization
    before(function() {
        var newEnv = clone(process.env);
        newEnv.SERVICES = "sqs"

        this.timeout(60000); 

        if(LOAD_LOCALSTACK)
            return localstackUtils.start({env: newEnv})
                        .then(_ => new Promise((res, rej) => {
                            // Aguarda um tempo pro localstack estar *realmente* pronto (erro 502)
                            console.log("Aguardando 2s para executar os testes...");
                            setTimeout(res, 2000);
                        }));
        else
            return new Promise((res, rej) => {
                console.log("Aguardando 2s para executar os testes...");
                setTimeout(res, 2000);
            });
    });
    after(function() {
        this.timeout(60000); 

        if(LOAD_LOCALSTACK)
            return localstackUtils.stop()
        else
            return new Promise((res, rej) => res());
    });
    
    describe('Test Configurations', function() {
        it('No Configuration', function(done) {
            try {
                var messagingAPI = new HunterMessaging();
                done(new Error("Não poderia ter inicializado sem configuração"))
             } catch (error) {
                 done()
             }
        });

        it('No app name', function(done) {
            try {
                var messagingAPI = new HunterMessaging({});
                done(new Error("Não poderia ter inicializado sem config.app"))
             } catch (error) {
                 done()
             }
        });

        it('No stage defined', function(done) {
            try {
                var messagingAPI = new HunterMessaging({app:'testApp'});
                done(new Error("Não poderia ter inicializado sem config.stage"))
             } catch (error) {
                 done()
             }
        });

        it('Stage as ENV', function(done) {
            process.env.current_stage = "test";
            try {
                var messagingAPI = new HunterMessaging({app:'testApp'});
                messagingAPI.config.stage.should.be.eql(process.env.current_stage);
                done()
            } catch (error) {
                done(new Error("Não está considerando a variável de ambiente para determinar stage"))
            }
            finally {
                delete process.env.current_stage;
            }
        });

        it('Autoset worker Id', function(done) {
            try {
                var messagingAPI = new HunterMessaging({app:'testApp', stage:'test'});
                messagingAPI.config.worker.should.be.not.null()
                done()
             } catch (error) {
                 done(error);
             }
        });

        it('No AWS configuration', function(done) {
            try {
                var messagingAPI = new HunterMessaging({app:'testApp', worker:'me', stage:'test'});
                done()
            } catch (error) {
                done(new Error("Deveria inicializar com warning..."))
             }
        });

        it('conf with warnings', function(done) {
            try {
                var messagingAPI = new HunterMessaging({app:'testApp', worker:'me', stage:'test', aws:{}});
                done()
            } catch (error) {
                done(new Error("Deveria ter configurado corretamente", error))
            }
        });

        it('conf without warnings', function(done) {
             // Não testa efetivamente os warnings (só visualmente) mas poderia fazer
             // se criar um appender pro logger
            try {
                var messagingAPI = new HunterMessaging({app:'testApp', worker:'me', stage:'test', aws:{sqs:{}, sns:{}}});
                done()
            } catch (error) {
                done(new Error("Deveria ter configurado corretamente", error))
            }
        });

        it('Configuring using a file', function(done){
            var messagingAPI = new HunterMessaging(DEFAULT_CONF);
            done();
        });
    })

    describe('Initialization', function() {
        it('Initialize Queue', function(done) {
            var messagingAPI = new HunterMessaging(clone(require(DEFAULT_CONF)));
            messagingAPI.initializeSQS()
                .then(() => {
                    messagingAPI.queueName.should.be.not.null()
                    messagingAPI.queueURL.should.be.not.null()
                    done()
                })
                .catch(error => {
                    done(error)
                });
        }).timeout(20000);
    });

    describe('Send message and receive message', function(){
        const SampleApp = require('./sample_app');
        var app1 = new SampleApp("App1", clone(require(DEFAULT_CONF)));
        var app2 = new SampleApp("App2", clone(require(DEFAULT_CONF)));

        before(() => app1.initializeQueue());
        before(() => app2.initializeQueue());

        beforeEach((done) => {
            app1.reset();
            app2.reset()
            done()
        });

        // Faz o purge das filas para evitar contaminação entre os cenários
        beforeEach(function() { 
            const waitingTime = 1000;
            this.timeout(60000); 

            while(LOAD_LOCALSTACK && !localstackUtils.isRunning()) {
                logger.info("Waiting to localstack to be ready.");
                sleep.msleep(waitingTime);
            }
            return localstackUtils.purgeSQS()
        });
        
        it('Send and receive message', function(done) {
            this.timeout(30000);

            logger.debug("_______________________ App1 envia p/ App2 ________________________")
            app1.sendGreetings("App2")
                .then(reciboEnvio => {
                    app1.getRequestsReceived().length.should.be.eql(0);
                    app1.getResponsesReceived().length.should.be.eql(0);
                    app2.getRequestsReceived().length.should.be.eql(0);
                    app2.getResponsesReceived().length.should.be.eql(0);
                    return reciboEnvio;
                })
                .then(reciboEvento => {
                    logger.debug("_______________________ App2 recebe e responde _____________________")
                    return app2.receiveMessages()
                })
                .then(numOfMessages => {
                    numOfMessages.should.be.eql(1);
                    app1.getRequestsReceived().length.should.be.eql(0);
                    app1.getResponsesReceived().length.should.be.eql(0);
                    app2.getRequestsReceived().length.should.be.eql(1);
                    app2.getResponsesReceived().length.should.be.eql(0);
                    app2.getRequestsReceived()[0].body.should.be.eql("Hello, App2... I'm App1");
                    return numOfMessages;
                })
                .then(_ => {
                    logger.debug("_______________________ App1 recebe consome _____________________")
                    return app1.receiveMessages();
                })
                .then(numOfMessages => {
                    app1.getRequestsReceived().length.should.be.eql(0);
                    app1.getResponsesReceived().length.should.be.eql(1);
                    app2.getRequestsReceived().length.should.be.eql(1);
                    app2.getResponsesReceived().length.should.be.eql(0);
                    app1.getResponsesReceived()[0].body.answer.should.be.eql("Nice to meet you!")
                    return numOfMessages;
                })
                .then(numOfMessages => {
                    numOfMessages.should.be.eql(1);
                    done()
                })
                .catch(error => {
                    done(error);
                });
        })

        it('Send and dismiss message', function(done) {
            this.timeout(30000);

            logger.debug("_______________________ App1 envia p/ App2 ________________________")
            app1.sendGreetings("App2")
                .then(reciboEnvio => {
                    app1.getRequestsReceived().length.should.be.eql(0);
                    app1.getResponsesReceived().length.should.be.eql(0);
                    app2.getRequestsReceived().length.should.be.eql(0);
                    app2.getResponsesReceived().length.should.be.eql(0);
                    return reciboEnvio;
                })
                .then(reciboEvento => {
                    logger.debug("_______________________ App2 recebe mas não responde _____________________")
                    app2.setReplyEnabled(false);
                    return app2.receiveMessages()
                            .then(_ => app1.receiveMessages())
                })
                // Como o app2 não respondeu, app1 não recebe mensagem nenhuma...
                .then(numOfMessages => {
                    numOfMessages.should.be.eql(0);
                    done()
                })
                .catch(error => {
                    done(error);
                });
        })
        
        /**
         * Producer should validate and return a ServiceNotFoundError
         */
        it('Send to inexistent app', function(done){
            this.timeout(30000);

            logger.debug("_______________________ App1 envia p/ BLARGH ________________________")
            app1.sendGreetings("BLARGH")
                .then(reciboEnvio => {
                    app1.getRequestsReceived().length.should.be.eql(0);
                    app1.getResponsesReceived().length.should.be.eql(0);
                    app2.getRequestsReceived().length.should.be.eql(0);
                    app2.getResponsesReceived().length.should.be.eql(0);
                    return reciboEnvio;
                })
                // Como o app2 não respondeu, app1 não recebe mensagem nenhuma...
                .then(numOfMessages => {
                    done("Não deveria executar aqui porque a mensagem não saiu...");
                })
                .catch(error => {
                    error.message.should.be.eql("No queue found for app: BLARGH");
                    done();
                });
        })

        it('Request invalid service - No one knows wrong_greetings', function(done) {
            this.timeout(30000);

            logger.debug("_______________________ App1 envia p/ App2 ________________________")
            app1.sendWrong("App2")
                .then(reciboEnvio => {
                    done("Não deveria conseguir enviar porque app1 não tem response handler registrado");
                })
                .catch(error => {
                    error.message.should.be.eql("Can't send to service wrong_greetings without a response handler registered.");
                    done();
                });
        })

        it('Request invalid service - App1 knows wrong_greetings', function(done) {
            this.timeout(30000);

            // primeiro faz o registro de wrong_greetings pra poder lançar
            app1.registerWrongHandler();

            logger.debug("_______________________ App1 envia p/ App2 ________________________")
            app1.sendWrong("App2")
                .then(reciboEnvio => {
                    app1.getRequestsReceived().length.should.be.eql(0);
                    app1.getResponsesReceived().length.should.be.eql(0);
                    app2.getRequestsReceived().length.should.be.eql(0);
                    app2.getResponsesReceived().length.should.be.eql(0);
                    return reciboEnvio;
                })
                .then(reciboEvento => {
                    logger.debug("_______________________ App2 não chega a receber _____________________")
                    return app2.receiveMessages()
                            .then(_ => app1.receiveMessages())
                })
                // Como o app2 não respondeu, app1 não recebe mensagem nenhuma...
                .then(numOfMessages => {
                    numOfMessages.should.be.eql(1);
                    app1.getResponsesReceived().length.should.be.eql(0);
                    app1.getWrongResponsesReceived().length.should.be.eql(1);

                    app1.getWrongResponsesReceived()[0].success.should.be.eql(false);
                    app1.getWrongResponsesReceived()[0].body.error.should.be.eql("Service \'wrong_greetings\' not supported.");
                    done()
                })
                .catch(error => {
                    done(error);
                });
        })
        
    //     /**
    //      * App2 must process and return message error with UnknowMethodError
    //      */
    //     it('Test Unknow service',function(done){
            
    //         app1.onResponse('unknown',function(msg,resolve,reject){
    //             try{
    //                 msg.data.response.should.have.property('error')
    //                 msg.data.response.error.message.should.equal('UnknowMethodError: Service does not have required \'unknown\' service.')
    //                 done()
    //             } catch (err){
    //                 done(err)
    //             }

    //         })


    //         app1.sendRequest("app2","unknown",{
    //             linkedin_profile:'https://www.linkedin.com.br/in/calebebrim'
    //         },"jobid=1").then(_=>{
    //             app2.readMessages().then(function(){
    //                 app1.readMessages(); 
    //             }).catch(done)
    //         }).catch(done);
            
            
    //     }).timeout(60000)

    //     it('test message read timeout',function(done){
    //         done(new Error('not implemented'));
    //     });

    })





    
    // describe('Three apps working',function(){
    //     before(b)
    //     after(a)
    //     var app1,app2,app3;
    //     it('Initialize',function(){
    //         var config = clone(require('./hapi.test.peoplesearch.worker.json'));
    //         config.app = 'app3'
    //         config.worker = 'app3'
    //         config.log.debug = false
    //         config.log.info  = false;
            
    //         app3 = new HAPI(config);
    //         app3.initialize().then(_=>{
    //             var config = clone(require('./hapi.test.peoplesearch.worker.json'));
    //             config.app = 'app2'
    //             config.worker = 'app2'
    //             config.log.debug = false
    //             config.log.info  = false;
                
    //             app2 = new HAPI(config);
    //             app2.initialize().then(_=>{
    //                 var config = clone(require('./hapi.test.peoplesearch.worker.json'));
                    
    //                 config.app = 'app1'
    //                 config.worker = 'app1'
    //                 config.log.debug = false;
    //                 config.log.info  = false;
    
    //                 app1 = new HAPI(config)
    //                 app1.initialize().then(_=>done()).catch(done)
    //             })
    //         })
    //     })

    //     it('Send Message',function(){
    //         try{
    //             /// onError: callback to use when processing procedure wasn't executed sucessfully.
    //             ///          usage: onError(new Error('Error: Description'))
    //             app2.onRequest('getProfile.1',(msg,resolve,onError) =>{
    //                 msg.reply({
    //                     linkedin_profile:'processed data of calebebrim'
    //                 });
    //                 app3.readMessages()
    //             });

    //             app2.onRequest('getProfile.1',(msg,resolve,onError) =>{
                    
    //                 app3.readMessages()
    //             });

    //             // app2.onResponse('getProfile.1',)
                
    //             app1.onResponse('getProfile.1',function(msg){
    //                 // console.log('app1: onResponse getProfile.1')
    //                 app2.removeListeners('getProfile.1');
    //                 app1.removeListeners('getProfile.1');
    //                 msg.should.have.property('data')
    //                 msg.data.should.have.property('payload')
    //                 msg.data.payload.should.equal('payload');
    //                 done();
    //             })
                
    //             app1.sendRequest("app2","getProfile.1",{
    //                 linkedin_profile:'https://www.linkedin.com.br/in/calebebrim'
    //             },"payload").then(_=>app2.readMessages()).catch(done);                
                
                
                
                
    //         }catch(error){
    //             done(error)
    //         }
    //     })

    //     it('Send Message app2>app3',function(done){
    //         app2.on('getProfile',(msg) =>{
    //             myPayload = {
    //                                        myOwnPayload: 'blablabla',
    //                                        originalMessage: 'msg'
    //             }
    //             app.sendMessage('app3', 'doSomethingElse', {param1:'aaa', param2:'bbb'}, myPayload);

    //             // ======= or ========
                
    //             msq.sendMessage('app3', 'doSomethingElse', {param1:'aaa', param2:'bbb'}, 'blablabla'); // <<nesse caso a api faria aquele workarround

    //         });
    //     })

    //     it('Respond Message app3>app2',function(){
    //         throw new Error('not implemented')            
    //     })
        
    //     it('Respond Message app2>app1',function(){
    //         throw new Error('not implemented')            
    //     })


    // })
    
})

