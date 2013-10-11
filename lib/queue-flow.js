// queue-flow Copyright (C) 2012-2013 by David Ellis
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

var isAsync = require('is-async');
var EventEmitter = require('async-cancelable-events');
var util = require('util');

var nextTick = global.setImmediate ? global.setImmediate : process.nextTick;

var q;

// Determines if this queue has a name, and either finds or returns said named queue,
// or decides it's an unnamed queue and returns said queue.
function qFunc(nameOrArray, QType) {
    QType = QType || this.q.defaultQ;
    if(typeof(nameOrArray) === "string") {
        if(!this.namedQueues[nameOrArray]) {
            this.namedQueues[nameOrArray] = new QType(nameOrArray, this.q);
        }
        return this.namedQueues[nameOrArray];
    } else if(nameOrArray instanceof Array) {
        return new QType(nameOrArray, this.q);
    } else if(nameOrArray instanceof Object &&
        typeof(nameOrArray.pipe) === 'function' &&
        typeof(nameOrArray.on) === 'function') {
        var newQ = new QType(undefined, this.q);
        nameOrArray.on('data', newQ.push.bind(newQ));
        nameOrArray.on('end', newQ.close.bind(newQ));
        return newQ;
    } else {
        return new QType(undefined, this.q);
    }
}

// `exists` returns whether or not a named queue exists in
function exists(queueName) {
    return !!this.namedQueues[queueName] && typeof(this.namedQueues[queueName]) === 'object';
}

// `clearQueue` removes a queue from a q environment
function clearQueue(nameOrQueue) {
    if(typeof(nameOrQueue) === 'string') {
        if(this.namedQueues[nameOrQueue]) delete this.namedQueues[nameOrQueue];
    } else {
        Object.keys(this.namedQueues).forEach(function(name) {
            if(this.namedQueues[name] === nameOrQueue) delete this.namedQueues[name];
        }.bind(this));
    }
}

// `addQueue` adds a queue to a q environment
function addQueue(name, queue) {
    this.namedQueues[name] = queue;
}

// `makeAsync` and `makeSync` helper methods allow a more fluent API to force
// async or sync methods, suggested by a colleague, and fits better in the
// `queue-flow` API.
function makeAsync(qfMethod) {
    return function() {
        return qfMethod.apply(this,
            Array.prototype.slice.call(arguments, 0).map(function(arg) {
                if(arg instanceof Function) arg.async = true;
                return arg;
            })
        );
    };
}

function makeSync(qfMethod) {
    return function() {
        return qfMethod.apply(this,
            Array.prototype.slice.call(arguments, 0).map(function(arg) {
                if(arg instanceof Function) arg.sync = true;
                return arg;
            })
        );
    };
}

// `tuple` converts an object into an array of arrays. The arrays are tuples of the
// key-value pairs from the object, so they can be processed individually in a queue-flow
// if desired, rather than considering the whole object as a single item in the queue.
function tuple(obj) {
    return Object.keys(obj).reduce(function(outArr, key) { return outArr.concat([[key, obj[key]]]); }, []);
}

