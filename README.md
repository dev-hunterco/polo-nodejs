# HunterCo Polo Messenger

Polo is a lightweight framework designed to enable exchange of asynchronous messages between applications (usually in a microservice environment).

Message transport is based on AWS SQS (and SNS for events, in the future).

## Anatomy of messages

Polo defines two (very straigforward) types of messages:

* Request: When one application wants to call a service to a second app.
* Response: When the second application sends the first a response 

### Request Message

Here's a sample of a request message:

```
{ 
    id: <message_id>,
    conversation: <conversation_id>,
    type: 'request',
    sentBy: { 
        application: <app id>,
        instance: <app instance>,
        callback: <app queue url> 
    },
    service: <service name>,
    body: <service parameters>,
    payload: <message payload>,
    timestamp: <message timestamp>
}
```

Where:
* message_id: Message's Unique global identifier (created automatically)
* conversation_id: Any identifier that can give context to a set a messages exchanged among many applications and could be used to track all the messages exchanged for a unique event, for exemple. When a application responds a request, it will keep the same conversation id.
* app id: The application's identifier
* app instance: Application's instance identifier (when the app has multiple agents running)
* app queue url: SQS queue url to where responses must be sent.
* service name: the name of the service that source application wants to invoke on target service.
* service parameters: input data for the service.
* message payload: any information relevant for the *source* application (and irrelevant to the target) that must be attached to the response.
* timestamp: when the message was created.

### Response Message

Here's a sample of a response message:

```
{ 
    id: <message_id>,
    conversation: <same as the request>,
    type: 'response',
    sentBy: { 
        application: <app id>,
        instance: <app instance>,
        callback: <app queue url> 
    },
    service: <service name>,
    body: <service parameters>,
    success: <true|false>,
    payload: <message payload>,
    timestamp: <message timestamp>,
    originalMessage: <the content of the request message>
}
```

As you can see, the structure of an answer is quite the same of a request, with some small differences:
* success: True of false if the message has being properly processed or not. It's initially used by the framework to identify invalid messages (with details in the body)
* originalMessage: The request message.

Notice that both conversation and payload will keep the same information found in the request.

# Configuring the API

<pending>

# Exposing a service

The code bellow shows how an application exposes a service:

```
var poloAPI = new PoloMessaging(config);
poloAPI.initializeSQS()
    .then(_ => {
        poloAPI.onRequest ("greetings", function(message) {
            return poloAPI.reply({answer: 'Nice to meet you!'});
        });
    });
```

# Consuming a service

The code bellow shows how an application consumes a service:

```
var poloAPI = new PoloMessaging(config);
// Configure response handler (invoked when a response arrives)
poloAPI.initializeSQS()
    .then(_ => {
        poloAPI.onResponse ("greetings", function(message) {
            return poloAPI.done();
        });
    });

// Send a request
var message = "Hello there... I'm the Requester";
poloAPI.sendRequest("otherApp", "greetings", message);

```

# Processing messages arrived

Polo won't read the queue automatically and the applications (both consumer and producer) must invoke the readMessages methods, as in the example:

```
    setInterval(
        poloAPI.readMessages().then(numOfMessages => {
            console.log(numOfMessages + " processed by PoloAPI.")
        })
        , 1000
    )
```

# Who is Polo

Polo is the Tupi-Guarani god of the winds, messenger of Tupã.