require('should')

var hapipath = '../huntercoServices.js',
    aws_config_file_path = './config.development.json'
var ls;
const HAPI = require(hapipath)


function clone(obj) {
    if (null == obj || "object" != typeof obj) return obj;
    var copy = obj.constructor();
    for (var attr in obj) {
        if (obj.hasOwnProperty(attr)){
            if (null != obj || "object" == typeof obj) copy[attr] = clone(obj[attr]);
            else copy[attr] = obj[attr];
        }
    }
    return copy;
}

function configureAWSLocalStackLChildProcess(){
    return new Promise(function(resolve,reject){
        try {
            const spawn = require('child_process').spawn;
            
            ls = spawn('localstack', ['start']);
            
            ls.stdout.on('data', (data) => {
                // console.log(`stdout: ${data}`);
                if(/\nReady./ig.test(data)){
                    resolve()
                }
            });
            
            ls.stderr.on('data', (data) => {
                // console.log(`stderr: ${data}`);
            });
            
            ls.on('close', (code) => {
                // console.log(`Localstack has being terminated with code: ${code}`);
            });
    
            process.on('beforeExit',function(code){
                // console.log('terminating child processes')
                ls.exit(code);  
            })            
        } catch (error) {
            reject(err)
        }

    });
    
}

function b(done){
    this.timeout(60000);
    configureAWSLocalStackLChildProcess().then(done);
}

function a(done){
    this.timeout(30000)
    setTimeout(() => {
        ls.kill('SIGINT');     
        ls.on('close',function(){
            done();
        })       
    }, 1000);
}

