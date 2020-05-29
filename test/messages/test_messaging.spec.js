require('should')
const { logger } = require('../../src/Logger-Loader')
const clone = require('clone');
const path = require('path')
const sleep = require('sleep-promise')
const DEFAULT_CONF = path.resolve(__dirname, '../sample_conf.json')
const LOAD_LOCALSTACK = process.env.LOAD_LOCALSTACK != "false";
var Mocha = require("mocha");

const PoloMessaging = require('../../src');
const localstackUtils = require('../utils/localstack')

const DEFAULT_SLEEP = parseInt(process.env.DEFAULT_SLEEP || "100")

class DumbTransporter {
  verify() {}
  initialize() {}
}

const SyncTransporter = require('../transporters/Mem-direct').MemDirectTransporter
const TRANSPORTERS = [
  {
    label: 'AWS SQS',
    code: 'SQS',
    helper: require('../utils/localstack')
  }, 
  {
    label: 'AMQP',
    code: 'AMQP',
    helper: require('../utils/rabbit')
  },
  {
    label: 'SyncTransporter',
    code: 'memDirect',
    impl: new SyncTransporter(),
    syncMode: true
  },
]

describe('General',function() {  
  describe('Test Configurations', function() {
    it('No Configuration', function(done) {
      try {
        new PoloMessaging();
        done(new Error("Should not have initialized without a configuration"))
      } catch (error) {
        done()
      }
    });

    it('No app name', function(done) {
      try {
        var messagingAPI = new PoloMessaging({});
        done(new Error("Should not have initialized without config.app"))
      } catch (error) {
        done()
      }
    });

    it('No stage defined', function(done) {
      try {
        var messagingAPI = new PoloMessaging({app:'testApp'});
        done(new Error("Should not have initialized without config.stage"))
      } catch (error) {
        done()
      }
    });

    it('Stage as ENV', function(done) {
      process.env.current_stage = "test";
      try {
        var messagingAPI = new PoloMessaging({app:'testApp', transporter: new DumbTransporter() } );
        messagingAPI.config.stage.should.be.eql(process.env.current_stage);
        done()
      } catch (error) {
        console.error(error)
        done(new Error("Not considering environment variable to define stage"))
      }
      finally {
        delete process.env.current_stage;
      }
    });

    it('Autoset worker Id', function(done) {
      try {
        var messagingAPI = new PoloMessaging({app:'testApp', stage:'test', transporter: new DumbTransporter()});
        messagingAPI.config.worker.should.be.not.null()
        done()
      } catch (error) {
          done(error);
      }
    });

    it('No AWS configuration', function(done) {
      try {
        var messagingAPI = new PoloMessaging({app:'testApp', worker:'me', stage:'test', transporter: 'SQS' });
        done()
      } catch (error) {
        console.error(error)
        done(new Error("Should initialize with some warnings"))
      }
    });

    it('conf with warnings', function(done) {
      try {
        new PoloMessaging({app:'testApp', worker:'me', stage:'test', aws:{}});
        done()
      } catch (error) {
        done(new Error("Should have initialized", error))
      }
    });

    it('conf without warnings', function(done) {
      // Not testing warning effectivelly (only visually) but could do that in the future with a custom appender in logger
      try {
        new PoloMessaging({app:'testApp', worker:'me', stage:'test', aws:{sqs:{}, sns:{}}});
        done()
      } catch (error) {
        done(new Error("Should have initialized", error))
      }
    });

    it('Configuring using a file', function(done){
      new PoloMessaging(DEFAULT_CONF);
      done();
    });
  })

  TRANSPORTERS.forEach(trans => {
    describe(`Testing ${trans.label} Transporter`, function() {
      const SampleApp = require('./sample_app');

      describe('Two Way integration', function() {
        let transporterConfig = null
        if(!trans.impl)
          transporterConfig = { transporter: trans.code }
        else
          transporterConfig = { transporter: trans.impl }

        const confWithTransporter = clone(Object.assign({}, require(DEFAULT_CONF), transporterConfig))

        var app1 = new SampleApp("App1", clone(confWithTransporter));
        var app2 = new SampleApp("App2", clone(confWithTransporter));
    
        before(() => app1.initializeQueue());
        before(() => app2.initializeQueue());
        beforeEach((done) => {
          app1.reset();
          app2.reset()
          done()
        });
    
        beforeEach((done) => { 
          if(!trans.helper) done()
          else {
            logger.debug("Purging Queues...");
  
            // Some transporters may not be able to inspect queues, so name queues used in test
            const usedQueues = ['App1_test', 'App2_test']
            Promise.all(
              usedQueues.map(q => trans.helper.purgeQueue(q))
            )
              .then(_ => done())
          }
        });

        after(done => {
          app1.messagingAPI.close()
          app2.messagingAPI.close()

          if(trans.helper && trans.helper.dispose)
            trans.helper.dispose().then(_ => done());
          else
            done()
        })

        it('Send and receive message', function(done) {
          this.timeout(30000);
    
          logger.debug("_______________________ App1 to App2 ________________________")
          app1.sendGreetings("App2")
            .then(_ => sleep(DEFAULT_SLEEP))
            .then(_ => {
              logger.debug("_______________________ App2 receives and responds _____________________")
              return app2.receiveMessages()
            })
            .then(_ => {
              app2.getRequestsReceived().length.should.be.eql(1);
              app2.getResponsesReceived().length.should.be.eql(0);
              app2.getRequestsReceived()[0].body.should.be.eql("Hello, App2... I'm App1");
              return sleep(DEFAULT_SLEEP)
            })
            .then(_ => {
              logger.debug("_______________________ App1 gets a response _____________________")
              return app1.receiveMessages();
            })
            .then(_ => {
              app1.getRequestsReceived().length.should.be.eql(0);
              app1.getResponsesReceived().length.should.be.eql(1);
              app1.getResponsesReceived()[0].body.answer.should.be.eql("Nice to meet you!")
              done()
            })
            .catch(error => {
              done(error);
            });
        })
    
        it('Send and dismiss message', function(done) {
          this.timeout(30000);
    
          logger.debug("_______________________ App1 to App2 ________________________")
          // Disable reply on app2
          app2.setReplyEnabled(false)

          app1.sendGreetings("App2")
            .then(_ => {
              logger.debug("_______________________ App2 receives but won't answer _____________________")
              return app2.receiveMessages()
                .then(_ => app1.receiveMessages())
            })
            // since app2 didn't answered, app1 won't receive any message
            .then(_ => {
              logger.debug("____ Checking history ____________")
              app1.getRequestsReceived().length.should.be.eql(0);
              app1.getResponsesReceived().length.should.be.eql(0);
              done()
            })
            .catch(error => {
              done(error);
            })
            .finally(_ => {
              app2.setReplyEnabled(true)
            });
        })
        
        it('Send to inexistent app', function(done){
            this.timeout(30000);
    
            // little trick to change autoCreate behavior dinamically
            app1.messagingAPI.config.aws.sqs.create = false
            app1.messagingAPI.config.amqp.create = false
            
            logger.debug("_______________________ App1 to BLARGH ________________________")

            // AMQP eventually keeps an uncaught exception somewhere.. hacking mocha to
            // avoid failing test
            const mochaDefault = Mocha.Runner.prototype.uncaught
            Mocha.Runner.prototype.uncaught = function (err) {
            };

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
              })
              .finally(_ => {
                Mocha.Runner.prototype.uncaught = mochaDefault
                app1.messagingAPI.config.aws.sqs.create = true;
                app1.messagingAPI.config.amqp.create = true
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
              return sleep(DEFAULT_SLEEP);
            })
            .then(_ => {
              logger.debug("_______________________ App2 won't really receive a message to process _____________________")
              return app2.receiveMessages()
                .then(_ => sleep(DEFAULT_SLEEP))
                .then(_ => app1.receiveMessages())
            })
            .then(_ => {
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
    
        it('Send async response', function(done) {
          this.timeout(30000);

          // Does not make sense to test async response if transporter is synched
          if(trans.syncMode) {
            logger.info(`Transporter ${trans.code} is synchronized, skipping test`)
            done()
            return
          }
    
          logger.debug("_______________________ App1 to App2 ________________________")
          app1.sendAsyncGreetings("App2")
            .then(_ => sleep(DEFAULT_SLEEP))
            .then(_ => {
              app1.getRequestsReceived().length.should.be.eql(0);
              app1.getResponsesReceived().length.should.be.eql(0);
              app2.getRequestsReceived().length.should.be.eql(0);
              app2.getResponsesReceived().length.should.be.eql(0);
              return sleep(DEFAULT_SLEEP);
            })
            .then(_ => {
              logger.debug("_______________________ App2 receives and responds _____________________")
              return app2.receiveMessages()
            })
            .then(_ => sleep(DEFAULT_SLEEP))
            .then(_ => {
              app1.getRequestsReceived().length.should.be.eql(0);
              app1.getResponsesReceived().length.should.be.eql(0);
              app2.getRequestsReceived().length.should.be.eql(1);
              app2.getResponsesReceived().length.should.be.eql(0);
              app2.getRequestsReceived()[0].body.should.be.eql("Hello, App2... See you later...");
              app2.getPendingResponses().length.should.be.eql(1);
              return '';
            })
            .then(_ => {
              logger.debug("_______________________ App1 * WON'T *gets a response _____________________")
              return app1.receiveMessages();
            })
            .then(_ => sleep(DEFAULT_SLEEP))
            .then(numOfMessages => {
              app1.getRequestsReceived().length.should.be.eql(0);
              app1.getResponsesReceived().length.should.be.eql(0);
              app2.getRequestsReceived().length.should.be.eql(1);
              app2.getResponsesReceived().length.should.be.eql(0);
              return numOfMessages;
            })
            .then(_ => {
              logger.debug("_______________________ Now app2 sends an async answer _____________________")
              var msg = app2.getPendingResponses()[0];
              return app2.sendAsyncResponse(msg);
            })
            .then(_ => sleep(DEFAULT_SLEEP))
            .then(_ => app1.receiveMessages())
            .then(_ => {
              app1.getRequestsReceived().length.should.be.eql(0);
              app1.getResponsesReceived().length.should.be.eql(1);
              app2.getRequestsReceived().length.should.be.eql(1);
              app2.getResponsesReceived().length.should.be.eql(0);
              done()
            })
            .catch(error => {
              done(error);
            });
        })
      })

      describe('Forwarding messages', function(){
        const SampleBroker = require('./sample_broker');
        let transporterConfig = null
        if(!trans.impl)
          transporterConfig = { transporter: trans.code }
        else
          transporterConfig = { transporter: trans.impl }

        const confWithTransporter = clone(Object.assign({}, require(DEFAULT_CONF), transporterConfig))

        var app1 = new SampleApp("App1", clone(confWithTransporter))
        var app2 = new SampleApp("App2", clone(confWithTransporter))
        var broker = new SampleBroker("Broker", clone(confWithTransporter))

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
        beforeEach( (done) => { 
          if(!trans.helper) {
            done()
          } else {
            logger.info("Purging Queues...");
  
            // Some transporters may not be able to inspect queues, so name queues used in test
            const usedQueues = ['App1_test', 'App2_test', 'Broker_test']
            Promise.all(
              usedQueues.map(q => trans.helper.purgeQueue(q))
            )
              .then(_ => done())
          }
        });

        after(done => {
          app1.messagingAPI.close()
          app2.messagingAPI.close()
          broker.messagingAPI.close()
          done()
        })
      
        it('Send to broker and receive message', function(done) {
          this.timeout(30000);
    
          logger.debug("_______________________ App1 to Broker ________________________")
          app1.sendGreetings("Broker")
            .then(_ => sleep(DEFAULT_SLEEP))
            .then(_ => {
              logger.debug("_______________________ Broker receives and forwards _____________________")
              return broker.receiveMessages()
            })
            .then(_ => {
              broker.getRequestsReceived().length.should.be.eql(1);
              return sleep(DEFAULT_SLEEP);
            })
    
            .then(_ => {
              logger.debug("_______________________ App2 receives and responds (to app1) _____________________")
              return app2.receiveMessages()
            })
            .then(numOfMessages => {
              app2.getRequestsReceived().length.should.be.eql(1);
              app2.getResponsesReceived().length.should.be.eql(0);
              // It should only be "Hello, Broker" because sampleApp adds broker's name in the string
              app2.getRequestsReceived()[0].body.should.be.eql("Hello, Broker... I'm App1");
              broker.getRequestsReceived().length.should.be.eql(1);
              return numOfMessages;
            })
            .then(_ => sleep(DEFAULT_SLEEP))
            .then(_ => {
              logger.debug("_______________________ App1 gets a response _____________________")
              return app1.receiveMessages();
            })
            .then(_ => {
              app1.getRequestsReceived().length.should.be.eql(0);
              app1.getResponsesReceived().length.should.be.eql(1);
              app2.getRequestsReceived().length.should.be.eql(1);
              app2.getResponsesReceived().length.should.be.eql(0);
              app1.getResponsesReceived()[0].body.answer.should.be.eql("Nice to meet you!")
    
              app1.getResponsesReceived()[0].originalMessage.forwardedBy.application.should.be.eql("Broker");
              done()
            })
            .catch(error => {
              done(error);
            });
          })
        })

      })

    })
    
  //   // // Localstack initialization
  //   before(function() {
  //       var newEnv = clone(process.env);
  //       newEnv.SERVICES = "sqs"
      
  //   this.timeout(60000); 

  //   if(LOAD_LOCALSTACK)
  //     return localstackUtils.start({env: newEnv})
  //       .then(_ => new Promise((res, rej) => {
  //           // wait a while to localstack be ready to receive SQS requests (avoid error 502)
  //           setTimeout(res, 2000);
  //       }));
  //   else
  //     return new Promise((res, rej) => {
  //       setTimeout(res, 2000);
  //     });
  // });
})

