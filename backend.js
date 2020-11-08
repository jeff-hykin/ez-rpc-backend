const express = require('express')
const bodyParser = require('body-parser')
const cors = require('cors')
const { v4: uuidv4 } = require('uuid')
const app = express()
let { network, object } = require("good-js")

module.exports = class EzRpcServer {
    /**
     * Backend server setter-upper
     *
     * @param {Object} arg.port - where do you want the server to run
     * @param {Array} [arg.beforeEachCall] - an array of functions (see README examples)
     * @param {Array} [arg.afterEachCall] - an array of functions (see README examples)
     * @param {Object} [arg.interface] - an object of async functions (see README)
     * @param {Object} [arg.verbosity] - how much logging
     * @return {EzRpcServer}
     *
     * @example
     *     (new EzRpcServer({port: 4321})).start()
     */
    constructor(
        arg = {
            port: 4321,
            beforeEachCall: [],
            afterEachCall: [],
            interface: {},
            limit: '50mb',
            startImmediately: false,
            verbosity: 1,
        }
    ) {
        this.beforeEachCall = arg.beforeEachCall || []
        this.afterEachCall = arg.afterEachCall || []
        this.interface = arg.interface || {}
        this.port = arg.port
        this.app = express()
        this.app.use(cors())
        this.app.use(bodyParser.json({limit: arg.limit, extended: true}))
        this.verbosity = arg.verbosity || 1
        if (arg.startImmediately) {
            this.start()
        }
    }

    async start() {
        // create the interface endpoint (which is needed by the client)
        this.verbosity&&console.log(`setup /interface`)
        this.app.post(`/interface`, (req, res) => {
            let data = req.body
            // tell the requester how the API is laid out
            res.send({ "interface": object.recursivelyAllAttributesOf(this.interface), info: { uuid: uuidv4() } })
            // FUTURE: maybe include setup options
            // FUTURE: maybe include documentation for functions
        })

        let callWrapper = async (endpoint, endpointFunction, req, res) => {
            let error, output
            try {
                var [ args, metadata ] = req.body
                // process the incoming data
                for (let eachMiddlewareFunction of this.beforeEachCall) {
                    await eachMiddlewareFunction({metadata, endpoint, endpointFunction, args, req, res})
                }
                // execute the call 
                output = endpointFunction(args)
                if (output instanceof Promise) {
                    output = await output
                }
            } catch (err) {
                error = err
            }

            try {
                for (let eachMiddlewareFunction of this.afterEachCall) {
                    await eachMiddlewareFunction({ output, error, metadata, endpoint, endpointFunction, args, req, res})
                }
                if (error) {
                    // tell the requester there was an error
                    res.send({
                        error: {
                            endpoint: endpoint.join(".")+"()",
                            arguments: args,
                            stack: error.stack,
                            message: error.message,
                            name: error.name,
                            ...error,
                        },
                    })
                } else {
                    res.send({ value: output })
                }
            // backup error catching system (don't just leave requester waiting on a request-timeout)
            } catch (err) {
                console.error(err)
                res.send({
                    error: {
                        endpoint: endpoint.join(".")+"()",
                        arguments: args,
                        stack: null,
                        message: "There was a problem on the server. The usual error reporting system failed (this is the backup system). Please report whatever error details are available to the owner of the web service.",
                    },
                })
            }
        }

        // create the other endpoints
        for (let endpoint of object.recursivelyAllAttributesOf(this.interface)) {
            // 
            // validate endpoint name
            // 
            let badEndpointName = false
            for (let eachName of endpoint) {
                if (!eachName.match(/^[a-zA-Z_][a-zA-Z_0-9]*$/)){
                    console.warn(`The endpoint '${endpoint.join('/')}' will be ignored. This is because '${eachName}' contains charaters other than the [a-zA-Z_][a-zA-Z_0-9] requirement.`)
                    badEndpointName = true
                    break
                }
            }
            if (badEndpointName) {
                continue
            }
            
            // 
            // setup endpoint
            // 
            let endpointFunction = object.get({ keyList: endpoint, from: this.interface})
            if (endpointFunction instanceof Function) {
                this.verbosity&&console.log(`setup: /call/${endpoint.join("/")}`)

                // create an endpoint
                this.app.post(`/call/${endpoint.join("/")}`, (req, res) => callWrapper(endpoint, endpointFunction, req, res))
            }
        }

        return new Promise(resolve=>{
            this.app.listen(this.port, resolve)
            
            this.verbosity&&console.log(`=======================`)
            this.verbosity&&console.log(` ez-rpc server started`)
            this.verbosity&&console.log(`=======================`)
        })
    }
}