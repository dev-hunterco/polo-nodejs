

require('should')
var hapipath = '../huntercoServices.js',
    aws_config_file_path = './config.development.json'
var ls;
const HAPI = require(hapipath)


function configureAWSLocalStackLChildProcess(){
    return new Promise(function(resolve,reject){
        try {
            const spawn = require('child_process').spawn;
            
            ls = spawn('localstack', ['start']);
            
            ls.stdout.on('data', (data) => {
                console.log(`stdout: ${data}`);
                if(/\nReady./ig.test(data)){
                    resolve()
                }
            });
            
            ls.stderr.on('data', (data) => {
                console.log(`stderr: ${data}`);
            });
            
            ls.on('close', (code) => {
                console.log(`Localstack has being terminated with code: ${code}`);
            });
    
            process.on('beforeExit',function(code){
                console.log('terminating child processes')
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
    this.timeout(20000)
    ls.kill('SIGINT');     
    ls.on('close',function(){
        done();
    })       
}


    
describe('General',function(){  
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
    describe('Configure with json object',function(){
        before(b)
        after(a)
        var hapi;
        it('Initialize with json object',function(done){
            var HAPI = require(hapipath)
            try {
                hapi = new HAPI(require('./hapi.test.peoplesearch.worker.json'));
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

    describe('Test Initialization Errors',function(){
        before(b)
        after(a)
        it('Test random app identifier',function(done){
            var HAPI = require(hapipath)
            var config = require('./hapi.test.peoplesearch.worker.json');
            config.app = ""+Math.random();
            config.aws.sqs.create = false
            new HAPI(config).initialize().then(function(){
                done(new Error('Random app string is not permitted'))                
            }).catch(err => {
                try {
                    err.should.be.an.instanceOf(Error)
                    err.should.have.property('message','AppNotRegistered: App must be registered with an valid identifier.')
                    done() 
                } catch (error) {
                    done(error)
                }
                
            })
            
            
            
        }).timeout(10000)
        
        it('Test missing id error',function(done){
            
            var HAPI = require(hapipath)
            var config = require('./hapi.test.peoplesearch.worker.json');
            delete config.worker;
            new HAPI(config).initialize().then(_=>{
                done(new Error('Should not initialize without worker id'))
            }).catch(err=>{
                err.should.be.an.instanceOf(Error)
                err.should.have.property('message','AppWithoutId: App must be registered with an identifier.')
                done() //should start error
            })
            
        })
    })

    describe('Offline Initialization Test',function(){
        before(b);
        after(a);
        var app1
        it('Initialize one worker',function(done){
            app1 = new HAPI(config)
            app1.initialize(_=>done()).catch(done)
        }).timeout(10000)

        it('send message',function(){
            throw new Error('Not implemented');
        })
    })

    describe.only('Send message and receive message',function(){
        before(b)
        after(a)
        var app1,app2;

        it('Initialize first app',function(){
            var config = require('./hapi.test.peoplesearch.worker.json');
            config.app = 'app1'
            config.worker = 'app1'
            config.log.debug = true
            app1 = new HAPI(config);
            return app1.initialize();
        }).timeout(10000)
    
        it('Initialize second app',function(){
            var config = require('./hapi.test.peoplesearch.worker.json');
            
            config.app = 'app2'
            config.worker = 'app2'
            
            config.log.debug = true
            
            app2 = new HAPI(config)

            return app2.initialize()
        }).timeout(10000)
        
        var message;
        var mock_worker_1_db = {};
        
        it('Send and receive message',function(done){

            try{
                
                app2.onRequest('getProfile.1',(msg) =>{
                    msg.repply({
                        linkedin_profile:'https://www.linkedin.com.br/in/calebebrim'
                    }).then(_=>app1.readMessages()).catch(done);
                });
                
                app1.onResponse('getProfile.1',function(msg){
                    app2.removeListeners('getProfile.1');
                    app1.removeListeners('getProfile.1');
                    done();
                })
                app1.sendRequest("app2","getProfile.1",{
                    linkedin_profile:'https://www.linkedin.com.br/in/calebebrim'
                },"payload").then(_=>app2.readMessages().then(_=>console.log('app2 messges read'))).catch(done);

                
            }catch(error){
                done(error)
            }
        }).timeout(60000)

        it('Send to inexistent app',function(done){
            app1.sendRequest("unknown","unknown",{
                linkedin_profile:'https://www.linkedin.com.br/in/calebebrim' 
            },"jobid=1").then(_=>done()).catch(done);
        })
        
        
        it('Test Unknow service',function(done){
            app1.sendRequest("app2","unknown",{
                linkedin_profile:'https://www.linkedin.com.br/in/calebebrim'
            },"jobid=1").then(_=>done()).catch(done);
        })

        it('Test Remote Processing Error',function(){
            app1.onResponse('test',function(message){
                message.should.have.a.property('data')
                message.should.have.a.property('payload')
                message.should.have.a.property('error')
            })
        })

    
    })

    describe('Three apps working',function(){
        before(b)
        after(a)
        var app1,app2,app3;
        it('Initialize App1',function(){
            throw new Error('not implemented')
        })

        it('Initialize App2',function(){
            throw new Error('not implemented')
        })

        it('Initialize App3',function(){
            throw new Error('not implemented')
        })

        it('Send Message app1>app2',function(){
            throw new Error('not implemented');            
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

    describe('produce',function(){
        var hunterco = null
        before(function(){
            var HAPI = require(hapipath)
            hunterco = new HAPI({
                app:'br.com.hunterco.service.linkedin',
                worker:process.pid
            })
        })
        
        it('Sending getProfile Request To Linkedin App',function(done){
            try {
                hunterco.sendRequest({
                    app:"Linkedin",
                    service:"getProfile",
                    data:{
                        linkedin_profile:'https://www.linkedin.com.br/in/calebebrim'
                    },
                    payload:{
                        job_id:1
                    },
                    callback:function(message){

                    }
                })    
                done()
            } catch (err) {
                done(err)
            }
            
        })
        it('Sending message',function(done){
            try {
                //sync 
                hunterco.onResponse('getProfile',function(msg){
                    console.dir(msg.original.payload)
                    console.dir(msg.original.data.linkedin_profile) 
                    console.dir(msg.response.data) 
                    done()
                })    
            } catch (err) {
                done(err)
            }
            
        })
    })
    
    // =================================================
    describe('consume',function(){
        
        var HAPI = require(hapipath);
        var api = null
        before(function(){
            api = new HAPI({
                app:'LinkedinService',
                worker:process.pid
            })
            api.initialize().then(_=>console.log('Hunterco API initialized.'))
        })
    
        it('Consume Request',function(done){
            api.on('getProfile',(message) =>{
                console.log(message.data.linkedin_profile);
                process.nextTick(_=> {
                    message.reply({
                        profile:{data:message.data.linkedin_profile}
                    });
                })
            })
    
        })
    })
    
    
})

