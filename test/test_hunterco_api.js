require('should')
var hapipath = '../huntercoServices.js',
    aws_config_file_path = '../config.json'
describe.only('general',function(){
    describe('configure',function(){
        it('configure happy path',function(done){
            var HAPI = require(hapipath)
            try {
                new HAPI({
                    app:"br.com.hunterco.service.peoplesearch",
                    worker:process.id,
                    aws:aws_config_file_path
                })
                new HAPI({
                    app:"br.com.hunterco.service.peoplesearch",
                    worker:process.id
                })
                done()
            } catch (error) {
                done(error)
            }
        });

        

        it('Test random app identifier',function(done){
            var HAPI = require(hapipath)
            try {
                new HAPI({
                    app:""+Math.random(),
                    worker:process.id
                })
                done(new Error('Random app string is not permitted'))
            } catch (error) {
                error.should.be.an.instanceOf(Error)
                error.should.have.property('message','whrong app type. Use hunterco.')
                done() //should start error
            }
        })

        it('Test missing id error',function(done){
            var HAPI = require(hapipath)
            try {
                new HAPI({
                    app:'br.com.hunterco.service.linkedin'
                })
                done(new Error('Random app string is not permitted'))
            } catch (error) {
                error.should.be.an.instanceOf(Error)
                error.should.have.property('message','Worker identification is not defined')
                done() //should start error
            }
        })
    })

    describe('produce',function(){
        var hunterco = null
        before(function(){
            var HAPI = require(hapipath)
            new HAPI({
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
        
        before(function(){
            var HAPI = require(hapipath);
            new HAPI({
                app:'LinkedinService',
                worker:process.pid
            })
        })
    
        it('Consume Request',function(done){
            hunterco.on('getProfile',(message) =>{
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

