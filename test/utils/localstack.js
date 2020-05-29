/***
 * Gerenciador do Localstack para testes
 */
const { logger } = require('../../src/Logger-Loader')
const spawn = require('child_process').spawn;
const AWS = require('aws-sdk')

// Preinicializa a api da AWS
AWS.config.update({
    "accessKeyId": "foobar",
    "secretAccessKey": "foobar",
    "region": "us-east-1"
});

var instance = null;
var services2start = null;
var isInstanceRunning = false;

function start(opts) {
  return new Promise((resolve, reject) => {
    if(!isInstanceRunning) {
      logger.info("Iniciando o Localstack...");
      instance = spawn('localstack', ['start'], opts);

      // Aguarda pela linha "Ready."
      instance.stdout.on('data', (data) => {
        data.toString().split('\n').filter(l => l.length > 0).forEach(line => {
          logger.info(`stdout: ${line}`);
          if(line === 'Ready.') {
              logger.info("Localstack is ready !");
              isInstanceRunning = true;
              resolve()
          }
        })
      });

      // Saidas na stream de erro
      instance.stderr.on('data', (data) => {
        // data.toString().split('\n').forEach(l => logger.warn(l))
      });
      instance.on('close', (code) => {
        isInstanceRunning = false;
        logger.error(`Localstack has terminated with code: ${code}`);
      });

      // Quantos os testes acabarem, termina o processo também.
      process.on('beforeExit',function(code){
        // stop().then(_ => 
        isInstanceRunning = false
        // );
      })            
    }
    else
      logger.warn("______ LOCALSTACK IS ALREADY RUNNING.... ________");
  });
}

function stop() {
  return new Promise((resolve, reject) => {
    if(isInstanceRunning) {
      logger.info("Finalizando Localstack...");
      instance.kill('SIGINT');     
    }
    else {
      logger.warn("___________ LOCALSTACK ALREADY DEAD !!! _______________");
    }
    resolve();
  });
}

function isRunning() {
  return isInstanceRunning;
}

function getQueues() {
  var conf = {
    endpoint:"http://localhost:4576"
  }
  var sqsAPI = new AWS.SQS(conf);

  return new Promise((resolve, reject) => {
    sqsAPI.listQueues({}, function(err, data) {
      if(err) {
        // reject(err);
        logger.warn("Error listing queues", err.message);
        resolve();
        return;
      }
      if(!data || !data.QueueUrls) {
        resolve();
        return;
      }

      resolve(data.QueueUrls)

    });
  });
}


/*********
 * SQS Functions....
 */
function purgeQueue(queueName) {
  var conf = {
    endpoint:"http://localhost:4576"
  }
  var sqsAPI = new AWS.SQS(conf);

  return new Promise((resolve, reject) => {
    sqsAPI.listQueues({}, function(err, data) {
      if(err) {
        // reject(err);
        logger.warn("Error listing queues", err.message);
        resolve();
        return;
      }
      if(!data || !data.QueueUrls) {
        resolve();
        return;
      }

      resolve(
        Promise.all(
          data.QueueUrls
          .filter(url => !queueName || url.endsWith(queueName))
          .map(u => new Promise((res, rej) => {
            logger.debug('Purging SQS queue ' + u)
            sqsAPI.purgeQueue({ QueueUrl: u }, function(err2, data2) {
                if (err2) rej(err2);
                else res();
            });
        }))
      ));
    });
  });
}

function dispose() {
  if(!!instance)
    return stop()
  else
    return new Promise((res, rej) => res());
}

module.exports = {start, stop, isRunning, getQueues, purgeQueue, dispose };
            
