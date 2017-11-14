var AWS = require('aws-sdk');
// Load credentials and set the region from the JSON file
AWS.config.loadFromPath('./config.json');

var assert = require('assert');
var wait_time = 1;
var lock_time = 1;
var max_of_messages = 10;

var REQ = 'https://sqs.us-west-2.amazonaws.com/301779934488/linkedinservices_request',
    RES = 'https://sqs.us-west-2.amazonaws.com/301779934488/linkedinservices_response';

var sqs = new AWS.SQS({ apiVersion: '2012-11-05' });

describe('Send and Receive Message', function() {
    var message_body = 'corpo da mensagem' + Math.random();
    var messageId = null
        // after(function() {
        //     var receive_params = {
        //         QueueUrl: REQ /* required */ ,
        //         MaxNumberOfMessages: max_of_messages,
        //         VisibilityTimeout: lock_time,
        //         WaitTimeSeconds: wait_time
        //     };
        //     sqs.receiveMessage(receive_params, function(err, data) {
        //         if (err) {
        //             // console.log(err, err.stack); // an error occurred
        //             console.error(err);
        //         } else {
        //             if (data.Messages && data.Messages.length > 0) {
        //                 sqs.deleteMessageBatch({ Entries: data.Messages.map(m => { return { Id: m.MessageId, ReceiptHandle: m.ReceiptHandle } }), QueueUrl: REQ }, function(err, data) {
        //                     if (err) console.error(err);
        //                 });
        //             } else {
        //                 console.log('There is no message to delete on request queue.')
        //             }
        //         }
        //     });

    //     var receive_params = {
    //         QueueUrl: RES /* required */ ,
    //         MaxNumberOfMessages: max_of_messages,
    //         VisibilityTimeout: lock_time,
    //         WaitTimeSeconds: wait_time
    //     };
    //     sqs.receiveMessage(receive_params, function(err, data) {
    //         if (err) {
    //             // console.log(err, err.stack); // an error occurred
    //             console.error(err);
    //         } else {
    //             if (data.Messages && data.Messages.length > 0) {
    //                 sqs.deleteMessageBatch({ Entries: data.Messages.map(m => { return { Id: m.MessageId, ReceiptHandle: m.ReceiptHandle } }), QueueUrl: REQ }, function(err, data) {
    //                     if (err) console.error(err);
    //                 });
    //             } else {
    //                 console.log('There is no message to delete on response queue.')
    //             }
    //         }
    //     });
    // });

    var receive_params = {
        QueueUrl: REQ /* required */ ,
        MaxNumberOfMessages: max_of_messages,
        VisibilityTimeout: lock_time,
        WaitTimeSeconds: wait_time
    };

    it('Send Message', function(done) {
        setTimeout(() => {
            var send_params = {
                MessageBody: message_body /* required */ ,
                QueueUrl: REQ /* required */ ,
                DelaySeconds: 0
            };
            sqs.sendMessage(send_params, function(err, data) {
                if (err) {
                    console.log(err, err.stack); // an error occurred
                    done(err)
                } else {
                    // console.log();
                    if (data.ResponseMetadata.RequestId) {

                        done();
                    } else {
                        done(new Error('ResponseMetadada.RequestId does not exists'))
                    }
                } // successful response

            });

        }, lock_time);
    }).timeout(10000);

    it('Has messages', function(done) {
        setTimeout(() => {
            sqs.receiveMessage(receive_params, function(err, data) {
                if (err) done(err)
                else {

                    if (data.Messages && data.Messages.length > 0) {
                        var messages = data.Messages.filter(function(message) {
                            return message.messageId == messageId;
                        });
                        if (messages && messages.length > 0) {
                            done()
                        } else {
                            done(new Error('Produced Message Not Found'))
                        }

                    } else {
                        done(new Error('There is no message'));
                    }
                }
            });

        }, lock_time * 1000);
    }).timeout(10000);


    it('Delete messages', function(done) {
        setTimeout(function() {
            sqs.receiveMessage(receive_params, function(err, data) {
                if (err) {
                    done(err);
                } else {
                    if (data.Messages && data.Messages.length > 0) {
                        sqs.deleteMessageBatch({ Entries: data.Messages.map(m => { return { Id: m.MessageId, ReceiptHandle: m.ReceiptHandle } }), QueueUrl: REQ }, function(err, data) {
                            if (err) done(err);
                            else done()
                        });
                    } else {
                        done(new Error('Data does not have message'));
                    }
                }
            });
        }, lock_time * 1000);
    }).timeout(10000);

    it('Should not have message', function(done) {
        setTimeout(function() {
            sqs.receiveMessage(receive_params, function(err, data) {
                if (err) {
                    done(err);
                } else {
                    if (data.Messages) {
                        done(new Error(`Data has ${data.Messages.length} items on the list.`));
                    } else {
                        done()
                    }
                }
            })
        }, lock_time * 1000);
    }).timeout(10000)
});