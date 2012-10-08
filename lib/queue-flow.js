// queue-flow Copyright (C) 2012 by David Ellis
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

// Construct the `q` environment and return the `q` accessor/constructor object
var q = (function qEnv() {

	// For browser compatibility, masquerade `setTimeout` as `process.nextTick`
	// This is to work around an issue with Node 0.6 where `setTimeout(someFunc, 0)`
	// doesn't behave like `process.nextTick`
	if(!process || !process.nextTick) {
		process = process || {};
		process.nextTick = process.nextTick || setTimeout;
	}

    // ## Variables global to the `q` environment

	// Hash of named queues
	var namedQueues = {};

	// Determines if this queue has a name, and either finds or returns said named queue,
	// or decides it's an unnamed queue and returns said queue.
	function q(nameOrArray, qType) {
		if(typeof(nameOrArray) == "string") {
			if(!namedQueues[nameOrArray] || !(namedQueues[nameOrArray] instanceof Q || namedQueues[nameOrArray] instanceof qType)) {
				namedQueues[nameOrArray] = new Q(nameOrArray, qType);
			}
			return namedQueues[nameOrArray];
		} else if(nameOrArray instanceof Array) {
			return new Q(nameOrArray, qType);
		} else {
			return new Q(undefined, qType);
		}
	}

    // ## Methods of `q`, mostly helper functions for users of `queue-flow` and the `Q` methods

	// Expose the `Q` constructor function (below) so third parties can extend its prototype
	q.Q = Q;

	// Create a new queue-flow environment/namespace
	q.ns = qEnv;

	// `exists` returns whether or not a named queue exists in
	// this `qEnv`
	q.exists = function exists(queueName) {
		return !!namedQueues[queueName] && typeof(namedQueues[queueName]) == 'object';
	};

	// `makeAsync` and `makeSync` helper methods allow a more fluent API to force
	// async or sync methods, suggested by a colleague, and fits better in the
	// `queue-flow` API.
	q.makeAsync = function makeAsync(qfMethod) {
		return function() {
			return qfMethod.apply(this,
				Array.prototype.slice.call(arguments, 0).map(function(arg) {
					if(arg instanceof Function) arg.async = true;
					return arg;
				})
			);
		};
	};

	q.makeSync = function makeSync(qfMethod) {
		return function() {
			return qfMethod.apply(this,
				Array.prototype.slice.call(arguments, 0).map(function(arg) {
					if(arg instanceof Function) arg.sync = true;
					return arg;
				})
			);
		};
	};

	// `isAsync` checks for the `async` property and if it doesn't exist, and the `sync` property
	// doesn't exist, then it attempts to "guess" whether a function is asynchronous (based on
	// the number of named arguments). Further checks could be done (such as scouring the source
	// code of the function for a `return` statement) but are performance cost-prohibiitive, and
	// the developer can use the `Async` methods to clarify it is actually async in that case.
	q.isAsync = function isAsync(method, asyncArgLength) {
		return method.async|| (!method.sync && method.length == asyncArgLength);
	};

	// `tuple` converts an object into an array of arrays. The arrays are tuples of the
	// key-value pairs from the object, so they can be processed individually in a queue-flow
	// if desired, rather than considering the whole object as a single item in the queue.
	q.tuple = function tuple(obj) {
		return Object.keys(obj).reduce(function(outArr, key) { return outArr.concat([[key, obj[key]]]); }, []);
	};

	// ## The `Q` constructor function, which either uses the supplied queueing engine, or
	// uses the built-in in-memory engine.
	function Q(nameOrArray, qType) {
		this.qType = !!qType && qType instanceof Function ? qType : Q;

		// Private variables, the handlers and actual queue array
		var eventHandlers = {};
		var queue = nameOrArray instanceof Array ? nameOrArray : [];
		var handler = undefined;
        var handlerBusy = false;
		var recentlyEmptied = false;

		// Privileged methods

		// `on` registers event handlers
		this.on = function on(eventName, handler) {
			if(!eventHandlers) eventHandlers = {};
			eventHandlers[eventName] = eventHandlers[eventName] instanceof Array ? eventHandlers[eventName] : [];
			eventHandlers[eventName].push(handler);
			return this;
		}.bind(this);

		// `fire` executes the event handlers, passing along whatever arguments given to it
		// minus the event name indicator, of course. If any handler returns false, it indicates
		// so, indiating to the method firing the event to cancel.
		this.fire = function fire(eventName) {
			var newArgs = Array.prototype.slice.call(arguments, 1, arguments.length-1);
			var callback = arguments[arguments.length-1] instanceof Function ? arguments[arguments.length-1] : function() {};
			if(!eventHandlers) {
				callback(false);
			} else if(eventHandlers[eventName]) {
				var total = eventHandlers[eventName].length, count = 0, finalResult = true;
				eventHandlers[eventName].forEach(function(newArgs, handler) {
					if(!handler instanceof Function) return count++;
					if(q.isAsync(handler, newArgs.length+1)) {
						newArgs.push(function(result) {
						if(result === false) finalResult = result;
							count++;
							if(total == count) callback(finalResult);
						});
						handler.apply(this, newArgs);
					} else {
						var result = handler.apply(this, newArgs);
						if(result === false) finalResult = result;
						count++;
						if(total == count) callback(finalResult);
					}
				}.bind(this, newArgs));
			} else {
				callback(true);
			}
		}.bind(this);

		// `clear` clears all event handlers from the specified event
		this.clear = function clear(eventName) {
			eventHandlers[eventName] = [];
			return this;
		}.bind(this);

		// `setHandler` defines the special function to call to process the queue
		// assumed to be ready initially, when called marked busy, call provided callback to
		// mark ready again.
		this.setHandler = function setHandler(handlerFunc) {
			handler = handlerFunc;
			if(!handlerBusy) process.nextTick(handlerCallback.bind(this));
			return this;
		}.bind(this);

		// The `handlerCallback` is provided to the handler along with the dequeued value.
		// If there is more work to be done, it continues, otherwise is marks the handler
		// as ready for when the data next arrives
		var handlerCallback = function handlerCallback() {
			if(!handlerBusy && queue && queue.length > 0) {
				handlerBusy = true;
				this.fire('pull', queue[0], function(result) {
					if(result && handler instanceof Function) {
                        process.nextTick(function() {
                            handler.bind(this, queue.shift(), function() {
                                handlerBusy = false;
                                handlerCallback.bind(this)();
                            }.bind(this))();
                        }.bind(this));
					}
				}.bind(this));
            } else if(!handlerBusy && !recentlyEmptied) {
                this.fire('empty');
                recentlyEmptied = true;
            }
		};

		// Inserts a specified value into the queue, if allowed by the event handlers, and
		// calls the special handler function, if it's ready.
		this.push = function push(value) {
			recentlyEmptied = false;
			var values = Array.prototype.slice.call(arguments, 0);
			this.fire('push', values, function(result) {
				if(result) {
					Array.prototype.push.apply(queue, values);
					if(!handlerBusy) process.nextTick(handlerCallback.bind(this));
				}
			}.bind(this));
			return this;
		}.bind(this);
		
        // Signals that the queue is being destroyed and then, if allowed, destroys it
		this.close = function close() {
			this.fire('close', function(result) {
				if(result) {
					// Stop accepting new items so the queue can actually close
					// if processing time is slower than newly enqueued values come in
					this.clear('push');
					this.on('push', function() { return false; });
					// Whatever made it into the queue at this point in time, allow it to be
					// processed and de-queued.
					var flushQueue = function() {
						var tempHandler = handler;
						handler = undefined;
						eventHandlers = undefined;
						queue = undefined;
						Object.keys(namedQueues).forEach(function(queue) {
							if(namedQueues[queue] === this) delete namedQueues[queue];
						}.bind(this));
						delete this;
						if(tempHandler instanceof Function) {
							process.nextTick(tempHandler.bind(null, 'close'));
						}
					};
					if(queue && !queue.length) process.nextTick(flushQueue.bind(this));
					if(queue && queue.length) {
						this.clear('empty');
						this.on('empty', flushQueue.bind(this));
					}
				}
			}.bind(this));
			return this;
		}.bind(this);

		//  Kills the queue (and all sub-queues) immediately, no possibility of blocking
		// with an event handler.
		this.kill = function kill() {
			this.fire('kill');
			var tempHandler = handler;
			handler = undefined;
			eventHandlers = undefined;
			queue = undefined;
			Object.keys(namedQueues).forEach(function(queue) {
				if(namedQueues[queue] === this) delete namedQueues[queue];
			}.bind(this));
			delete this;
			if(tempHandler instanceof Function) {
				tempHandler('kill');
			}
		}.bind(this);

		// Ignore all of this and replace with a custom handler object
		if(qType && qType instanceof Function) {
			return new qType(nameOrArray);
		} else {
			// Start processing the queue after the next JS event loop cycle and return the queue
			// object to the remaining code.
			if(!handlerBusy) process.nextTick(handlerCallback.bind(this));
			if(queue.length > 0) this.on('empty', this.close.bind(this));
			return this;
		}
	}

	// ## `Q` prototype methods, the methods to be most commonly used by users of `queue-flow`

	// `as` names or aliases the given queue
	Q.prototype.as = function as(name) {
		namedQueues[name] = this;
		return this;
	};

	// `load` is a simpler wrapper around `push` that takes a single array
	// and covers up the relatively nasty `apply` mechanism (when dealing with
	// queue-flow's particular object model. Getting the *queue-flow* object
    // requires `q('nameHere')` and `q('nameHere').push.apply(q('nameHere'), array)`
    // is ugly and verbose.
	Q.prototype.load = function load(array) {
		this.push.apply(this, array);
		return this;
	};

	// `each` creates an output queue that simply copies the input queue results,
	// while also passing these results to the provided callback for side-effect
	// purposes. The output queue is so the data is not destroyed by the `each`
	// method.
	Q.prototype.each = function each(callback) {
		var outQueue = new this.qType();
		this.setHandler(function(value, next) {
			if(!next) {
				outQueue[value]();
			} else {
                if(q.isAsync(callback, 2)) {
                    callback(value, function() {
                        outQueue.push(value);
                        next();
                    });
                } else {
    				callback(value);
	    			outQueue.push(value);
		    		next();
                }
			}
		});
		return outQueue;
	};
	Q.prototype.eachAsync = q.makeAsync(Q.prototype.each);
	Q.prototype.eachSync = q.makeSync(Q.prototype.each);

	// `setResult` is a helper function used by several of the Q prototype methods
	// to set their result in a regular fashion
	var setResult = function setResult(setter, next, result) {
		setter(result);
		next();
	};

	// `inOut` is a helper function used by several of the Q prototype methods that
	// take an input queue and produce an output queue.
	var inOut = function inOut(outQueue, setter, callback) {
		this.setHandler(function(value, next) {
			if(!next) {
				outQueue[value]();
			} else {
				if(q.isAsync(callback, 2)) {
					callback(value, setResult.bind(this, setter.bind(this, value), next));
				} else {
					setResult(setter.bind(this, value), next, callback(value));
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
		var outQueue = new this.qType();
		return inOut.bind(this)(outQueue, function mapSetter(value, result) {
			outQueue.push(result);
		}, callback);
	};
	Q.prototype.mapAsync = q.makeAsync(Q.prototype.map);
	Q.prototype.mapSync = q.makeSync(Q.prototype.map);

	// `reduce` creates an output variable, and executes once upstream has
	// `close()`d, it does one of three things, depending on the value of
	// `last`: if undefined it returns an anonymous queue and pushes that
	// sole result into the queue and closes it immediately. If `last` is
	// a string, it pushes that result into the named queue. If `last` is
	// a function, it does not create a queue and instead calls `last` with
	// the `out` value.
	Q.prototype.reduce = function reduce(callback, last, initial) {
		var out = initial;
		var outQueue = undefined;
		if(!last) outQueue = new this.qType();
		this.setHandler((function(value, next) {
			if(!next) {
				if(!!last && last instanceof Function) last(out);
				if(!!last && typeof(last) == 'string') q(last).push(out);
				if(!last) outQueue.push(out), outQueue[value]();
			} else {
				if(q.isAsync(callback, 3)) {
					callback(out, value, setResult.bind(this, function(result) {
						out = result;
					}, next));
				} else {
					out = callback(out, value);
					next();
				}
			}
		}).bind(this));
		return outQueue || this;
	};
	Q.prototype.reduceAsync = q.makeAsync(Q.prototype.reduce);
	Q.prototype.reduceSync = q.makeSync(Q.prototype.reduce);

	// `filter` creates an output queue, and executes
	// the given callback on each value, pushing the
	// original value *only* if the callback returns true.
	Q.prototype.filter = function filter(callback) {
		var outQueue = new this.qType();
		return inOut.bind(this)(outQueue, function filterSetter(value, result) {
			if(result) outQueue.push(value);
		}, callback);
	};
	Q.prototype.filterAsync = q.makeAsync(Q.prototype.filter);
	Q.prototype.filterSync = q.makeSync(Q.prototype.filter);

	// `branch` creates several named output queues and pushes the input queue
	// values into one of those queues based on the return value of the callback
	// (the return value is the name of the queue it belongs to)
	Q.prototype.branch = function branch(callback) {
		this.setHandler(function(value, next) {
			if(!!next) {
				if(q.isAsync(callback, 2)) {
					callback(value, setResult.bind(this, function(result) {
						if(result instanceof Array) {
							result.forEach(function(queue) {
								q(queue).push(value);
							});
						} else {
							q(result).push(value);
						}
					}, next));
				} else {
					var result = callback(value);
					if(result instanceof Array) {
						result.forEach(function(queue) {
							q(queue).push(value);
						});
					} else {
						q(result).push(value);
					}
					next();
				}
			}
		}.bind(this));
		return this;
	};
	Q.prototype.branchAsync = q.makeAsync(Q.prototype.branch);
	Q.prototype.branchSync = q.makeSync(Q.prototype.branch);

	// `everySome` helper function that is used to implement `Q.prototype.every`
	// and `Q.prototype.some`, similar to `reduce`, the behavior of `everySome`
	// will change whether `last` is a function, a string, or falsy.
	var everySome = function everySome(polarity, callback, last) {
		var outQueue = undefined;
		if(!last) outQueue = new this.qType();
		function shortCircuit(value, next) { if(!!next) next(); }
		this.setHandler((function(value, next) {
			if(!next) {
				if(!last) outQueue.push(!polarity);
				if(!!last && last instanceof Function) last(!polarity); // Reverse the polarity on the deflector shield!
				if(!!last && typeof(last) == 'string') q(last).push(!polarity);
			} else {
				if(q.isAsync(callback, 2)) {
					callback(value, function(result) {
						if(!result) {
							this.setHandler(shortCircuit);
							if(!last) outQueue.push(polarity);
							if(!!last && last instanceof Function) last(polarity);
							if(!!last && typeof(last) == 'string') q(last).push(polarity);
						}
						next();
					}.bind(this));
				} else {
					if(!callback(value)) {
						this.setHandler(shortCircuit);
						if(!last) outQueue.push(polarity);
						if(!!last && last instanceof Function) last(polarity);
						if(!!last && typeof(last) == 'string') q(last).push(polarity);
					}
					next();
				}
			}
		}).bind(this));
		return outQueue || this;
	};
	// `every` returns true only if the callback has returned true every time. Immediately returns false
	// when false and closes the input queue in this event. A specialization of the `reduce` method.
	Q.prototype.every = function every(callback, last) { return everySome.bind(this, false, callback, last)(); };
	Q.prototype.everyAsync = q.makeAsync(Q.prototype.every);
	Q.prototype.everySync = q.makeSync(Q.prototype.every);

	// `some` returns true only if the callback has returned true at least once. Immediately returns true
	// when true and closes the input queue in this event.
	Q.prototype.some = function some(callback, last) { return everySome.bind(this, true, callback, last)(); };
	Q.prototype.someSync = q.makeAsync(Q.prototype.some);
	Q.prototype.someAsync = q.makeSync(Q.prototype.some);

	// `toArray` returns an array from the given queue. A specialization of the `reduce` method.
	// Has the same three behaviors depending on the type of value `last` is, function, string, or
	// falsy.
	Q.prototype.toArray = function toArray(last) {
		return this.reduce(function(cumm, value) {
			cumm.push(value);
			return cumm;
		}, last, []);
	};

	// `flatten` takes an input queue and produces an output queue of values that are not arrays. Any
	// array encountered is split and enqueued into the new queue recursively, unless given a depth to
	// flatten to (`true` == 1 in this case). Intended to be nearly identical to underscore's `flatten`
	Q.prototype.flatten = function flatten(depth) {
		var outQueue = new this.qType();
		function processValue(value, currDepth) {
			if(value && value instanceof Array) {
				if(depth && typeof(depth) == 'number' && depth == currDepth) {
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
				processValue(value, 0);
				next();
			}
		});
		return outQueue;
	};

    // `shortCiruit` and `ercb` are functions common to both the `node` and `exec` methods below.
    // `shortCircuit` consumes the remaining queue without doing any processing, and `ercb` is a
    // callback function with significant error logic, depending on what value is passed into the
    // `onError` argument for `node` and `exec`.
	function shortCircuit(value, next) { if(!!next) next(); }
	function ercb(outQueue, onError, next, value, error, result) {
		if(!error) {
			outQueue.push(result);
			next();
		} else {
			if(!onError) { // false or undefined, catches `undefined`s `instanceof` doesn't like
			} else if(onError instanceof Function) {
				this.setHandler(shortCircuit);
				onError(error, result, value);
			} else if(typeof(onError) == 'string') {
				q(onError).push([error, result, value]);
				next();
			} else { // 'truthy' value
				this.setHandler(shortCircuit);
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
		var outQueue = new this.qType();
		this.setHandler(function(value, next) {
			if(!(value instanceof Array)) value = [value];
			if(!next) {
				outQueue[value]();
			} else {
				if(q.isAsync(callback, value.length+1)) {
					value.push(ercb.bind(this, outQueue, onError, next, value));
					callback.apply(this, value);
				} else {
					try {
						ercb(outQueue, onError, next, value, undefined, callback.apply(this, value));
					} catch(e) {
						ercb(outQueue, onError, next, value, e);
					}
				}
			}
		}.bind(this));
		return outQueue;
	};
	Q.prototype.nodeAsync = q.makeAsync(Q.prototype.node);
	Q.prototype.nodeSync = q.makeSync(Q.prototype.node);

    // ``exec`` assumes the incoming value is a function to execute and takes a couple of arguments.
    // The first is an array of arguments for the function, the second is what to do if there is an
    // error, similar to ``node`` above. ``execCommon`` is the base for all three versions of ``exec``
    function execCommon(forceSyncAsync, args, onError) {
        var outQueue = new this.qType();
        this.setHandler(function(value, next) {
            if(!next) return outQueue[value]();
            if(!(value instanceof Function)) return ercb(outQueue, onError, next, value, new Error('Not a function'), undefined);
            if(forceSyncAsync == 'async' || (forceSyncAsync != 'sync' && q.isAsync(value, args.length+1))) {
                args.push(ercb.bind(this, outQueue, onError, next, value));
                value.apply(this, args);
            } else {
                try {
                    ercb(outQueue, onError, next, value, undefined, value.apply(this, args));
                } catch(e) {
                    ercb(outQueue, onError, next, value, e);
                }
            }
        }.bind(this));
        return outQueue;
    };
	Q.prototype.exec = function exec(args, onError) {
        return execCommon.bind(this, false)(args, onError);
    };
    Q.prototype.execSync = function execSync(args, onError) {
        return execCommon.bind(this, 'sync')(args, onError);
    };
    Q.prototype.execAsync = function execAsync(args, onError) {
        return execCommon.bind(this, 'async')(args, onError);
    };

	// ``chain`` is a simple application of ``branch`` when you always want to branch to the same queue
	Q.prototype.chain = function chain(queue) {
		this.branch(function() { return queue; });
		return this;
	};

    // Export the `q` helper function, keeping the alteration of the global scope to a minimum
	return q;
})();

// If in a CommonJS environment like Node.js, export queue-flow
if(module && module.exports) {
	module.exports = q;
}
