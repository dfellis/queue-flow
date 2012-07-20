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

	// The `Q` constructor function, which either uses the supplied queueing engine, or
	// uses the built-in in-memory engine.
	function Q(nameOrArray, qType) {
		var self = this;
		this.qType = !!qType && qType instanceof Function ? qType : Q;

		// Private variables, the handlers and actual queue array
		var eventHandlers = {};
		var queue = nameOrArray instanceof Array ? nameOrArray : [];
		var handler = { ready: false };

		this.getQueue = function() { return queue; };

		// Privileged methods

		// `on` registers event handlers
		this.on = function on(eventName, handler) {
			eventHandlers[eventName] = eventHandlers[eventName] instanceof Array ? eventHandlers[eventName] : [];
			eventHandlers[eventName].push(handler);
		};

		// `fire`` executes the event handlers, passing along whatever arguments given to it
		// minus the event name indicator, of course. If any handler returns false, it indicates
		// so, indiating to the method firing the event to cancel.
		this.fire = function fire(eventName) {
			var newArgs = Array.prototype.slice.call(arguments, 1);
			if(eventHandlers[eventName]) {
				return eventHandlers[eventName].every(function(handler) {
					return handler.apply(self, newArgs) !== false;
				});
			} else {
				return true;
			}
		};

		// `setHandler` defines the special function to call to process the queue
		// assumed to be ready initially, when called marked busy, call provided callback to
		// mark ready again. `each` is a synonym
		this.each = this.setHandler = function setHandler(handlerFunc) {
			handlerFunc.ready = false;
			handler = handlerFunc;
			handlerCallback();
			return self;
		};

		// The `handlerCallback` is provided to the handler along with the dequeued value.
		// If there is more work to be done, it continues, otherwise is marks the handler
		// as ready for when the data next arrives
		var handlerCallback = function handlerCallback() {
			if(queue.length > 0) {
				var value = queue.shift();
				if(self.fire('pull', value) && handler instanceof Function) {
					handler(value, handlerCallback);
				} else {
					queue.unshift(value);
				}
			} else if(handler instanceof Function) {
				if(self.fire('empty')) {
					handler.ready = true;
				}
			}
		};

		// Inserts a specified value into the queue, if allowed by the event handlers, and
		// calls the special handler function, if it's ready.
		this.push = function push(value) {
			var values = Array.prototype.slice.call(arguments, 0);
			if(self.fire('push', values)) {
				Array.prototype.push.apply(queue, values);
				if(handler.ready) {
					handler.ready = false;
					handlerCallback();
				}
			}
			return self;
		};

		// Signals that the queue is being destroyed and then, if allowed, destroys it
		this.close = function close() {
			if(self.fire('close')) {
				if(handler instanceof Function) {
					handler('close');
				}
				delete self;
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
		return this;
	}

	// `Q` prototype methods

	// `as` names or aliases the given queue
	Q.prototype.as = function as(name) {
		namedQueues[name] = this;
		return this;
	};

	// `async` attaches an `async` property to a given object
	// and returns said object. Alias `cps`.
	Q.prototype.cps = Q.prototype.async = function async(method) {
		method.async = true;
		return method;
	};

	// `closeOnEmpty` attaches an event handler that closes the queue once empty
	Q.prototype.closeOnEmpty = function closeOnEmpty() {
		this.on('empty', this.close);
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
					setResult(setter, next, callback(value));
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
		return inOut(outQueue, function mapSetter(value, result) {
			outQueue.push(result);
		}, callback);
	};

	// `reduce` creates an output variable, and executes
	// the second callback once upstream has `close()`d
	Q.prototype.reduce = function reduce(callback, last, initial) {
		var out = initial;
		this.setHandler(function(value, next) {
			if(!next) {
				last(out);
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
		});
		return this;
	};

	// `filter` creates an output queue, and executes
	// the given callback on each value, pushing the
	// original value *only* if the callback returns true.
	Q.prototype.filter = function filter(callback) {
		var outQueue = new this.qType();
		return inOut(outQueue, function filterSetter(value, result) {
			if(result) outQueue.push(value);
		}, callback);
	};

	// `branch` creates several named output queues and pushes the input queue
	// values into one of those queues based on the return value of the callback
	// (the return value is the name of the queue it belongs to)
	Q.prototype.branch = function branch(callback) {
		var branches = {};
		this.setHandler(function(value, next) {
			if(!next) {
				this.close();
			} else {
				if(callback.async) {
					callback(value, setResult.bind(this, function(result) {
						q(result).push(value);
						branches[result] = true;
					}, next));
				} else {
					var result = callback(value);
					q(result).push(value);
					branches[result] = true;
					next();
				}
			}
		});
		return this;
	};

	// `every` returns true only if the callback has returned true every time. Immediately returns false
	// when false and closes the input queue in this event. A specialization of the `reduce` method.
	Q.prototype.every = function every(callback, last) {
		this.reduce(this.async(function(cumm, value, next) {
			if(callback.async) {
				callback(value, function(result) {
					next(result);
					if(!result) this.close();
				});
			} else {
				var result = callback(value);
				next(result);
				if(!result) this.close();
			}
		}), last);
		return this;
	};

	// `some` returns true only if the callback has returned true at least once. Immediately returns true
	// when true and closes the input queue in this event.
	Q.prototype.some = function some(callback, last) {
		this.reduce(this.async(function(cumm, value, next) {
			if(callback.async) {
				callback(value, function(result) {
					next(result);
					if(result) this.close();
				});
			} else {
				var result = callback(value);
				next(result);
				if(result) this.close();
			}
		}), last);
		return this;
	};

	// `toArray` returns an array from the given queue. A specialization of the `reduce` method.
	Q.prototype.toArray = function toArray(last) {
		this.reduce(function(cumm, value) {
			cumm.push(value);
			return cumm;
		}, last, []);
		return this;
	};
	
	return q;
})();

if(module && module.exports) {
	module.exports = q;
}
