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
var Infiniqueue = require('infiniqueue');

var nextTick = global.setImmediate ? global.setImmediate : process.nextTick;

var q;

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

// ## The `Q` constructor function, which either uses the supplied queueing engine, or
// uses the built-in in-memory engine.
function Q(nameOrArray, options, namespace) {
    EventEmitter.call(this);
    this.options = options || {};
    this.options.parallelism = this.options.parallelism || 1;
    this.namespace = namespace;

    // Private variables, the handlers and actual queue array
    this.wasName = nameOrArray instanceof Array ? false : true;
    this.queue = new Infiniqueue();
    if(nameOrArray instanceof Array) {
        for(var i = 0; i < nameOrArray.length; i++) {
            this.queue.enqueue(nameOrArray[i]);
        }
    }
    this.openQueue = new Infiniqueue();
    this.handler = function(self, value, struct) {
        self.handlerCallback(struct, function() {});
    };
    this.ender = function() {};
    this.handlerSet = true;
    this.handlerRuns = 0;

    // For node 0.6 and 0.8 compatibility, listen for the `pipe` event and register
    // an event handler to call `push`
    this.on('pipe', function(piper) {
        piper.on('data', this.pushOne.bind(this));
    }.bind(this));

    if(this.queue.length > 0) this.on('empty', this.close.bind(this));
    nextTick(this.enqueueParallelism.bind(this));
    return this;
}

util.inherits(Q, EventEmitter);

// `setHandler` defines the special function to call to process the queue
// assumed to be ready initially, when called marked busy, call provided callback to
// mark ready again.
Q.prototype.setHandlers = function setHandlers(handlerFunc, endFunc) {
    this.handler = handlerFunc;
    this.ender = endFunc;
    this.handlerSet = true;
    this.enqueueParallelism();
    return this;
};

// The `handlerCallback` is provided to the handler along with the dequeued value.
// If there is more work to be done, it continues, otherwise is marks the handler
// as ready for when the data next arrives
Q.prototype.handlerCallback = function handlerCallback(openQueueStruct, done) {
    this.handlerRuns = ++this.handlerRuns % 50;
    openQueueStruct.done = true;
    openQueueStruct.doneFunc = done;
    while(this.openQueue.length) {
        var row = (this.openQueue.start / this.openQueue.ROWLEN) | 0;
        var col = this.openQueue.start % this.openQueue.ROWLEN;
        var currStruct = this.openQueue.matrix[row][col];
        if(!currStruct.done) break;
        currStruct.doneFunc();
        this.openQueue.dequeue();
    }
    if(this.openQueue.length === 0 && (!this.queue || this.queue.length === 0)) {
        this.emitSync('empty');
    } else {
        this.enqueueParallelism();
    }
};

// `OpenQueueStruct` is a simple object with fixed types, which should be
// easier for V8 and other JS engines to optimize internally. `done` is
// always a boolean and `doneFunc` is always a function. V8 prefers
// constructor functions to JSON for optimization purposes.
function OpenQueueStruct() {
    this.done = false;
    this.doneFunc = function() {};
    return this;
}

// `enqueueParallelism` loads the next item or items for processing
Q.prototype.enqueueParallelism = function enqueueParallelism() {
    if(this.handlerSet) {
        var numToProcess = (this.options.parallelism - this.openQueue.length) > this.queue.length ? this.queue.length : this.options.parallelism - this.openQueue.length;
        for(var i = 0; i < numToProcess; i++) {
            // Javascript treats assignments of objects as pass-by-reference,
            // so this seemingly unnecessary single-property object allows
            // alteration of the correct value in the openQueue array without
            // creating an explicit id
            var openQueueStruct = new OpenQueueStruct();
            this.openQueue.enqueue(openQueueStruct);
            if (this.handlerRuns === 0) {
                /* jshint loopfunc: true */
                var self = this;
                nextTick(function() {
                    self.handler(self, self.queue.dequeue(), openQueueStruct);
                });
            } else {
                this.handler(this, this.queue.dequeue(), openQueueStruct);
            }
        }
    }
};

// Inserts a specified value into the queue, if allowed by the event handlers, and
// calls the special handler function, if it's ready.
Q.prototype.push = function push() {
    for(var i = 0; i < arguments.length; i++) {
        this.queue.enqueue(arguments[i]);
    }
    this.enqueueParallelism();
    return this;
};

