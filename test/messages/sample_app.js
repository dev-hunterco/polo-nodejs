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
    async initializeQueue() {
        this.messagingAPI = new HunterMessaging(this.config);
        await this.messagingAPI.initializeSQS();
        logger.info("Queue initialized for ", this.name);

        this.messagingAPI.onRequest ("greetings", this.onRequestArrived.bind(this));
        this.messagingAPI.onResponse("greetings", this.onResponseArrived.bind(this));
    }

    async onRequestArrived(message) {
        logger.info("Message received by", this.name, "from", message.sentBy.application);
        this.requests.push(message);

        await message.reply({answer: 'Nice to meet you!'});
        logger.info("Reply sent!");
        console.log("###");
    }

    async onResponseArrived(message) {
        logger.info("Response received by", this.name, "from", message.sentBy.application);

        this.responses.push(message);
        await message.done();
        logger.info("Response processed");
    }

    async sendGreetings(destination, payload) {
        var message = "Hello, " + destination + "... I'm " + this.name;
        await this.messagingAPI.sendRequest(destination, "greetings", message);
        logger.info("Greetings sent!")
    }

    async receiveMessages() {
        await this.messagingAPI.readMessages();
    }


    getRequestsReceived() {
        return this.requests;
    }
    getResponsesReceived() {
        return this.responses;
    }
}

module.exports = SampleApp;