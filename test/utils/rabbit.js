var amqp = require('amqplib');

async function purgeQueue(queueName) {
  const connection = await amqp.connect("amqp://localhost:5672")
  const channel = await connection.createChannel()

  await channel.assertQueue(queueName)

  const msgDeleted = await channel.purgeQueue(queueName)
  await connection.close()
  return msgDeleted
}

module.exports = { purgeQueue }