function initializeHapi(hapi,done){
    hapi.initialize().then(_=>{
        try{
            hapi.aws.sqs.should.have
                .property('queue')
                    .which.is.a.Object()
                    .and.have.property('http://localhost:4576/queue/br_com_hunterco_service_peoplesearch_request')
                        .which.is.an.Object()
                        
            hapi.aws.sqs.should.have
                .property('queue')
                    .which.is.a.Object()
                    .and.have.property('http://localhost:4576/queue/br_com_hunterco_service_peoplesearch_response')
                        .which.is.an.Object()
            
            hapi.aws.sqs.queue['http://localhost:4576/queue/br_com_hunterco_service_peoplesearch_response']
                .should.have.property('QueueArn')
                .which.is.an.String()
                
            
            hapi.aws.sqs.queue['http://localhost:4576/queue/br_com_hunterco_service_peoplesearch_response']
                .should.have.property('QueueArn')
                .which.is.an.String()
                
            done()

        }catch(err){
            done(err)
        }
    
    }).catch(done);
}

    
describe('General',function(){  
    
    describe('Configure with json object',function(){
        before(b)
        after(a)
        var hapi;
        it('Initialize with json object',function(done){
            var HAPI = require(hapipath)
            try {
                var config = clone(require('./hapi.test.peoplesearch.worker.json'));
                hapi = new HAPI(config);
                initializeHapi(hapi,done)
            } catch (error) {
                done(error)
            }
        }).timeout(20000);        
    })

    describe('Initialize with json file path',function(){
        before(b)
        after(a)
        it('Configure Passing Path',function(done){
            var HAPI = require(hapipath)
            try {
                var hapi = new HAPI('./test/hapi.test.peoplesearch.worker.json')
                initializeHapi(hapi,done)
            } catch (error) {
                done(error)
            }
        }).timeout(20000);
    })

    describe('Initialization Errors',function(){
        
        before(b)
        after(a)
        it('Test random app identifier',function(done){
            var HAPI = require(hapipath)
            var config = clone(require('./hapi.test.peoplesearch.worker.json'));
            config.app = ""+Math.random();
            config.aws.sqs.create = false
            new HAPI(config).initialize().then(function(){
                done(new Error('Random app string is not permitted'))                
            }).catch(err => {
                try {
                    err.should.be.an.instanceOf(Error)
                    err.should.have.property('message','AppNotRegisteredError: App must be registered with an valid identifier.')
                    done() 
                } catch (error) {
                    done(error)
                }
                
            })
            
            
            
        }).timeout(10000)
        
        it('Test missing id error',function(done){
            
            var HAPI = require(hapipath)
            var config = clone(require('./hapi.test.peoplesearch.worker.json'));
            delete config.worker;
            new HAPI(config).initialize().then(_=>{
                done(new Error('Should not initialize without worker id'))
            }).catch(err=>{
                try{
                    err.should.be.an.instanceOf(Error)
                    err.should.have.property('message','AppWithoutIdError: App must be registered with an identifier.')
                    done() //should start error
                    
                }catch(err){
                    done(err)
                }
            })
            
        }).timeout(10000)
    })

    describe('Offline Initialization Test',function(){
        var app1
        it('Initialize one worker',function(done){
            var config = clone(require('./hapi.test.peoplesearch.worker.json'));            
            app1 = new HAPI(config)
            app1.initialize(_=>{
                done(new Error("Should end with success"))
            }).catch(err=>{
                done()
            })
        }).timeout(10000)

        it('send message',function(){
            app1.sendRequest("app2","getProfile.1",{
                linkedin_profile:'https://www.linkedin.com.br/in/calebebrim'
            },"payload").then(_=>done(new Error('should not success'))).catch(err=>done());                
            
        })
    })

    describe('Send message and receive message',function(){
        before(b)
        after(a)
       
        var app1,
            app2;

        it('Initialize apps',function(done){

            var config = clone(require('./hapi.test.peoplesearch.worker.json'));
            config.app = 'app2'
            config.worker = 'app2'
            config.log.debug = false;
            config.log.info  = false;
            config.aws.sqs.create = true;
            
            app2 = new HAPI(config);
            app2.initialize().then(_=>{
                var config = clone(require('./hapi.test.peoplesearch.worker.json'));
                
                config.app = 'app1'
                config.worker = 'app1'
                config.log.debug = false;
                config.log.info  = false;
                config.aws.sqs.create = true;

                app1 = new HAPI(config)
                app1.initialize().then(_=>done()).catch(done)
            }).catch(done);
        }).timeout(10000)
        
        var message;
        var mock_worker_1_db = {};
        
        it('Send and receive message',function(done){

                try{
                    /// onError: callback to use when processing procedure wasn't executed sucessfully.
                    ///          usage: onError(new Error('Error: Description'))
                    app2.onRequest('getProfile.1',(msg) =>{
                        msg.repply({
                            linkedin_profile:'processed data of calebebrim'
                        });
                        app1.readMessages()
                            // .then(_=>{});
                    });
                    
                    app1.onResponse('getProfile.1',function(msg){
                        // console.log('app1: onResponse getProfile.1')
                        app2.removeListeners('getProfile.1');
                        app1.removeListeners('getProfile.1');
                        msg.should.have.property('data')
                        msg.data.should.have.property('payload')
                        msg.data.payload.should.equal('payload');
                        done();
                    })
                    
                    app1.sendRequest("app2","getProfile.1",{
                        linkedin_profile:'https://www.linkedin.com.br/in/calebebrim'
                    },"payload").then(_=>app2.readMessages()).catch(done);                
                    
                    
                    
                    
                }catch(error){
                    done(error)
                }
        }).timeout(60000)

        it('Send to inexistent app',function(done){
            app1.sendRequest("unknown","unknown",{
                linkedin_profile:'https://www.linkedin.com.br/in/calebebrim' 
            },"jobid=1").then(_=>done(new Error('Should not execute sucessfully'))).catch(err=>{
                if(/^ServiceNotFoundError:.*/.test(err.message)) done()
                else done(err)
            });
        })
        
        
        it('Test Unknow service',function(done){
            
            app1.onResponse('unknown',function(msg,resolve,reject){
                try{
                    msg.data.response.should.have.property('error')
                    msg.data.response.error.message.should.equal('UnknowMethodError: Service does not have required \'unknown\' service.')
                    done()
                } catch (err){
                    done(err)
                }

            })


            app1.sendRequest("app2","unknown",{
                linkedin_profile:'https://www.linkedin.com.br/in/calebebrim'
            },"jobid=1").then(_=>{
                app2.readMessages().then(function(){
                    app1.readMessages(); 
                }).catch(done)
            }).catch(done);
            
            
        }).timeout(60000)

    })

    describe('Three apps working',function(){
        before(b)
        after(a)
        var app1,app2,app3;
        it('Initialize',function(){
            var config = clone(require('./hapi.test.peoplesearch.worker.json'));
            config.app = 'app3'
            config.worker = 'app3'
            config.log.debug = false
            config.log.info  = false;
            
            app3 = new HAPI(config);
            app3.initialize().then(_=>{
                var config = clone(require('./hapi.test.peoplesearch.worker.json'));
                config.app = 'app2'
                config.worker = 'app2'
                config.log.debug = false
                config.log.info  = false;
                
                app2 = new HAPI(config);
                app2.initialize().then(_=>{
                    var config = clone(require('./hapi.test.peoplesearch.worker.json'));
                    
                    config.app = 'app1'
                    config.worker = 'app1'
                    config.log.debug = false;
                    config.log.info  = false;
    
                    app1 = new HAPI(config)
                    app1.initialize().then(_=>done()).catch(done)
                })
            })
        })

        it('Send Message',function(){
            try{
                /// onError: callback to use when processing procedure wasn't executed sucessfully.
                ///          usage: onError(new Error('Error: Description'))
                app2.onRequest('getProfile.1',(msg,resolve,onError) =>{
                    msg.repply({
                        linkedin_profile:'processed data of calebebrim'
                    });
                    app3.readMessages()
                });

                app2.onRequest('getProfile.1',(msg,resolve,onError) =>{
                    
                    app3.readMessages()
                });

                // app2.onResponse('getProfile.1',)
                
                app1.onResponse('getProfile.1',function(msg){
                    // console.log('app1: onResponse getProfile.1')
                    app2.removeListeners('getProfile.1');
                    app1.removeListeners('getProfile.1');
                    msg.should.have.property('data')
                    msg.data.should.have.property('payload')
                    msg.data.payload.should.equal('payload');
                    done();
                })
                
                app1.sendRequest("app2","getProfile.1",{
                    linkedin_profile:'https://www.linkedin.com.br/in/calebebrim'
                },"payload").then(_=>app2.readMessages()).catch(done);                
                
                
                
                
            }catch(error){
                done(error)
            }
        })

        it('Send Message app2>app3',function(done){
            app2.on('getProfile',(msg) =>{
                myPayload = {
                                           myOwnPayload: 'blablabla',
                                           originalMessage: 'msg'
                }
                app.sendMessage('app3', 'doSomethingElse', {param1:'aaa', param2:'bbb'}, myPayload);

                // ======= or ========
                
                msq.sendMessage('app3', 'doSomethingElse', {param1:'aaa', param2:'bbb'}, 'blablabla'); // <<nesse caso a api faria aquele workarround

            });
        })

        it('Respond Message app3>app2',function(){
            throw new Error('not implemented')            
        })
        
        it('Respond Message app2>app1',function(){
            throw new Error('not implemented')            
        })


    })
    
})