// ## The `Q` constructor function, which either uses the supplied queueing engine, or
// uses the built-in in-memory engine.
function Q(nameOrArray, namespace) {
    EventEmitter.call(this);
    this.namespace = namespace;

    // Private variables, the handlers and actual queue array
    this.wasName = nameOrArray instanceof Array ? false : true;
    var queue = this.queue = nameOrArray instanceof Array ? nameOrArray : [];
    var handler = function() {};
    var handlerSet = false;
    var handlerBusy = false;
    var recentlyEmptied = false;

    // Privileged methods

    // `setHandler` defines the special function to call to process the queue
    // assumed to be ready initially, when called marked busy, call provided callback to
    // mark ready again.
    this.setHandler = function setHandler(handlerFunc) {
        handler = handlerFunc;
        handlerSet = true;
        if(!handlerBusy) handlerCallback(function() {});
        return this;
    }.bind(this);

    // Eliminate the need for all the binds in the handlerCallback
    var handlerEmitter = this.emit.bind(this);
    var handlerRuns = 0;
    function handlerCall() {
        handler(queue.shift(), handlerCallback);
    }

    // The `handlerCallback` is provided to the handler along with the dequeued value.
    // If there is more work to be done, it continues, otherwise is marks the handler
    // as ready for when the data next arrives
    var handlerCallback = function handlerCallback(done) {
        done();
        handlerBusy = false;
        if(queue && queue.length > 0) {
            handlerRuns = handlerRuns % 50;
            if(handlerRuns) {
                handlerRuns++;
                handlerBusy = true;
                handlerCall();
            } else {
                handlerRuns++;
                handlerBusy = true;
                nextTick(handlerCall);
            }
        } else if(!recentlyEmptied) {
            handlerEmitter('empty');
            recentlyEmptied = true;
        }
    };

    // Inserts a specified value into the queue, if allowed by the event handlers, and
    // calls the special handler function, if it's ready.
    this.push = function push() {
        recentlyEmptied = false;
        var values = Array.prototype.slice.call(arguments, 0);
        this.emitSync('push', values);
        Array.prototype.push.apply(queue, values);
        if(handlerSet && !handlerBusy) handlerCallback(function() {});
        return this;
    }.bind(this);
    // `write` is a synonym for `push` so a queue can be treated as a writeable stream
    this.write = this.push;
    // For node 0.6 and 0.8 compatibility, listen for the `pipe` event and register
    // an event handler to call `push`
    this.on('pipe', function(piper) {
        piper.on('data', this.push);
    }.bind(this));

    this.pushOne = function pushOne(val) {
        recentlyEmptied = false;
        this.emitSync('push', [val]);
        queue.push(val);
        if(handlerSet && !handlerBusy) handlerCallback(function() {});
        return this;
    }.bind(this);

    // Signals that the queue is being destroyed and then, if allowed, destroys it
    this.close = function close() {
        this.emit('close', function(result) {
            if(result) {
                // Stop accepting new items so the queue can actually close
                // if processing time is slower than newly enqueued values come in
                this.removeAllListeners('push');
                this.on('push', function() { return false; });
                // Whatever made it into the queue at this point in time, allow it to be
                // processed and de-queued.
                var flushQueue = function() {
                    var tempHandler = handler;
                    handlerSet = false;
                    handler = function() {};
                    queue = undefined;
                    this.push = this.pushOne = function() { throw new Error('Queue already closed'); };
                    if(namespace) namespace.clearQueue(this);
                    if(tempHandler instanceof Function) {
                        tempHandler('close');
                    }
                }.bind(this);
                if(!handlerBusy && queue && !queue.length) flushQueue();
                if(handlerBusy || (queue && queue.length)) {
                    this.removeAllListeners('empty');
                    this.on('empty', flushQueue);
                }
            }
        }.bind(this));
        return this;
    }.bind(this);
    // `end` is a synonym for `close` so a queue can be treated as a writeable stream
    this.end = this.close;

    //  Kills the queue (and all sub-queues) immediately, no possibility of blocking
    // with an event handler.
    this.kill = function kill() {
        this.emit('kill');
        var tempHandler = handler;
        handlerSet = false;
        handler = function() {};
        queue = undefined;
        this.push = this.pushOne = function() { throw new Error('Queue already closed'); };
        if(namespace) namespace.clearQueue(this);
        if(tempHandler instanceof Function) {
            tempHandler('kill');
        }
    }.bind(this);

    // Start processing the queue after the next JS event loop cycle and return the queue
    // object to the remaining code.
    if(handlerSet && !handlerBusy) handlerCallback(function() {});
    if(queue.length > 0) this.on('empty', this.close);
    return this;
}

util.inherits(Q, EventEmitter);

// ## `Q` prototype methods, the methods to be most commonly used by users of `queue-flow`

// `as` names or aliases the given queue
Q.prototype.as = function as(name) {
    if(this.namespace) this.namespace.addQueue(name, this);
    return this;
};

// `concat` is a simpler wrapper around `push` that takes a single array
// and covers up the relatively nasty `apply` mechanism (when dealing with
// queue-flow's particular object model. Getting the *queue-flow* object
// requires `q('nameHere')` and `q('nameHere').push.apply(q('nameHere'), array)`
// is ugly and verbose.
Q.prototype.concat = function concat(array) {
    this.push.apply(this, array);
    return this;
};

// `each` creates an output queue that simply copies the input queue results,
// while also passing these results to the provided callback for side-effect
// purposes. The output queue is so the data is not destroyed by the `each`
// method.
Q.prototype.each = function each(callback) {
    var outQueue = new this.constructor(null, this.namespace);
    this.setHandler(function(value, next) {
        if(!next) {
            outQueue[value]();
        } else {
            if(isAsync(callback, 2)) {
                callback(value, function() {
                    next(outQueue.push.bind(outQueue, value));
                });
            } else {
                callback(value);
                next(outQueue.push.bind(outQueue, value));
            }
        }
    });
    return outQueue;
};
Q.prototype.eachAsync = makeAsync(Q.prototype.each);
Q.prototype.eachSync = makeSync(Q.prototype.each);

