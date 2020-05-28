require('should')

const SAMPLE_CONFIG = require('../sample_conf.json')
const rabbitUtils = require('../utils/rabbit')

describe('SQS Transporter',function() {  
  const SQSTransporter = require('../../src/SQS-Manager').SQSTransporter
  const localstackUtils = require('../utils/localstack')

  it('Send and Get Messages', async function() {
    // Initialize it
    const transporter = new SQSTransporter()
    transporter.initialize(SAMPLE_CONFIG)

    // Initialize Queue
    await transporter.initializeQueue()

    transporter.queueName.should.be.not.null()
    transporter.queueURL.should.be.not.null()

    let queues = await localstackUtils.getQueues()
    const expectedQueue = `http://localhost:4576/queue/${SAMPLE_CONFIG.app}_${SAMPLE_CONFIG.stage}`
    queues.should.containDeep([expectedQueue])

    // Send a message
    const message = {
      id: 'msg-1',
      conversation: 'conversation-1',
      type: "request",
      sentBy: {
        application: SAMPLE_CONFIG.app,
        instance: SAMPLE_CONFIG.worker,
      },
      service: 'MyService',
      body: { greetings: 'Hello everybody! '},
      timestamp: new Date()
    }

    await transporter.sendMessage('Other_App', message)
    // Should have created another Queue
    queues = await localstackUtils.getQueues()
    const expectedReceiver = `http://localhost:4576/queue/Other_App_${SAMPLE_CONFIG.stage}`
    queues.should.containDeep([expectedReceiver])

    // Get Message from other app's queue
    const targetTransporter = new SQSTransporter()
    const newConf = Object.assign({}, SAMPLE_CONFIG, {app: 'Other_App'})
    targetTransporter.initialize(newConf)
    await targetTransporter.initializeQueue()

    const messages = []
    await targetTransporter.readMessages(null, msg => {
      messages.push(msg)
    })
    messages.length.should.be.eql(1)

    const msgBody = JSON.parse(messages[0].Body)
    msgBody.id.should.be.eql('msg-1')
    msgBody.sentBy.application.should.be.eql(SAMPLE_CONFIG.app)
    msgBody.body.greetings.should.be.eql(message.body.greetings)

    await transporter.close()
    await targetTransporter.close()
  });
})

describe('AMQP Transporter',function() {  
  const AMQPTransporter = require('../../src/AMQP-Manager').AMQPTransporter
  const localstackUtils = require('../utils/localstack')

  before(function() {
    const knownQueues = ['TestApp_test', 'Other_App_test']
    // clean queues. Since there's no method to inspect queues, uses a hardcoded list
    return Promise.all(knownQueues.map(q => rabbitUtils.purgeQueue(q)))
  })

  it('Send and Get Messages', async function() {
    // Initialize it
    const transporter = new AMQPTransporter()
    transporter.initialize(SAMPLE_CONFIG)

    // Initialize Queue
    await transporter.initializeQueue()

    // Send a message
    const message = {
      id: 'msg-1',
      conversation: 'conversation-1',
      type: "request",
      sentBy: {
        application: SAMPLE_CONFIG.app,
        instance: SAMPLE_CONFIG.worker,
      },
      service: 'MyService',
      body: { greetings: 'Hello everybody! '},
      timestamp: new Date()
    }
    await transporter.sendMessage('Other_App', message)

    // Get Message from other app's queue
    const targetTransporter = new AMQPTransporter()
    const newConf = Object.assign({}, SAMPLE_CONFIG, {app: 'Other_App'})
    targetTransporter.initialize(newConf)
    await targetTransporter.initializeQueue()

    const messages = []
    await targetTransporter.readMessages(null, msg => {
      messages.push(msg)
    })
    messages.length.should.be.eql(1)

    const msgBody = JSON.parse(messages[0].Body)
    msgBody.id.should.be.eql('msg-1')
    msgBody.sentBy.application.should.be.eql(SAMPLE_CONFIG.app)
    msgBody.body.greetings.should.be.eql(message.body.greetings)

    await transporter.close()
    await targetTransporter.close()
  });
})
