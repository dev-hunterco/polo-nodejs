var AWS = require('aws-sdk');
// Load credentials and set the region from the JSON file
AWS.config.loadFromPath('./config.json');

var assert = require('assert');
var wait_time = 10;
var lock_time = 1;
var max_of_messages = 10;

var REQ = 'https://sqs.us-west-2.amazonaws.com/301779934488/linkedinservices_request',
    RES = 'https://sqs.us-west-2.amazonaws.com/301779934488/linkedinservices_response';

var sqs = new AWS.SQS({ apiVersion: '2012-11-05' });

var params = {
    QueueUrl: REQ
};
sqs.purgeQueue(params, function(err, data) {
    if (err) console.log(err, err.stack); // an error occurred
    // else console.log(data); // successful response
});

var params = {
    QueueUrl: RES
};
sqs.purgeQueue(params, function(err, data) {
    if (err) console.log(err, err.stack); // an error occurred
    // else console.log(data); // successful response
});



describe('Async page scrapping', function() {
    var scrap_message = {
        _id: Math.random(),
        link: 'http://www.linkedin.com.br/in/linkedin'
    }
    var res_message_id = null;
    before(function() {

    });

    it('Client - schedule one link to scrape', function(done) {


        var send_params = {
            MessageBody: JSON.stringify(scrap_message) /* required */ ,
            QueueUrl: REQ,
            DelaySeconds: 0
        };
        // console.log('Sending Message:');
        // console.dir(scrap_message);
        sqs.sendMessage(send_params, function(err, data) {
            if (err) done(err);
            else {
                if (data.ResponseMetadata.RequestId) {
                    // console.log('Message sent:')
                    // console.dir(data)
                    done();
                }
            }

        });

    }).timeout(60000);

    it('Scrapper - read request and delete', function(done) {
        setTimeout(function() {
            var req_receive_params = {
                QueueUrl: REQ,
                MaxNumberOfMessages: max_of_messages,
                VisibilityTimeout: lock_time,
                WaitTimeSeconds: wait_time
            };
            sqs.receiveMessage(req_receive_params, function(err, data) {
                if (err) {
                    done(err);
                } else {
                    // console.log('receiving Messages:')
                    // console.dir(data)
                    if (data.Messages && data.Messages.length > 0) {
                        data.Messages.filter(m => JSON.parse(m.Body)._id == scrap_message._id).forEach(m => {
                            sqs.deleteMessage({ ReceiptHandle: m.ReceiptHandle, QueueUrl: REQ }, function(err, data) {
                                if (err) {
                                    done(err)
                                } else {
                                    var processed_message = JSON.parse(m.Body)
                                    processed_message.executed = true;
                                    var send_params = {
                                        MessageBody: JSON.stringify(processed_message),
                                        QueueUrl: RES,
                                        DelaySeconds: 0
                                    };
                                    sqs.sendMessage(send_params, function(err, data) {
                                        if (err) {
                                            done(err)
                                        } else {
                                            if (data.ResponseMetadata.RequestId) {
                                                res_message_id = data.MessageId
                                                done();
                                            } else {
                                                done(new Error('ResponseMetadada.RequestId does not exists'))
                                            }
                                        }

                                    });
                                }
                            });
                        })

                    } else {
                        done(new Error('data does not have message'));
                    }
                }
            });
        }, 1000);
    }).timeout((wait_time + lock_time) * 1000)

    it('Client - read the response', function(done) {
        setTimeout(() => {
            var req_receive_params = {
                QueueUrl: RES,
                MaxNumberOfMessages: max_of_messages,
                VisibilityTimeout: lock_time,
                WaitTimeSeconds: wait_time
            };
            sqs.receiveMessage(req_receive_params, function(err, data) {
                if (err) {
                    done(err);
                } else {
                    if (data.Messages && data.Messages.length > 0) {
                        var messages = data.Messages.filter(function(m) { //filter desired messages
                            return m.MessageId === res_message_id
                        });
                        // console.log(res_message_id)
                        // console.dir(data)

                        if (messages && messages.length > 0) {
                            sqs.deleteMessageBatch({ Entries: messages }, function(err, data) { //delete filtered messages
                                done()
                            })

                        } else {
                            done(new Error('Could not find the message on the queue'))
                        }
                    } else {
                        done(new Error('Does not have messages on response queue'))
                    }
                }
            })
        }, 1000);
    }).timeout((wait_time + lock_time) * 1000)
})