// `write` is a synonym for `push` so a queue can be treated as a writeable stream
Q.prototype.write = Q.prototype.push;

Q.prototype.pushOne = function pushOne(val) {
    this.queue.enqueue(val);
    this.enqueueParallelism();
    return this;
};

// Signals that the queue is being destroyed and then, if allowed, destroys it
Q.prototype.close = function close() {
    this.emit('close', function(result) {
        if(result) {
            // Stop accepting new items so the queue can actually close
            // if processing time is slower than newly enqueued values come in
            this.removeAllListeners('push');
            this.on('push', function() { return false; });
            // Whatever made it into the queue at this point in time, allow it to be
            // processed and de-queued.
            var flushQueue = function() {
                this.handlerSet = false;
                this.handler = function() {};
                if(this.queue) this.queue.shutdown();
                this.queue = undefined;
                if(this.openQueue) this.openQueue.shutdown();
                this.openQueue = undefined;
                this.push = this.pushOne = function() { throw new Error('Queue already closed'); };
                if(this.namespace) this.namespace.clearQueue(this);
                if(this.ender instanceof Function) {
                    this.ender('close');
                }
            }.bind(this);
            if(this.openQueue && !this.openQueue.length && this.queue && !this.queue.length) {
                flushQueue();
            } else {
                this.removeAllListeners('empty');
                this.on('empty', flushQueue);
            }
        }
    }.bind(this));
    return this;
};

// `end` is a synonym for `close` so a queue can be treated as a writeable stream
Q.prototype.end = Q.prototype.close;

// Kills the queue (and all sub-queues) immediately, no possibility of blocking
// with an event handler.
Q.prototype.kill = function kill() {
    this.emitSync('kill');
    this.handlerSet = false;
    this.handler = function() {};
    this.queue.shutdown();
    this.queue = undefined;
    if(this.openQueue) this.openQueue.shutdown();
    this.openQueue = undefined;
    this.push = this.pushOne = function() { throw new Error('Queue already closed'); };
    if(this.namespace) this.namespace.clearQueue(this);
    if(this.ender instanceof Function) {
        this.ender('kill');
    }
};

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
    var outQueue = new Q(null, this.options, this.namespace);
    if(isAsync(callback, 2)) {
        this.setHandlers(function(self, value, struct) {
            callback(value, function() {
                self.handlerCallback(struct, outQueue.pushOne.bind(outQueue, value));
            });
        }, function(end) {
            outQueue[end]();
        });
    } else {
        this.setHandlers(function(self, value, struct) {
            callback(value);
            self.handlerCallback(struct, outQueue.pushOne.bind(outQueue, value));
        }, function(end) {
            outQueue[end]();
        });
    }
    return outQueue;
};
Q.prototype.eachAsync = makeAsync(Q.prototype.each);
Q.prototype.eachSync = makeSync(Q.prototype.each);

// `wait` is a no-op `each` that simply delays the queue by a specified amount
// or by the amount specified by the callback function (if the argument is a
// function instead of a number). This is useful for ratelimiting queues that
// otherwise hammer an external service.
Q.prototype.wait = function wait(delay) {
    if(typeof(delay) === 'function' && isAsync(delay, 2)) {
        return this.each(function(val, callback) {
            delay(val, function(delay) {
                setTimeout(callback, delay);
            });
        });
    } else if(typeof(delay) === 'function') {
        return this.each(function(val, callback) {
            setTimeout(callback, delay(val));
        });
    } else {
        return this.each(function(val, callback) {
            setTimeout(callback, delay);
        });
    }
};
Q.prototype.waitAsync = makeAsync(Q.prototype.wait);
Q.prototype.waitSync = makeSync(Q.prototype.wait);

