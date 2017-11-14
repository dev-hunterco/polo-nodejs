


class API{
    constructor(config){
        if(typeof config === 'string'){
            this.configuration = require(config);
        }else if(typeof config === 'object'){
            this.configuration = config;
        }else if(config || config==null){
            throw new Error('ConfigurationError: Could not handle configuration')
        }
        this.instance = {}
        this.service = {}
        this.startup = new Date();
        this.service.name = this.configuration.app;
        this.instance.id = this.configuration.id
        getQSQarn()
    }

    getSQSarn(){
        throw new Error('getSQSarn not implemented')
    }

    
}



module.exports = API