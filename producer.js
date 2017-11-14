// Load the AWS SDK for Node.js
var AWS = require('aws-sdk');
// Load credentials and set the region from the JSON file
AWS.config.loadFromPath('./config.json');

var REQ = 'https://sqs.us-west-2.amazonaws.com/301779934488/linkedinservices_request',
    RES = 'https://sqs.us-west-2.amazonaws.com/301779934488/linkedinservices_response';

// Create an SQS service object
var sqs = new AWS.SQS({ apiVersion: '2012-11-05' });


var scrap_message = {
    _id: Math.random(),
    link: 'http://www.linkedin.com.br/in/linkedin'
}

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
            console.log('Message sent:')
            console.dir(data)
            console.dir(scrap_message)
        }
    }

})
var max_of_messages = 1,
    lock_time = 3,
    wait_time = 10;
getResponse();

function getResponse() {
    console.log('looking for response');
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
            console.log('Receiving Messages:')
            console.dir(data)
            if (data.Messages && data.Messages.length > 0) {
                var messages = data.Messages.filter(m => JSON.parse(m.Body)._id == scrap_message._id)
                if (messages.length > 0) {
                    console.log('message received!');
                    messages.forEach(m => {
                        sqs.deleteMessage({ ReceiptHandle: m.ReceiptHandle, QueueUrl: RES }, function(err, data) {
                            if (err) console.error(err)
                            else {
                                console.log('message consumed from response queue.')
                                console.dir(data)
                            }
                        })
                    })
                } else {
                    console.log('none message...')
                    getResponse()
                }

            } else {
                getResponse()
            }
        }
    });
}