// `wait` is a no-op `each` that simply delays the queue by a specified amount
// or by the amount specified by the callback function (if the argument is a
// function instead of a number). This is useful for ratelimiting queues that
// otherwise hammer an external service.
Q.prototype.wait = function wait(delay) {
    return this.each(function(val, callback) {
        if(typeof(delay) === 'function') {
            if(isAsync(delay, 2)) {
                delay(val, function(delay) {
                    setTimeout(callback, delay);
                });
            } else {
                setTimeout(callback, delay(val));
            }
        } else {
            setTimeout(callback, delay);
        }
    });
};
Q.prototype.waitAsync = makeAsync(Q.prototype.wait);
Q.prototype.waitSync = makeSync(Q.prototype.wait);

// `inOut` is a helper function used by several of the Q prototype methods that
// take an input queue and produce an output queue.
var inOut = function inOut(outQueue, setter, callback) {
    this.setHandler(function(value, next) {
        if(!next) {
            outQueue[value]();
        } else {
            if(isAsync(callback, 2)) {
                callback(value, function(result) {
                    next(setter.bind(this, value, result));
                });
            } else {
                next(setter.bind(this, value, callback(value)));
            }
        }
    });
    return outQueue;
};

// `map` creates an output queue, and executes
// the given callback on each value, pushing the
// result into the output queue before continuing
// to process the input queue
Q.prototype.map = function map(callback) {
    var outQueue = new this.constructor(null, this.namespace);
    if(isAsync(callback, 2)) {
        this.setHandler(function(value, next) {
            if(!next) {
                outQueue[value]();
            } else {
                callback(value, function(result) {
                    next(function() {
                        outQueue.pushOne(result);
                    });
                });
            }
        });
    } else {
        this.setHandler(function(value, next) {
            if(!next) {
                outQueue[value]();
            } else {
                next(function() {
                    outQueue.pushOne(callback(value));
                });
            }
        });
    }
    return outQueue;
};
Q.prototype.mapAsync = makeAsync(Q.prototype.map);
Q.prototype.mapSync = makeSync(Q.prototype.map);

// `reduce` creates an output variable, and executes once upstream has
// `close()`d, it does one of three things, depending on the value of
// `last`: if undefined it returns an anonymous queue and pushes that
// sole result into the queue and closes it immediately. If `last` is
// a string, it pushes that result into the named queue. If `last` is
// a function, it does not create a queue and instead calls `last` with
// the `out` value.
Q.prototype.reduce = function reduce(callback, last, initial) {
    var out = initial;
    var outQueue;
    if(!last) outQueue = new this.constructor(null, this.namespace);
    this.setHandler(function(value, next) {
        if(!next) {
            if(!!last && last instanceof Function) last(out);
            if(!!last && typeof(last) === 'string') q(last).push(out);
            if(!last) {
                outQueue.push(out);
                outQueue[value]();
            }
        } else {
            if(isAsync(callback, 3)) {
                callback(out, value, function(result) {
                    next(function() {
                        out = result;
                    });
                });
            } else {
                next(function() {
                    out = callback(out, value);
                });
            }
        }
    }.bind(this));
    return outQueue || this;
};
Q.prototype.reduceAsync = makeAsync(Q.prototype.reduce);
Q.prototype.reduceSync = makeSync(Q.prototype.reduce);

// `filter` creates an output queue, and executes
// the given callback on each value, pushing the
// original value *only* if the callback returns true.
Q.prototype.filter = function filter(callback) {
    var outQueue = new this.constructor(null, this.namespace);
    return inOut.bind(this)(outQueue, function filterSetter(value, result) {
        if(result) outQueue.push(value);
    }, callback);
};
Q.prototype.filterAsync = makeAsync(Q.prototype.filter);
Q.prototype.filterSync = makeSync(Q.prototype.filter);

