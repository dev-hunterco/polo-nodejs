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
            });
    }

    reset() {
        this.requests = [];
        this.responses = [];
        this.wrong_responses = [];
        this.replyEnabled = true;
    }

    setReplyEnabled(r) {
        this.replyEnabled = r;
    }

    onRequestArrived(message) {
        logger.info(this.name + " - Message received by", this.name, "from", message.sentBy.application);

        // Sempre registra as mensagens recebidas, mesmo quando não processa.
        this.requests.push(message);
        if(this.replyEnabled)
            return message.reply({answer: 'Nice to meet you!'})
        else
            return message.dismiss();
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

    receiveMessages() {
        return this.messagingAPI.readMessages();
    }

    getRequestsReceived() {
        return this.requests;
    }
    getResponsesReceived() {
        return this.responses;
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