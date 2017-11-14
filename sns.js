
var AWS = require('aws-sdk');
AWS.config.loadFromPath('./config.json');
var http = require('http');
var bodyParser = require('body-parser')

var sns = new AWS.SNS({ apiVersion: '2010-03-31' });
var sqs = new AWS.SQS({ apiVersion: '2012-11-05' });
var ngrok = require('ngrok');
var express = require('express');


var ngrok_token = '3N7PDXyBsB91Nw4rFFr43_2DsJBeN6oWnUwsfAB6SJ7';
var PlatformApplicationArn = null;
var topicArn = '',
    urlEndPoint = '',
    subscriptionArn = '';

var server;
var server_port = 9090;

createHook((err, url) => {
    if(!err){
        createServer((err)=>{   
            if(!err){
                creatingTopic((err)=>{
                    if(!err){
                        subscribingTopic((err)=>{
                            if(!err){
                                publishMessage('test message',(err)=>{
    
                                })
                            }
                        })
                    }
                })
            }
        });
    }
});

module.exports = {
    createHook: createHook,
    createServer: createServer,
    creatingTopic: creatingTopic,
    subscribingTopic: subscribingTopic,
    publishMessage: publishMessage

}

function createHook(cb) {
    process.nextTick(function() {
        ngrok.connect({
                addr: server_port,
                token: ngrok_token
            }, function(err, url) {
                if (err) {
                    if (cb) cb(err, null)
                    else console.error(err);
                } else {
                    console.log('URL: ', url)
                    urlEndPoint = url;
                    if (cb) cb(null, url)


                }



            }) // https://757c1652.ngrok.io -> http://localhost:serverport
    });

}


function createServer(cb) {
    console.log('Creating server at port: ', server_port)
    var app = express();
    app.use(function(req, res, next) {
        if (req.headers['x-amz-sns-message-type']) {
            req.headers['content-type'] = 'application/json;charset=UTF-8';
        }
        next();
    })
    app.use(bodyParser.urlencoded({ extended: false }))
    app.use(bodyParser.json())
    

    app.get('/', function(req, res) {
        res.send('Get: Hello World')
    })

    app.post('/', function(req, res) {
        // console.dir(req)
        if(req.headers['x-amz-sns-message-type']==='SubscriptionConfirmation'){
            if(req.headers['x-amz-sns-topic-arn'] === topicArn){
                console.log(`Subscription to ${topicArn} received`)
                console.log('Answer subscription',req.body.SubscribeURL)
                https.get(req.body.SubscribeURL, (res) => {
                    console.log('Subscription response: ')
                    console.dir(res)
                   
                });
            }
        }

    })

    server = app.listen(server_port);
    cb()
}


function creatingTopic(cb) {
    console.log('Creating: test topic')
    var params = {
        Name: 'test_topic' /* required */
    };
    sns.createTopic(params, function(err, data) {
        if (err) {
            console.log(err, err.stack); // an error occurred
            cb(err)
        } else {
            console.log(data); // successful response
            topicArn = data.TopicArn
            cb()
        }

    });
}

function subscribingTopic(cb) {
    console.log('Subscribing to a topic');
    var params = {
        Protocol: 'https',
        /* required */
        TopicArn: topicArn,
        /* required */
        Endpoint: urlEndPoint
    };
    sns.subscribe(params, function(err, data) {
        if (err) {
            console.log(err, err.stack); // an error occurred
            cb(err)
        } else{
            console.log(data); // successful response
            subscriptionArn = data.SubscriptionArn
            cb()
        }
    });
}


function publishMessage(message,cb) {
    console.log('Send Message');
    var params = {
        Message: message,

        Subject: 'Test Message',
        TopicArn: topicArn
    };
    sns.publish(params, function(err, data) {
        if (err){
            console.log(err, err.stack); // an error occurred
            cb(err)
        }else{
            console.log(data); // successful response
            cb()
        }
    });
}







process.on('exit', (code) => {
    console.log(`About to exit with code: ${code}`);
});


process.on('SIGINT', function() {
    console.log("Caught interrupt signal");
    console.log('Start termination procedure');
    var validation = [];
    function validate() {
        if(validation.reduce((a,b)=>a+b,0)==3)
            process.exit();
    }
    deleteSubscription(_ =>{
        validation[0]=1;
        validate();
    });
    deleteTopic(_ =>{
        validation[1]=1;
        validate();
    });
    serverShootDown(_ =>{
        validation[2]=1;
        validate();
    });
});

function serverShootDown(cb){
    console.warn('Shutting down server at: ',server_port)
    server.close();
    cb()
}

function deleteSubscription(cb){
    console.warn('Deleting subscriptions')
    var params = {
        SubscriptionArn: subscriptionArn
    };
    sns.unsubscribe(params, function(err, data) {
        if (err) console.log(err, err.stack); // an error occurred
        else     console.log(data);           // successful response
        cb()
    });
}

function deleteTopic(cb){
    console.warn('Deleting topics')
    var params = {
        TopicArn: topicArn /* required */
    };
    sns.deleteTopic(params, function(err, data) {
        if (err) console.log(err, err.stack); // an error occurred
        else     console.log(data);           // successful response
        cb()
    });
}