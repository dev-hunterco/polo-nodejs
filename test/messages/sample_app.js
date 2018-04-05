const logger = require('winston')
const PoloMessaging = require('../../src');

const SampleApp = class SampleApp {
    constructor(name, config) {
        // Defaults
        this.name = name;
        config.app = name;
        config.aws.sqs.create = true;
        this.config = config;

        this.reset();
    }

    initializeQueue() {
        this.messagingAPI = new PoloMessaging(this.config);
        return this.messagingAPI.initializeSQS()
        .then(_ => {
                logger.info("Queue initialized for ", this.name);
                this.messagingAPI.onRequest ("greetings", this.onRequestArrived.bind(this));
                this.messagingAPI.onResponse("greetings", this.onResponseArrived.bind(this));

                this.messagingAPI.onRequest ("asyncGreetings", this.onAsyncRequestArrived.bind(this));
                this.messagingAPI.onResponse("asyncGreetings", this.onResponseArrived.bind(this));
            });
    }

    reset() {
        this.requests = [];
        this.responses = [];
        this.pendingResponses = [];
        this.wrong_responses = [];
        this.replyEnabled = true;
    }

    setReplyEnabled(r) {
        this.replyEnabled = r;
    }

    onRequestArrived(message) {
        logger.info(this.name + " - Message received by", this.name, "from", message.sentBy.application);

        // Always collect received messages, even when not processed.
        this.requests.push(message);
        if(this.replyEnabled)
            return message.reply({answer: 'Nice to meet you!'})
        else
            return message.dismiss(); // Stays in queue to process later
    }

    onAsyncRequestArrived(message) {
        logger.info(this.name + " - Message received by", this.name, "from", message.sentBy.application, "- Async Response");

        this.requests.push(message);
        this.pendingResponses.push(message);

        // Won't send an answer but will remove the message from queue
        // Notice that the app should send an async response sometime later.
        return message.done();
    }

    sendAsyncResponse(message) {
        var data = {message: 'It took some time, but here it is...'};
        return this.messagingAPI.sendAsyncResponse(message, data);
    }

    onResponseArrived(message) {
        logger.debug(this.name + " - Response received by", this.name, "from", message.sentBy.application);

        this.responses.push(message);
        return message.done();
    }

    sendGreetings(destination, payload) {
        var message = "Hello, " + destination + "... I'm " + this.name;
        return this.messagingAPI.sendRequest(destination, "greetings", message);
    }

    sendAsyncGreetings(destination, payload) {
        var message = "Hello, " + destination + "... See you later...";
        return this.messagingAPI.sendRequest(destination, "asyncGreetings", message);
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
    getPendingResponses() {
        return this.pendingResponses;
    }

    getWrongResponsesReceived() {
        return this.wrong_responses;
    }

    sendWrong(destination, payload) {
        var message = "Hello, " + destination + "... I'm " + this.name;
        return this.messagingAPI.sendRequest(destination, "wrong_greetings", message);;
    }

    registerWrongHandler() {
        this.messagingAPI.onResponse("wrong_greetings", this.onWrongResponseArrived.bind(this));
    }

    onWrongResponseArrived(message) {
        logger.debug(this.name + " - WRONG Response received by", this.name, "from", message.sentBy.application);

        this.wrong_responses.push(message);
        return message.done();
    }

}

module.exports = SampleApp;