// `branch` pushes values from the queue into another queue. If that name
// is provided directly to `branch` it will always push to that named queue.
// If a reference to the queue itself is provided branch it will push to that
// particular queue. If a function is provided, it will provide it with each
// value in the queue and expect to be returned the name, reference, or array
// of either to push the value into.
Q.prototype.branch = function branch(callback) {
    var self = this;
    this.setHandler(function(value, next) {
        function queueProcessor(queue) {
            if(typeof(queue) === 'string') {
                self.namespace(queue).push(value);
            } else if(typeof(queue) === 'object' && !!queue.push) {
                queue.push(value);
            }
        }
        if(!!next) {
            if(typeof(callback) === 'function' && isAsync(callback, 2)) {
                callback(value, function(result) {
                    next(function() {
                        if(result instanceof Array) {
                            result.forEach(queueProcessor);
                        } else {
                            queueProcessor(result);
                        }
                    });
                });
            } else if(typeof(callback) === 'function') {
                var result = callback(value);
                next(function() {
                    if(result instanceof Array) {
                        result.forEach(queueProcessor);
                    } else {
                        queueProcessor(result);
                    }
                });
            } else if(callback instanceof Array) {
                next(function() {
                    callback.forEach(queueProcessor);
                });
            } else {
                next(function() {
                    queueProcessor(callback);
                });
            }
        }
    });
    return this;
};
Q.prototype.branchAsync = makeAsync(Q.prototype.branch);
Q.prototype.branchSync = makeSync(Q.prototype.branch);

// `everySome` helper function that is used to implement `Q.prototype.every`
// and `Q.prototype.some`, similar to `reduce`, the behavior of `everySome`
// will change whether `last` is a function, a string, or falsy.
var everySome = function everySome(polarity, callback, last) {
    var outQueue;
    if(!last) outQueue = new this.constructor(null, this.namespace);
    function shortCircuit(value, next) { if(!!next) next(function() {}); }
    this.setHandler(function(value, next) {
        if(!next) {
            if(!last) {
                outQueue.push(!polarity);
                outQueue.close();
            }
            if(!!last && last instanceof Function) last(!polarity); // Reverse the polarity on the deflector shield!
            if(!!last && typeof(last) === 'string') q(last).push(!polarity);
        } else {
            if(isAsync(callback, 2)) {
                callback(value, function(result) {
                    next(function() {
                        if(result === polarity) {
                            this.setHandler(shortCircuit);
                            if(!last) {
                                outQueue.push(polarity);
                                outQueue.close();
                            }
                            if(!!last && last instanceof Function) last(polarity);
                            if(!!last && typeof(last) === 'string') q(last).push(polarity);
                        }
                    }.bind(this));
                }.bind(this));
            } else {
                next(function() {
                    if(callback(value) === polarity) {
                        this.setHandler(shortCircuit);
                        if(!last) {
                            outQueue.push(polarity);
                            outQueue.close();
                        }
                        if(!!last && last instanceof Function) last(polarity);
                        if(!!last && typeof(last) === 'string') q(last).push(polarity);
                    }
                }.bind(this));
            }
        }
    }.bind(this));
    return outQueue || this;
};
// `every` returns true only if the callback has returned true every time. Immediately returns false
// when false and closes the input queue in this event. A specialization of the `reduce` method.
Q.prototype.every = function every(callback, last) { return everySome.bind(this, false, callback, last)(); };
Q.prototype.everyAsync = makeAsync(Q.prototype.every);
Q.prototype.everySync = makeSync(Q.prototype.every);

// `some` returns true only if the callback has returned true at least once. Immediately returns true
// when true and closes the input queue in this event.
Q.prototype.some = function some(callback, last) { return everySome.bind(this, true, callback, last)(); };
Q.prototype.someAsync = makeAsync(Q.prototype.some);
Q.prototype.someSync = makeSync(Q.prototype.some);

// `toArray` returns an array from the given queue. A specialization of the `reduce` method.
// Has the same three behaviors depending on the type of value `last` is, function, string, or
// falsy.
Q.prototype.toArray = function toArray(last) {
    var outQueue = this;
    if(!last) {
        outQueue = new this.constructor(null, this.namespace);
        this.on('close', function() { outQueue.push(this.queue).close(); }.bind(this));
    } else if(typeof last === 'string') {
        this.on('close', function() { q(last).push(this.queue).close(); }.bind(this));
    } else if(typeof last === 'function') {
        this.on('close', last.bind(this, this.queue));
    }
    if(!this.wasName) this.close();
    return outQueue;
};

