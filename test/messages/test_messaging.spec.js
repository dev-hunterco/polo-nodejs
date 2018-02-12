require('should')
const logger = require('winston')
const clone = require('clone');
const path = require('path')
const sleep = require('sleep')
const DEFAULT_CONF = path.resolve(__dirname, '../sample_conf.json')
const LOAD_LOCALSTACK = process.env.LOAD_LOCALSTACK != "false";

const PoloMessaging = require('../../src');
const localstackUtils = require('../utils/localstack')

describe('Messaging Tests',function() {  
    // // Localstack initialization
    before(function() {
        var newEnv = clone(process.env);
        newEnv.SERVICES = "sqs"

        this.timeout(60000); 

        if(LOAD_LOCALSTACK)
            return localstackUtils.start({env: newEnv})
                        .then(_ => new Promise((res, rej) => {
                            // wait a while to localstack be ready to receive SQS requests (avoid error 502)
                            setTimeout(res, 2000);
                        }));
        else
            return new Promise((res, rej) => {
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
                var messagingAPI = new PoloMessaging();
                done(new Error("Should not have initialized without a configuration"))
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
                var messagingAPI = new PoloMessaging({app:'testApp'});
                messagingAPI.config.stage.should.be.eql(process.env.current_stage);
                done()
            } catch (error) {
                done(new Error("Not considering environment variable to define stage"))
            }
            finally {
                delete process.env.current_stage;
            }
        });

        it('Autoset worker Id', function(done) {
            try {
                var messagingAPI = new PoloMessaging({app:'testApp', stage:'test'});
                messagingAPI.config.worker.should.be.not.null()
                done()
             } catch (error) {
                 done(error);
             }
        });

        it('No AWS configuration', function(done) {
            try {
                var messagingAPI = new PoloMessaging({app:'testApp', worker:'me', stage:'test'});
                done()
            } catch (error) {
                done(new Error("Should initialize with some warnings"))
             }
        });

        it('conf with warnings', function(done) {
            try {
                var messagingAPI = new PoloMessaging({app:'testApp', worker:'me', stage:'test', aws:{}});
                done()
            } catch (error) {
                done(new Error("Should have initialized", error))
            }
        });

        it('conf without warnings', function(done) {
             // Não testa efetivamente os warnings (só visualmente) mas poderia fazer
             // se criar um appender pro logger
            try {
                var messagingAPI = new PoloMessaging({app:'testApp', worker:'me', stage:'test', aws:{sqs:{}, sns:{}}});
                done()
            } catch (error) {
                done(new Error("Should have initialized", error))
            }
        });

        it('Configuring using a file', function(done){
            var messagingAPI = new PoloMessaging(DEFAULT_CONF);
            done();
        });
    })

    describe('Initialization', function() {
        it('Initialize Queue', function(done) {
            var messagingAPI = new PoloMessaging(clone(require(DEFAULT_CONF)));
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

            logger.debug("_______________________ App1 to App2 ________________________")
            app1.sendGreetings("App2")
                .then(reciboEnvio => {
                    app1.getRequestsReceived().length.should.be.eql(0);
                    app1.getResponsesReceived().length.should.be.eql(0);
                    app2.getRequestsReceived().length.should.be.eql(0);
                    app2.getResponsesReceived().length.should.be.eql(0);
                    return reciboEnvio;
                })
                .then(reciboEvento => {
                    logger.debug("_______________________ App2 receives and responds _____________________")
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
                    logger.debug("_______________________ App1 gets a response _____________________")
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

            logger.debug("_______________________ App1 to App2 ________________________")
            app1.sendGreetings("App2")
                .then(reciboEnvio => {
                    app1.getRequestsReceived().length.should.be.eql(0);
                    app1.getResponsesReceived().length.should.be.eql(0);
                    app2.getRequestsReceived().length.should.be.eql(0);
                    app2.getResponsesReceived().length.should.be.eql(0);
                    return reciboEnvio;
                })
                .then(reciboEvento => {
                    logger.debug("_______________________ App2 receives but won't answer _____________________")
                    app2.setReplyEnabled(false);
                    return app2.receiveMessages()
                            .then(_ => app1.receiveMessages())
                })
                // since app2 didn't answered, app1 won't receive any message
                .then(numOfMessages => {
                    numOfMessages.should.be.eql(0);
                    done()
                })
                .catch(error => {
                    done(error);
                });
        })
        
        it('Send to inexistent app', function(done){
            this.timeout(30000);

            logger.debug("_______________________ App1 to BLARGH ________________________")
            app1.sendGreetings("BLARGH")
                .then(reciboEnvio => {
                    app1.getRequestsReceived().length.should.be.eql(0);
                    app1.getResponsesReceived().length.should.be.eql(0);
                    app2.getRequestsReceived().length.should.be.eql(0);
                    app2.getResponsesReceived().length.should.be.eql(0);
                    return reciboEnvio;
                })
                .then(numOfMessages => {
                    done("Should never get here since an error should be raised.");
                })
                .catch(error => {
                    error.message.should.be.eql("No queue found for app: BLARGH");
                    done();
                });
        })

        it('Request invalid service - No one knows wrong_greetings', function(done) {
            this.timeout(30000);

            logger.debug("_______________________ App1 to App2 ________________________")
            app1.sendWrong("App2")
                .then(reciboEnvio => {
                    done("Should never get here since app1 doesn't have a response handler configured for wrong_greetings");
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

            logger.debug("_______________________ App1 to App2 ________________________")
            app1.sendWrong("App2")
                .then(reciboEnvio => {
                    app1.getRequestsReceived().length.should.be.eql(0);
                    app1.getResponsesReceived().length.should.be.eql(0);
                    app2.getRequestsReceived().length.should.be.eql(0);
                    app2.getResponsesReceived().length.should.be.eql(0);
                    return reciboEnvio;
                })
                .then(reciboEvento => {
                    logger.debug("_______________________ App2 won't really receive a message to process _____________________")
                    return app2.receiveMessages()
                            .then(_ => app1.receiveMessages())
                })
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
    })

    describe('Forwarding messages', function(){
        const SampleApp = require('./sample_app');
        const SampleBroker = require('./sample_broker');
        var app1 = new SampleApp("App1", clone(require(DEFAULT_CONF)));
        var app2 = new SampleApp("App2", clone(require(DEFAULT_CONF)));
        var broker = new SampleBroker("Broker", clone(require(DEFAULT_CONF)));

        before(() => app1.initializeQueue());
        before(() => app2.initializeQueue());
        before(() => broker.initializeQueue());

        beforeEach((done) => {
            app1.reset();
            app2.reset()
            broker.reset()
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
        
        it('Send to broker and receive message', function(done) {
            this.timeout(30000);

            logger.debug("_______________________ App1 to Broker ________________________")
            app1.sendGreetings("Broker")
                .then(reciboEnvio => {
                    app1.getRequestsReceived().length.should.be.eql(0);
                    app1.getResponsesReceived().length.should.be.eql(0);
                    app2.getRequestsReceived().length.should.be.eql(0);
                    app2.getResponsesReceived().length.should.be.eql(0);
                    broker.getRequestsReceived().length.should.be.eql(0);
                    broker.getResponsesReceived().length.should.be.eql(0);
                    return reciboEnvio;
                })

                .then(reciboEvento => {
                    logger.debug("_______________________ Broker receives and forwards _____________________")
                    return broker.receiveMessages()
                })
                .then(numOfMessages => {
                    numOfMessages.should.be.eql(1);
                    app1.getRequestsReceived().length.should.be.eql(0);
                    app1.getResponsesReceived().length.should.be.eql(0);
                    app2.getRequestsReceived().length.should.be.eql(0);
                    app2.getResponsesReceived().length.should.be.eql(0);
                    broker.getRequestsReceived().length.should.be.eql(1);
                    return numOfMessages;
                })

                .then(reciboEvento => {
                    logger.debug("_______________________ App2 receives and responds (to app1) _____________________")
                    return app2.receiveMessages()
                })
                .then(numOfMessages => {
                    numOfMessages.should.be.eql(1);
                    app1.getRequestsReceived().length.should.be.eql(0);
                    app1.getResponsesReceived().length.should.be.eql(0);
                    app2.getRequestsReceived().length.should.be.eql(1);
                    app2.getResponsesReceived().length.should.be.eql(0);
                    // It should only be "Hello, Broker" because sampleApp adds broker's name in the string
                    app2.getRequestsReceived()[0].body.should.be.eql("Hello, Broker... I'm App1");
                    broker.getRequestsReceived().length.should.be.eql(1);
                    return numOfMessages;
                })
                .then(_ => {
                    logger.debug("_______________________ App1 gets a response _____________________")
                    return app1.receiveMessages();
                })
                .then(numOfMessages => {
                    app1.getRequestsReceived().length.should.be.eql(0);
                    app1.getResponsesReceived().length.should.be.eql(1);
                    app2.getRequestsReceived().length.should.be.eql(1);
                    app2.getResponsesReceived().length.should.be.eql(0);
                    app1.getResponsesReceived()[0].body.answer.should.be.eql("Nice to meet you!")

                    app1.getResponsesReceived()[0].originalMessage.forwardedBy.application.should.be.eql("Broker");
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
    })

})

