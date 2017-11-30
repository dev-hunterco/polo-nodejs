var Promise = require('promise')

var c = class AWS_Local{
    constructor(config){
        var laws = this;
        
        
        
        
        laws.config = {loadFromPath:function(config){
            return new Promise(function(resolve,reject){
                try {
                    laws.AWS.config.loadFromPath(config.config_path)
                    laws.config = config;    
                    resolve()
                } catch (error) {
                    reject(error)
                }
            })
        }}
    }

}

module.exports = new c();