// `flatten` takes an input queue and produces an output queue of values that are not arrays. Any
// array encountered is split and enqueued into the new queue recursively, unless given a depth to
// flatten to (`true` == 1 in this case). Intended to be nearly identical to underscore's `flatten`
Q.prototype.flatten = function flatten(depth) {
    var outQueue = new this.constructor(null, this.namespace);
    function processValue(value, currDepth) {
        if(value && value instanceof Array) {
            if(depth && typeof(depth) === 'number' && depth === currDepth) {
                outQueue.push(value);
            } else {
                value.forEach(function(value) { processValue(value, currDepth+1); });
            }
        } else {
            outQueue.push(value);
        }
    }

    this.setHandler(function(value, next) {
        if(!next) {
            outQueue[value]();
        } else {
            next(function() {
                processValue(value, 0);
            });
        }
    });
    return outQueue;
};

// `shortCiruit` and `ercb` are functions common to both the `node` and `exec` methods below.
// `shortCircuit` consumes the remaining queue without doing any processing, and `ercb` is a
// callback function with significant error logic, depending on what value is passed into the
// `onError` argument for `node` and `exec`.
/* jshint maxparams: 6 */
function ercb(outQueue, onError, next, value, error, result) {
    if(!error) {
        next(function() {
            outQueue.push(result);
        });
    } else {
        if(!!onError && onError instanceof Function) {
            onError(error, result, value);
        } else if(typeof(onError) === 'string') {
            next(function() {
                q(onError).push([error, result, value]);
            });
        } else if(typeof(onError) === 'object') { // Assume a queue-flow constructed object
            next(function() {
                onError.push([error, result, value]);
            });
        }
    }
}

// `node` is a slightly modified version of `map` that takes the input value, and if it is an
// array, provides each value as an independent argument to the provided callback. It also assumes
// the method returns a correct result and throws an error, or if async calls the callback with two
// arguments, considered to be `error` and `value`, in that order, which matches most of the
// Node.js API callbacks. A second parameter can also be set to determine what `node` does when
// an error is returned. If not set, `node` simply ignores the error and value and processes the
// next item in the queue. If set to `true`, it kills the queue at this point. If set to a function,
// it kills the queue and calls the function with the error and value. If set to a string, it
// passes the error and value into a queue of the same name and continues processing the rest of
// the queue. If there was an error, for useful debugging the original params passed to exec are
// also provided.
Q.prototype.node = function node(callback, onError) {
    var outQueue = new this.constructor(null, this.namespace);
    this.setHandler(function(value, next) {
        if(!(value instanceof Array)) value = [value];
        if(!next) {
            outQueue[value]();
        } else {
            if(isAsync(callback, value.length+1)) {
                value.push(ercb.bind(this, outQueue, onError, next, value));
                callback.apply(this, value);
            } else {
                try {
                    ercb.bind(this)(outQueue, onError, next, value, undefined, callback.apply(this, value));
                } catch(e) {
                    ercb.bind(this)(outQueue, onError, next, value, e);
                }
            }
        }
    }.bind(this));
    return outQueue;
};
Q.prototype.nodeAsync = makeAsync(Q.prototype.node);
Q.prototype.nodeSync = makeSync(Q.prototype.node);

// ``exec`` assumes the incoming value is a function to execute and takes a couple of arguments.
// The first is an array of arguments for the function, or a function that returns an array of
// arguments based on the function to be run, while the second is what to do if there is an error,
// similar to ``node`` above. ``execCommon`` is the base for all three versions of ``exec``
function execCommon(forceSyncAsync, args, onError) {
    var outQueue = new this.constructor(null, this.namespace);
    this.setHandler(function(value, next) {
        if(!next) return outQueue[value]();
        if(!(value instanceof Function)) return ercb(outQueue, onError, next, value, new Error('Not a function'), undefined);
        function execFunc(args) {
            if(forceSyncAsync === 'async' || (forceSyncAsync !== 'sync' && isAsync(value, args.length+1))) {
                args.push(ercb.bind(this, outQueue, onError, next, value));
                value.apply(this, args);
            } else {
                try {
                    ercb(outQueue, onError, next, value, undefined, value.apply(this, args));
                } catch(e) {
                    ercb(outQueue, onError, next, value, e);
                }
            }
        }
        if(args instanceof Function && isAsync(args, 2)) {
            args(value, function() {
                execFunc.bind(this)(Array.prototype.slice.call(arguments, 0));
            });
        } else if(args instanceof Function) {
            try {
                var args2 = args(value);
                args2 = args2 instanceof Array ? args2 : [args2];
                execFunc.bind(this)(args2);
            } catch(e) {
                ercb.bind(this)(outQueue, onError, next, value, e);
            }
        } else if(args instanceof Array) {
            execFunc.bind(this)(args);
        } else {
            execFunc.bind(this)([args]);
        }
    }.bind(this));
    return outQueue;
}
Q.prototype.exec = function exec(args, onError) {
    return execCommon.bind(this, false)(args, onError);
};
Q.prototype.execSync = function execSync(args, onError) {
    return execCommon.bind(this, 'sync')(args, onError);
};
Q.prototype.execAsync = function execAsync(args, onError) {
    return execCommon.bind(this, 'async')(args, onError);
};

