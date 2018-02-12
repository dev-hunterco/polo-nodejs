const logger = require('winston')
const PoloMessaging = require('../../src');
const SampleApp = require('./sample_app');

const SampleBroker = class SampleBroker extends SampleApp {
    constructor(name, config) {
        super(name, config);
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

    onRequestArrived(message) {
        this.requests.push(message);
        // Always forward to app2
        return message.forward("App2");
    }

    onResponseArrived(message) {
        throw new Error("Broker should not receive an answer!");
    }
}

module.exports = SampleBroker;