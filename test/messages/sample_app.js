const logger = require('winston')
const HunterMessaging = require('../../src/main.js').messages;

const SampleApp = class SampleApp {
    constructor(name, config) {
        // Defaults
        this.name = name;
        config.app = name;
        config.aws.sqs.create = true;
        this.config = config;

        this.requests = [];
        this.responses = [];
    }
    initializeQueue() {
        this.messagingAPI = new HunterMessaging(this.config);
        return this.messagingAPI.initializeSQS()
        .then(_ => {
                logger.info("Queue initialized for ", this.name);
                this.messagingAPI.onRequest ("greetings", this.onRequestArrived.bind(this));
                this.messagingAPI.onResponse("greetings", this.onResponseArrived.bind(this));
            });
    }

    onRequestArrived(message) {
        logger.info(this.name + " - Message received by", this.name, "from", message.sentBy.application);

        this.requests.push(message);
        return message.reply({answer: 'Nice to meet you!'})
    }

    onResponseArrived(message) {
        logger.info(this.name + " - Response received by", this.name, "from", message.sentBy.application);

        this.responses.push(message);
        return message.done();
    }

    sendGreetings(destination, payload) {
        var message = "Hello, " + destination + "... I'm " + this.name;
        return this.messagingAPI.sendRequest(destination, "greetings", message);;
    }

    receiveMessages() {
        return this.messagingAPI.readMessages();
    }


    getRequestsReceived() {
        return this.requests;
    }
    getResponsesReceived() {
        return this.responses;
    }
}

module.exports = SampleApp;