// ``subqueue`` allows re-usable queue definitions to be attached to the parent queue. An
// anonymous queue is provided to the callback function, and that function must return the
// endpoint of the sub-queue that will be continued along in the chain.
Q.prototype.subqueue = function subqueue(callback) {
    if(isAsync(callback, 2)) {
        var inQueue = new this.constructor(null, this.namespace);
        var outQueue = new this.constructor(null, this.namespace);
        var buffer = [];
        this.each(buffer.push.bind(buffer));
        callback(inQueue, function(intermediateQ) {
            inQueue.concat(buffer);
            intermediateQ.branch(outQueue);
        });
        return outQueue;
    } else {
        return callback(this);
    }
};
Q.prototype.subqueueSync = makeSync(Q.prototype.subqueue);
Q.prototype.subqueueAsync = makeAsync(Q.prototype.subqueue);

// ``promise`` allows the usage of CommonJS Promises in queues. It takes a function that uses
// the value or values passed in as the arguments for the construction of the promise, and
// then registers handlers for the success and failure scenarios, passing the successes down
// and the failures into the specified error queue or callback. Promises are, by definition, async, so
// ``promiseAsync`` is simply a synonym and ``promiseSync`` simply throws an error.
Q.prototype.promise = function promise(callback, error) {
    var outQueue = new this.constructor(null, this.namespace);
    if(typeof(error) === 'string') {
        error = q(error).push.bind(q(error));
    } else if(typeof(error) === 'object') {
        error = error.push.bind(error);
    } else if(typeof(error) !== 'function') {
        error = function() {};
    }
    this.setHandler(function(value, next) {
        if(!next) return outQueue[value]();
        if(!(value instanceof Array)) value = [value];
        callback.apply(this, value).then(function(result) {
            next(function() {
                outQueue.push(result);
            });
        }, error);
    });
    return outQueue;
};
Q.prototype.promiseAsync = Q.prototype.promise;
Q.prototype.promiseSync = function() { throw "Synchronous Promises are Nonsensical!"; };

// ``pipe`` pushes the queue results into the provided writeable object (and returns it so
// if it is also readable, you can continue to ``pipe`` it just as you'd expect). Throws
// an error if it can't find the ``write`` and ``end`` methods.
Q.prototype.pipe = function pipe(writable) {
    if(typeof(writable.write) !== 'function' || typeof(writable.end) !== 'function') throw new Error('Not a valid writeable object!');
    this.setHandler(function(value, next) {
        if(!next) return writable.end();
        next(function() {
            writable.write(value);
        });
    });
    return writable;
};

// ``drain`` is a simple callback that empties the attached queue and throws away the
// results. This is useful for long-running queues to eliminate references to effectively
// "dead" data without using the ``reduce`` hack to do so. No chaining is possible
// after this call (for obvious reasons).
Q.prototype.drain = function drain() {
    this.setHandler(function(value, next) {
        if(next && next instanceof Function) next(function() {});
    });
    return undefined;
};

function ns() {
    // The q environment
    var qEnv = {};

    var q = qFunc.bind(qEnv);

    qEnv.q = q;

    // Hash of named queues
    qEnv.namedQueues = {};

    q.exists = exists.bind(qEnv);

    q.clearQueue = clearQueue.bind(qEnv);

    q.addQueue = addQueue.bind(qEnv);

    // Create a new queue-flow environment/namespace
    q.ns = ns;


    // Expose the `Q` constructor function (below) so third parties can extend its prototype
    q.Q = Q;

    // Specify the default constructor function for this namespace (may be overridden by user)
    q.defaultQ = Q;

    // ## Methods of `q`, mostly helper functions for users of `queue-flow` and the `Q` methods
    q.makeAsync = makeAsync;
    q.makeSync = makeSync;
    q.tuple = tuple;

    return q;
}

q = ns();

module.exports = q;
