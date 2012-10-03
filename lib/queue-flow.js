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
	// List of named queues
	var namedQueues = {};

	// For browser compatibility, masquerade `setTimeout` as `process.nextTick`
	// This is to work around an issue with Node 0.6 where `setTimeout(someFunc, 0)`
	// doesn't behave like `process.nextTick`
	if(!process || !process.nextTick) {
		process = process || {};
		process.nextTick = process.nextTick || setTimeout;
	}

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
	// the developer can use the `async` method to clarify it is actually async in that case.
	q.isAsync = function isAsync(method, asyncArgLength) {
		return method.async|| (!method.sync && method.length == asyncArgLength);
	};

	// Expose the `Q` constructor function (below) so third parties can extend its prototype
	q.Q = Q;

	// Create a new queue-flow environment/namespace
	q.ns = qEnv;

	// `tuple` converts an object into an array of arrays. The arrays are tuples of the
	// key-value pairs from the object, so they can be processed individually in a queue-flow
	// if desired, rather than considering the whole object as a single item in the queue.
	q.tuple = function tuple(obj) {
		return Object.keys(obj).reduce(function(outArr, key) { return outArr.concat([[key, obj[key]]]); }, []);
	};

	// The `Q` constructor function, which either uses the supplied queueing engine, or
	// uses the built-in in-memory engine.
	function Q(nameOrArray, qType) {
		this.qType = !!qType && qType instanceof Function ? qType : Q;

		// Private variables, the handlers and actual queue array
		var eventHandlers = {};
		var queue = nameOrArray instanceof Array ? nameOrArray : [];
		var handler = undefined;
		var handlerBusy = false;
		var closeAfterHandler = false;
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
			var newArgs = Array.prototype.slice.call(arguments, 1);
			if(!eventHandlers) {
				return false;
			} else if(eventHandlers[eventName]) {
				return eventHandlers[eventName].every(function(handler) {
					if(handler instanceof Function) {
						return handler.apply(this, newArgs) !== false;
					}
					return true;
				}.bind(this));
			} else {
				return true;
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
			process.nextTick(handlerCallback.bind(this));
			return this;
		}.bind(this);

		// The `handlerCallback` is provided to the handler along with the dequeued value.
		// If there is more work to be done, it continues, otherwise is marks the handler
		// as ready for when the data next arrives
		var handlerCallback = function handlerCallback() {
			handlerBusy = false;
			if(queue && queue.length > 0) {
				var value = queue[0];
				if(this.fire('pull', value) && handler instanceof Function) {
					handlerBusy = true;
					process.nextTick(handler.bind(this, queue.shift(), handlerCallback.bind(this)));
				}
			} else if(handler instanceof Function && !!this) {
				if(!recentlyEmptied) {
					this.fire('empty');
					recentlyEmptied = true;
				}
				if(closeAfterHandler) this.close();
			}
		};

		// Inserts a specified value into the queue, if allowed by the event handlers, and
		// calls the special handler function, if it's ready.
		this.push = function push(value) {
			recentlyEmptied = false;
			var values = Array.prototype.slice.call(arguments, 0);
			if(this.fire('push', values)) {
				Array.prototype.push.apply(queue, values);
				process.nextTick(handlerCallback.bind(this));
			}
			return this;
		}.bind(this);
		
        // Signals that the queue is being destroyed and then, if allowed, destroys it
		this.close = function close() {
			if(handlerBusy) {
				closeAfterHandler = true;
			} else if(this.fire('close')) {
				this.clear('close');
				this.on('close', function() { return false; });
				function flushQueue() {
					if(queue && queue.length > 0 && handler instanceof Function) {
						var value = queue[0];
						if(this.fire('pull', value)) {
							process.nextTick(handler.bind(this, queue.shift(), flushQueue));
						}
					} else {
						process.nextTick(function() {
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
						}.bind(this), 0);
					}
				}
				process.nextTick(flushQueue.bind(this));
			}
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
			process.nextTick(handlerCallback.bind(this));
			if(queue.length > 0) this.on('empty', this.close.bind(this));
			return this;
		}
	}

	// `Q` prototype methods

	// `as` names or aliases the given queue
	Q.prototype.as = function as(name) {
		namedQueues[name] = this;
		this.clear('empty');
		return this;
	};

	// `load` is a simpler wrapper around `push` that takes a single array
	// and covers up the relatively nasty `apply` mechanism (when dealing with
	// queue-flow's particular object model
	Q.prototype.load = function load(array) {
		this.push.apply(this, array);
		// Getting the queue-flow object requires q('nameHere')
		// and q('nameHere').push.apply(q('nameHere'), array) is ugly and verbose
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
				callback(value);
				outQueue.push(value);
				next();
			}
		});
		return outQueue;
	};
	Q.prototype.eachAsync = q.makeAsync(Q.prototype.each);
	Q.prototype.eachSync = q.makeSync(Q.prototype.each);

	// `setResult` is a helper function useful for several of the Q prototype methods
	// to set their result in a regular fashion
	var setResult = function setResult(setter, next, result) {
		setter(result);
		next();
	};

	// `inOut` is a helper function useful for several of the Q prototype methods that
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
					});
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

	// `exec` is a slightly modified version of `map` that takes the input value, and if it is an
	// array, provides each value as an independent argument to the provided callback. It also assumes
	// the method returns a correct result and throws an error, or if async calls the callback with two
	// arguments, considered to be `error` and `value`, in that order, which matches most of the
	// Node.js API callbacks. A second parameter can also be set to determine what `exec` does when
	// an error is returned. If not set, `exec` simply ignores the error and value and processes the
	// next item in the queue. If set to `true`, it kills the queue at this point. If set to a function,
	// it kills the queue and calls the function with the error and value. If set to a string, it
	// passes the error and value into a queue of the same name and continues processing the rest of
	// the queue. If there was an error, for useful debugging the original params passed to exec are
	// also provided.
	Q.prototype.exec = function exec(callback, onError) {
		var outQueue = new this.qType();
		function shortCircuit(value, next) { if(!!next) next(); }
		function ercb(next, value, error, result) {
			if(!error) {
				outQueue.push(result);
				next();
			} else {
				if(!onError) { // false or undefined, catches `undefined`s `instanceof` doesn't like
				} else if(onError instanceof Function) {
					this.setHandler(shortCircuit);
					onError(error, result, value);
				} else if(typeof(onError) == 'string' && result != undefined) {
					q(onError).push([error, result, value]);
					next();
				} else if(typeof(onError) == 'string') {
					q(onError).push([error, undefined, value]);
					next();
				} else { // 'truthy' value
					this.setHandler(shortCircuit);
				}
			}
		}
		this.setHandler((function(value, next) {
			if(!(value instanceof Array)) value = [value];
			if(!next) {
				outQueue[value]();
			} else {
				if(q.isAsync(callback, value.length+1)) {
					value.push(ercb.bind(this, next, value));
					callback.apply(this, value);
				} else {
					var result;
					try {
						result = callback.apply(this, value);
					} catch(e) {
						return ercb(next, value, e);
					}
					return ercb(next, value, undefined, result);
				}
			}
		}).bind(this));
		return outQueue;
	};
	Q.prototype.execAsync = q.makeAsync(Q.prototype.exec);
	Q.prototype.execSync = q.makeSync(Q.prototype.exec);

	// ``chain`` is a simple application of ``branch`` when you always want to branch to the same queue
	Q.prototype.chain = function chain(queue) {
		this.branch(function() { return queue; });
		return this;
	};
	
	return q;
})();

// If in a CommonJS environment like Node.js, export queue-flow
if(module && module.exports) {
	module.exports = q;
}
