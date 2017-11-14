var AWS = require('aws-sdk');
// Load credentials and set the region from the JSON file
AWS.config.loadFromPath('./config.json');

var REQ = 'https://sqs.us-west-2.amazonaws.com/301779934488/linkedinservices_request',
    RES = 'https://sqs.us-west-2.amazonaws.com/301779934488/linkedinservices_response';

// Create an SQS service object
var sqs = new AWS.SQS({ apiVersion: '2012-11-05' });

max_of_messages = 10;
lock_time = 1;
wait_time = 10;
consume()

function consume() {
    console.log('looking for messages')
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
                data.Messages.forEach(m => {
                    process.nextTick(processMessage, m)
                });
                consume()
            } else {
                consume()
            }
        }
    })
}

function processMessage(message) {
    sqs.deleteMessage({ ReceiptHandle: message.ReceiptHandle, QueueUrl: REQ }, function(err, data) {
        if (err) {
            done(err)
        } else {
            var processed_message = JSON.parse(message.Body)
            processed_message.executed = true;
            var send_params = {
                MessageBody: JSON.stringify(processed_message),
                QueueUrl: RES,
                DelaySeconds: 0
            };
            sqs.sendMessage(send_params, function(err, data) {
                if (err) {
                    console.error(err)
                } else {
                    console.log('message sent: ')
                    console.dir(data)
                    console.dir(processed_message)
                }

            });
        }
    });
}