// `map` creates an output queue, and executes
// the given callback on each value, pushing the
// result into the output queue before continuing
// to process the input queue
Q.prototype.map = function map(callback) {
    var outQueue = new Q(null, this.options, this.namespace);
    if(isAsync(callback, 2)) {
        this.setHandlers(function(self, value, struct) {
            callback(value, function(result) {
                self.handlerCallback(struct, function() {
                    outQueue.pushOne(result);
                });
            });
        }, function(end) {
            outQueue[end]();
        });
    } else {
        this.setHandlers(function(self, value, struct) {
            self.handlerCallback(struct, function() {
                outQueue.pushOne(callback(value));
            });
        }, function(end) {
            outQueue[end]();
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
Q.prototype.reduce = function reduce(callback, initial, last) {
    var out = initial;
    var outQueue;
    if(!last) outQueue = new Q(null, this.options, this.namespace);
    var endFunc = function(end) {
        if(!!last && last instanceof Function) last(out);
        if(!!last && typeof(last) === 'string') q(last).pushOne(out);
        if(!last) {
            outQueue.pushOne(out);
            outQueue[end]();
        }
    };
    if(isAsync(callback, 3)) {
        this.setHandlers(function(self, value, struct) {
            callback(out, value, function(result) {
                self.handlerCallback(struct, function() {
                    out = result;
                });
            });
        }, endFunc);
    } else {
        this.setHandlers(function(self, value, struct) {
            self.handlerCallback(struct, function() {
                out = callback(out, value);
            });
        }, endFunc);
    }
    return outQueue || this;
};
Q.prototype.reduceAsync = makeAsync(Q.prototype.reduce);
Q.prototype.reduceSync = makeSync(Q.prototype.reduce);

// `filter` creates an output queue, and executes
// the given callback on each value, pushing the
// original value *only* if the callback returns true.
Q.prototype.filter = function filter(callback) {
    var outQueue = new Q(null, this.options, this.namespace);
    if(isAsync(callback, 2)) {
        this.setHandlers(function(self, value, struct) {
            callback(value, function(result) {
                self.handlerCallback(struct, function() {
                    if(result) outQueue.pushOne(value);
                });
            });
        }, function(end) {
            outQueue[end]();
        });
    } else {
        this.setHandlers(function(self, value, struct) {
            self.handlerCallback(struct, function() {
                if(callback(value)) outQueue.pushOne(value);
            });
        }, function(end) {
            outQueue[end]();
        });
    }
    return outQueue;
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
    this.setHandlers(function(self, value, struct) {
        function queueProcessor(queue) {
            if(typeof(queue) === 'string') {
                self.namespace(queue).pushOne(value);
            } else if(typeof(queue) === 'object' && !!queue.push) {
                queue.pushOne(value);
            }
        }
        if(typeof(callback) === 'function' && isAsync(callback, 2)) {
            callback(value, function(result) {
                self.handlerCallback(struct, function() {
                    if(result instanceof Array) {
                        result.forEach(queueProcessor);
                    } else {
                        queueProcessor(result);
                    }
                });
            });
        } else if(typeof(callback) === 'function') {
            var result = callback(value);
            self.handlerCallback(struct, function() {
                if(result instanceof Array) {
                    result.forEach(queueProcessor);
                } else {
                    queueProcessor(result);
                }
            });
        } else if(callback instanceof Array) {
            self.handlerCallback(struct, function() {
                callback.forEach(queueProcessor);
            });
        } else {
            self.handlerCallback(struct, function() {
                queueProcessor(callback);
            });
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
    if(!last) outQueue = new Q(null, this.options, this.namespace);
    function shortCircuit(self, value, struct) { self.handlerCallback(struct, function() {}); }
    this.setHandlers(function(self, value, struct) {
        if(isAsync(callback, 2)) {
            callback(value, function(result) {
                self.handlerCallback(struct, function() {
                    if(result === polarity) {
                        this.setHandlers(shortCircuit, function() {});
                        if(!last) {
                            outQueue.pushOne(polarity);
                            outQueue.close();
                        }
                        if(!!last && last instanceof Function) last(polarity);
                        if(!!last && typeof(last) === 'string') q(last).pushOne(polarity);
                    }
                }.bind(this));
            }.bind(this));
        } else {
            self.handlerCallback(struct, function() {
                if(callback(value) === polarity) {
                    this.setHandlers(shortCircuit, function() {});
                    if(!last) {
                        outQueue.pushOne(polarity);
                        outQueue.close();
                    }
                    if(!!last && last instanceof Function) last(polarity);
                    if(!!last && typeof(last) === 'string') q(last).pushOne(polarity);
                }
            }.bind(this));
        }
    }.bind(this), function(end) {
        if(!last) {
            outQueue.pushOne(!polarity);
            outQueue[end]();
        }
        if(!!last && last instanceof Function) last(!polarity); // Reverse the polarity on the deflector shield!
        if(!!last && typeof(last) === 'string') q(last).pushOne(!polarity);
    });
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
    var outArr = [];
    if(!last) {
        outQueue = new Q(null, this.options, this.namespace);
    } else if(typeof last === 'string') {
        outQueue = q(last);
    }
    this.setHandlers(function(self, value, struct) {
        self.handlerCallback(struct, function() {
            outArr.push(value);
        });
    }, typeof(last) === 'function' ? function() {
        last(outArr);
    } : function(end) {
        outQueue.pushOne(outArr)[end]();
    });
    if(!this.wasName) this.close();
    return outQueue;
};

// `flatten` takes an input queue and produces an output queue of values that are not arrays. Any
// array encountered is split and enqueued into the new queue recursively, unless given a depth to
// flatten to (`true` == 1 in this case). Intended to be nearly identical to underscore's `flatten`
Q.prototype.flatten = function flatten(depth) {
    var outQueue = new Q(null, this.options, this.namespace);
    function processValue(value, currDepth) {
        if(value && value instanceof Array) {
            if(depth && typeof(depth) === 'number' && depth === currDepth) {
                outQueue.pushOne(value);
            } else {
                value.forEach(function(value) { processValue(value, currDepth+1); });
            }
        } else {
            outQueue.pushOne(value);
        }
    }

    this.setHandlers(function(self, value, struct) {
        self.handlerCallback(struct, function() {
            processValue(value, 0);
        });
    }, function(end) {
        outQueue[end]();
    });
    return outQueue;
};

// `shortCiruit` and `ercb` are functions common to both the `node` and `exec` methods below.
// `shortCircuit` consumes the remaining queue without doing any processing, and `ercb` is a
// callback function with significant error logic, depending on what value is passed into the
// `onError` argument for `node` and `exec`.
/* jshint maxparams: 7 */
function ercb(outQueue, onError, self, value, struct, error, result) {
    if(!error) {
        self.handlerCallback(struct, function() {
            outQueue.pushOne(result);
        });
    } else {
        if(!!onError && onError instanceof Function) {
            onError(error, result, value);
        } else if(typeof(onError) === 'string') {
            self.handlerCallback(struct, function() {
                q(onError).pushOne([error, result, value]);
            });
        } else if(typeof(onError) === 'object') { // Assume a queue-flow constructed object
            self.handlerCallback(struct, function() {
                onError.pushOne([error, result, value]);
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
    var outQueue = new Q(null, this.options, this.namespace);
    this.setHandlers(function(q, value, struct) {
        if(!(value instanceof Array)) value = [value];
        if(isAsync(callback, value.length+1)) {
            value.push(ercb.bind(this, outQueue, onError, q, value, struct));
            callback.apply(this, value);
        } else {
            try {
                ercb.bind(this)(outQueue, onError, q, value, struct, undefined, callback.apply(this, value));
            } catch(e) {
                ercb.bind(this)(outQueue, onError, q, value, struct, e);
            }
        }
    }.bind(this), function(end) {
        outQueue[end]();
    });
    return outQueue;
};
Q.prototype.nodeAsync = makeAsync(Q.prototype.node);
Q.prototype.nodeSync = makeSync(Q.prototype.node);

// ``exec`` assumes the incoming value is a function to execute and takes a couple of arguments.
// The first is an array of arguments for the function, or a function that returns an array of
// arguments based on the function to be run, while the second is what to do if there is an error,
// similar to ``node`` above. ``execCommon`` is the base for all three versions of ``exec``
function execCommon(forceSyncAsync, args, onError) {
    var outQueue = new Q(null, this.options, this.namespace);
    this.setHandlers(function(q, value, struct) {
        if(!(value instanceof Function)) return ercb(outQueue, onError, q, value, struct, new Error('Not a function'), undefined);
        function execFunc(args) {
            if(forceSyncAsync === 'async' || (forceSyncAsync !== 'sync' && isAsync(value, args.length+1))) {
                args.push(ercb.bind(this, outQueue, onError, q, value, struct));
                value.apply(this, args);
            } else {
                try {
                    ercb(outQueue, onError, q, value, struct, undefined, value.apply(this, args));
                } catch(e) {
                    ercb(outQueue, onError, q, value, struct, e);
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
                ercb.bind(this)(outQueue, onError, q, value, struct, e);
            }
        } else if(args instanceof Array) {
            execFunc.bind(this)(args);
        } else {
            execFunc.bind(this)([args]);
        }
    }.bind(this), function(end) {
        outQueue[end]();
    });
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
        var inQueue = new Q(null, this.options, this.namespace);
        var outQueue = new Q(null, this.options, this.namespace);
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
    var outQueue = new Q(null, this.options, this.namespace);
    if(typeof(error) === 'string') {
        error = q(error).push.bind(q(error));
    } else if(typeof(error) === 'object') {
        error = error.push.bind(error);
    } else if(typeof(error) !== 'function') {
        error = function() {};
    }
    this.setHandlers(function(self, value, struct) {
        if(!(value instanceof Array)) value = [value];
        callback.apply(this, value).then(function(result) {
            self.handlerCallback(struct, function() {
                outQueue.push(result);
            });
        }, error);
    }, function(end) {
        outQueue[end]();
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
    this.setHandlers(function(self, value, struct) {
        self.handlerCallback(struct, function() {
            writable.write(value);
        });
    }, function() {
        writable.end();
    });
    return writable;
};

// ``plug`` is a simple callback that "plugs up" the queue if nothing has been defined to
// process the incoming data. Useful if you don't (yet) know what method you'll run on it,
// though this should be a very rare occasion.
Q.prototype.plug = function plug() {
    this.handlerSet = false;
    this.handler = function() {};
    this.ender = function() {};
    return this;
};

function ns() {
    var namedQueues = {};

    // Determines if this queue has a name, and either finds or returns said named queue,
    // or decides it's an unnamed queue and returns said queue.
    var q = function qFunc(nameOrArray, options) {
        options = options || {};
        if(typeof(nameOrArray) === "string") {
            if(!namedQueues[nameOrArray]) {
                namedQueues[nameOrArray] = new Q(nameOrArray, options, q);
            }
            return namedQueues[nameOrArray];
        } else if(nameOrArray instanceof Array) {
            return new Q(nameOrArray, options, q);
        } else if(nameOrArray instanceof Object &&
            typeof(nameOrArray.pipe) === 'function' &&
            typeof(nameOrArray.on) === 'function') {
            var newQ = new Q(undefined, options, q);
            nameOrArray.on('data', newQ.pushOne.bind(newQ));
            nameOrArray.on('end', newQ.close.bind(newQ));
            return newQ;
        } else {
            return new Q(undefined, options, q);
        }
    };

    // `exists` returns whether or not a named queue exists in
    q.exists = function exists(queueName) {
        return !!namedQueues[queueName] && typeof(namedQueues[queueName]) === 'object';
    };

    // `clearQueue` removes a queue from a q environment
    q.clearQueue = function clearQueue(nameOrQueue) {
        if(typeof(nameOrQueue) === 'string') {
            if(namedQueues[nameOrQueue]) delete namedQueues[nameOrQueue];
        } else {
            Object.keys(namedQueues).forEach(function(name) {
                if(namedQueues[name] === nameOrQueue) delete namedQueues[name];
            });
        }
    };

    // `addQueue` adds a queue to a q environment
    q.addQueue = function addQueue(name, queue) {
        namedQueues[name] = queue;
    };

    // `tuple` converts an object into an array of arrays. The arrays are tuples of the
    // key-value pairs from the object, so they can be processed individually in a queue-flow
    // if desired, rather than considering the whole object as a single item in the queue.
    q.tuple = function tuple(obj) {
        return Object.keys(obj).reduce(function(outArr, key) { return outArr.concat([[key, obj[key]]]); }, []);
    };

    // Create a new queue-flow environment/namespace
    q.ns = ns;


    // Expose the `Q` constructor function so third parties can extend its prototype
    q.Q = Q;

    // ## Methods of `q`, mostly helper functions for users of `queue-flow` and the `Q` methods
    q.makeAsync = makeAsync;
    q.makeSync = makeSync;

    return q;
}

q = ns();

module.exports = q;
