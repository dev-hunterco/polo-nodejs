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
    else console.log(data); // successful response
});

var params = {
    QueueUrl: RES
};
sqs.purgeQueue(params, function(err, data) {
    if (err) console.log(err, err.stack); // an error occurred
    else console.log(data); // successful response
});