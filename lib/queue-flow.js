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

	// `async` attaches an `async` property to a given object
	// and returns said object. Alias `cps`.
	q.cps = q.async = function async(method) {
		method.async = true;
		return method;
	};

	// Expose the `Q` constructor function (below) so third parties can extend its prototype
	q.Q = Q;

	// Create a new queue-flow environment/namespace
	q.ns = qEnv;

	// The `Q` constructor function, which either uses the supplied queueing engine, or
	// uses the built-in in-memory engine.
	function Q(nameOrArray, qType) {
		var self = this;
		this.qType = !!qType && qType instanceof Function ? qType : Q;

		// Private variables, the handlers and actual queue array
		var eventHandlers = {};
		var queue = nameOrArray instanceof Array ? nameOrArray : [];
		var handler = undefined;
		var handlerBusy = false;
		var closeAfterHandler = false;

		// Privileged methods

		// `on` registers event handlers
		this.on = function on(eventName, handler) {
			if(!eventHandlers) eventHandlers = {};
			eventHandlers[eventName] = eventHandlers[eventName] instanceof Array ? eventHandlers[eventName] : [];
			eventHandlers[eventName].push(handler);
			return this;
		};

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
						return handler.apply(self, newArgs) !== false;
					}
					return true;
				});
			} else {
				return true;
			}
		};

		// `clear` clears all event handlers from the specified event
		this.clear = function clear(eventName) {
			eventHandlers[eventName] = [];
		};

		// `setHandler` defines the special function to call to process the queue
		// assumed to be ready initially, when called marked busy, call provided callback to
		// mark ready again. `each` is a synonym
		this.each = this.setHandler = function setHandler(handlerFunc) {
			handler = handlerFunc;
			setTimeout(handlerCallback, 0);
			return this;
		};

		// The `handlerCallback` is provided to the handler along with the dequeued value.
		// If there is more work to be done, it continues, otherwise is marks the handler
		// as ready for when the data next arrives
		var handlerCallback = function handlerCallback() {
			handlerBusy = false;
			if(queue && queue.length > 0) {
				var value = queue[0];
				if(self.fire('pull', value) && handler instanceof Function) {
					handlerBusy = true;
					setTimeout(handler.bind(self, queue.shift(), handlerCallback), 0);
				}
			} else if(handler instanceof Function && !!self) {
				self.fire('empty');
				if(closeAfterHandler) self.close();
			}
		};

		// Inserts a specified value into the queue, if allowed by the event handlers, and
		// calls the special handler function, if it's ready.
		this.push = function push(value) {
			var values = Array.prototype.slice.call(arguments, 0);
			if(this.fire('push', values)) {
				Array.prototype.push.apply(queue, values);
				setTimeout(handlerCallback, 0);
			}
			return this;
		};

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
							setTimeout(handler.bind(this, queue.shift(), flushQueue), 0);
						}
					} else {
						setTimeout(function() {
							if(handler instanceof Function) {
								handler('close');
							}
							eventHandlers = undefined;
							queue = undefined;
							handler = undefined;
							self = undefined;
							delete this;
						}, 0);
					}
				}
				setTimeout(flushQueue.bind(this), 0);
			}
		};

		// Ignore all of this and replace with a custom handler object (that still gets the
		// prototypal methods, and *must* implement these special public methods)
		if(qType && qType instanceof Function) {
			this = new qType(nameOrArray);
		}

		// Start processing the queue after the next JS event loop cycle and return the queue
		// object to the remaining code.
		setTimeout(handlerCallback, 0);
		if(queue.length > 0) this.closeOnEmpty();
		return this;
	}

	// `Q` prototype methods

	// `as` names or aliases the given queue
	Q.prototype.as = function as(name) {
		namedQueues[name] = this;
		this.clear('empty');
		return this;
	};

	// `closeOnEmpty` attaches an event handler that closes the queue once empty
	Q.prototype.closeOnEmpty = function closeOnEmpty() {
		setTimeout((function() {
			this.on('empty', this.close);
		}).bind(this), 0);
		return this;
	};

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
				outQueue.close();
			} else {
				if(callback.async) {
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

	// `reduce` creates an output variable, and executes
	// the second callback once upstream has `close()`d
	Q.prototype.reduce = function reduce(callback, last, initial) {
		var out = initial;
		this.setHandler((function(value, next) {
			if(!next) {
				if(!!last) last(out);
			} else {
				if(callback.async) {
					callback(out, value, setResult.bind(this, function(result) {
						out = result;
					}, next));
				} else {
					out = callback(out, value);
					next();
				}
			}
		}).bind(this));
		return this;
	};

	// `filter` creates an output queue, and executes
	// the given callback on each value, pushing the
	// original value *only* if the callback returns true.
	Q.prototype.filter = function filter(callback) {
		var outQueue = new this.qType();
		return inOut.bind(this)(outQueue, function filterSetter(value, result) {
			if(result) outQueue.push(value);
		}, callback);
	};

	// `branch` creates several named output queues and pushes the input queue
	// values into one of those queues based on the return value of the callback
	// (the return value is the name of the queue it belongs to)
	Q.prototype.branch = function branch(callback) {
		var branches = {};
		this.setHandler((function(value, next) {
			if(!next) {
				Object.keys(branches).forEach(function(branch) {
					q(branch).close();
				});
			} else {
				if(callback.async) {
					callback(value, setResult.bind(this, function(result) {
						branches[result] = true;
						q(result).push(value);
					}, next));
				} else {
					var result = callback(value);
					branches[result] = true;
					q(result).push(value);
					next();
				}
			}
		}).bind(this));
		return this;
	};

	// `everySome` helper function that is used to implement `Q.prototype.every`
	// and `Q.prototype.some`
	var everySome = function everySome(polarity, callback, last) {
		function shortCircuit(value, next) { if(!!next) next(); }
		this.setHandler((function(value, next) {
			if(!next) {
				if(!!last) last(!polarity); // Reverse the polarity on the deflector shield!
			} else {
				if(callback.async) {
					callback(value, function(result) {
						if(!result && !!last) {
							this.setHandler(shortCircuit);
							last(polarity);
						}
						next();
					});
				} else {
					if(!callback(value) && !!last) {
						this.setHandler(shortCircuit);
						last(polarity);
					}
					next();
				}
			}
		}).bind(this));
		return this;
	};
	// `every` returns true only if the callback has returned true every time. Immediately returns false
	// when false and closes the input queue in this event. A specialization of the `reduce` method.
	Q.prototype.every = function every(callback, last) { return everySome.bind(this, false, callback, last)(); };

	// `some` returns true only if the callback has returned true at least once. Immediately returns true
	// when true and closes the input queue in this event.
	Q.prototype.some = function some(callback, last) { return everySome.bind(this, true, callback, last)(); };

	// `toArray` returns an array from the given queue. A specialization of the `reduce` method.
	Q.prototype.toArray = function toArray(last) {
		this.reduce(function(cumm, value) {
			cumm.push(value);
			return cumm;
		}, last, []);
		return this;
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
				outQueue.close();
			} else {
				processValue(value, 0);
				next();
			}
		});
		return outQueue;
	};

	// `exec` is a slightly modified version of `map` that takes the input value, and if it is an
	// array, provides each value as an independent argument to the provided callback. It also assumes
	// the method returns an array of two values, or if async calls the callback with two arguments.
	// These arguments are considered to be `error` and `value`, in that order, which matches most of
	// the Node.js API callbacks. A second parameter can also be set to determine what `exec` does when
	// an error is returned. If not set, `exec` simply ignores the error and value and processes the
	// next item in the queue. If set to `true`, it kills the queue at this point. If set to a function,
	// it kills the queue and calls the function with the error and value. If set to a string, it
	// passes the error and value into a queue of the same name and continues processing the rest of
	// the queue. Finally, the `cbThis` optional argument specifies what the callback should be bound to,
	// allowing methods to continue to function as expected when called. This means stringing multiple
	// Node.js API calls may be done with a series of `map` and `exec` calls.
	Q.prototype.exec = function exec(callback, onError, cbThis) {
		var outQueue = new this.qType();
		function shortCircuit(value, next) { if(!!next) next(); }
		function ercb(next, error, result) {
			if(!error) {
				outQueue.push(result);
				next();
			} else {
				if(!onError) { // false or undefined, catches `undefined`s `instanceof` doesn't like
				} else if(onError instanceof Function) {
					this.setHandler(shortCircuit);
					onError(error, result);
				} else if(typeof(onError) == 'string') {
					q(onError).push([error, result]);
					next();
				} else { // 'truthy' value
					this.setHandler(shortCircuit);
				}
			}
		}
		this.setHandler((function(value, next) {
			if(!(value instanceof Array)) value = [value];
			if(!next) {
				outQueue.close();
			} else {
				if(callback.async) {
					value.push(ercb.bind(this, next));
					callback.apply(cbThis || this, value);
				} else {
					var results = callback.apply(cbThis || this, value);
					if(!(results instanceof Array)) results = [results];
					results.unshift(next);
					ercb.apply(this, results);
				}
			}
		}).bind(this));
		return outQueue;
	};
	
	return q;
})();

// If in a CommonJS environment like Node.js, export queue-flow
if(module && module.exports) {
	module.exports = q;
}
