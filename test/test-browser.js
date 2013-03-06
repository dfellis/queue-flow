var tape = require('tape');
var q = require('../lib/queue-flow', true);

tape('toArray', function(test) {
	test.plan(1);
	q([1, 2, 3])
		.toArray(function(result) {
			test.equal([1, 2, 3].toString(), result.toString(), 'array passes through the queue');
			test.end();
		});
});

tape('toArrayNamedQueue', function(test) {
	test.plan(1);
	q([1, 2, 3]).toArray('testToArrayNamedQueue');
	q('testToArrayNamedQueue')
		.each(function(result) {
			test.equal([1, 2, 3].toString(), result.toString(), 'array passed to named queue');
			test.end();
		});
});

tape('toArrayAnonQueue', function(test) {
	test.plan(1);
	q([1, 2, 3])
		.toArray()
		.each(function(result) {
			test.equal([1, 2, 3].toString(), result.toString(), 'array passed on in anonymous queue');
			test.end();
		});
});

tape('as', function(test) {
	test.plan(1);
	q([1, 2, 3]).as('test1');
	q('test1').close().toArray(function(result) {
		test.equal([1, 2, 3].toString(), result.toString(), 'named queue properly referenceable');
		test.end();
	});
});

tape('push', function(test) {
	test.plan(1);
	q('test2').push(1, 2, 3).close().toArray(function(result) {
		test.equal([1, 2, 3].toString(), result.toString(), 'named queue with elements pushed after-the-fact properly referenceable');
		test.end();
	});
});

tape('map', function(test) {
	test.plan(1);
	q([1, 2, 3]).map(function(value) {
		return value*2;
	}).toArray(function(result) {
		test.equal([2, 4, 6].toString(), result.toString(), 'queue mapped properly');
		test.end();
	});
});

tape('reduce', function(test) {
	test.plan(1);
	q([1, 2, 3])
		.reduce(function(prev, curr) {
			return prev + curr;
		}, function(result) {
			test.equal(6, result, 'queue reduced properly');
			test.end();
		}, 0);
});

tape('reduceNamedQueue', function(test) {
	test.plan(1);
	q([1, 2, 3])
		.reduce(function(prev, curr) {
			return prev + curr;
		}, 'testReduceNamedQueue', 0);
	q('testReduceNamedQueue')
		.each(function(result) {
			test.equal(6, result, 'reduce passed to named queue');
			test.end();
		});
});

tape('reduceAnonQueue', function(test) {
	test.plan(1);
	q([1, 2, 3])
		.reduce(function(prev, curr) {
			return prev + curr;
		}, null, 0)
		.each(function(result) {
			test.equal(6, result, 'reduce passed to anon queue');
			test.end();
		});
});

tape('filter', function(test) {
	test.plan(1);
	q([1, 2, 'skip a few', 99, 100])
		.filter(function(value) {
			return value == value + 0;
		})
		.toArray(function(result) {
			test.equal([1, 2, 99, 100].toString(), result.toString(), 'queue properly filtered');
			test.end();
		});
});

tape('on', function(test) {
	test.plan(5);
	q([1, 2, 3])
		.on('close', function() {
			test.ok(true, 'close event fired');
		})
		.on('pull', function() {
			test.ok(true, 'pull event fired');
		})
		.on('empty', function() {
			test.ok(true, 'empty event fired');
			test.end();
		})
		.toArray(function() { });
	q([1, 2, 3])
		.on('close', function() {
			return false;
		})
		.toArray(function() {
			test.ok(false, 'array method never executes final callback');
		});
});

tape('branch', function(test) {
	test.plan(3);
	q([1, 2, 'skip a few', 99, 100])
		.branch(function(value) {
			if(value == value + 0) {
				return value > 50 ? 'big' : 'small';
			} else {
				return 'invalid';
			}
		})
		.on('close', function() {
			process.nextTick(function() {
				q('big').close();
				q('small').close();
				q('invalid').close();
			});
		});
	var num = 0;
	q('big')
		.toArray(function(result) {
			test.equal([99, 100].toString(), result.toString(), 'big queue properly populated');
			num++;
			if(num == 3) test.end();
		});
	q('small')
		.toArray(function(result) {
			test.equal([1, 2].toString(), result.toString(), 'small queue properly populated');
			num++;
			if(num == 3) test.end();
		});
	q('invalid')
		.toArray(function(result) {
			test.equal(['skip a few'].toString(), result.toString(), 'invalid queue properly populated');
			num++;
			if(num == 3) test.end();
		});
});

tape('latency', function(test) {
	test.plan(1);
	var currentMapVal = Infinity;
	var reducedLatency = false;
	q([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
		.map(function(val) {
			currentMapVal = val;
			return val;
		})
		.reduce(function(prev, val) {
			if(currentMapVal < 10) {
				reducedLatency = true;
			}
			return val;
		}, function(result) {
			test.ok(reducedLatency, 'reduce started processing before map completed');
			test.end();
		});
});

tape('async', function(test) {
	test.plan(1);
	q([1, 2, 3])
		.map(function(val, callback) {
			callback(val*2);
		})
		.mapAsync(function() {
			var val = arguments[0], callback = arguments[1];
			callback(val);
		})
		.toArray(function(result) {
			test.equal([2, 4, 6].toString(), result.toString(), 'asynchronous methods also complete as expected');
			test.end();
		});
});

tape('everySome', function(test) {
	test.plan(2);
	var count = 0;
	q([1, 2, 'buckle my shoe'])
		.every(function(value) {
			return value == value*1;
		}, function(result) {
			test.equal(false, result, 'every finds the string and barfs');
			count++;
			if(count == 2) test.end();
		});
		q([3, 4, 'shut the door']).some(function(value) {
			return value == value*1;
		}, function(result) {
			test.equal(true, result, 'some finds the first number');
			count++;
			if(count == 2) test.end();
		});
});

tape('everySomeNamedQueue', function(test) {
	// No need to test both branches because they use the same underlying method
	// and previous test confirmed the logic is sound for both.
	test.plan(1);
	q([5, 6, 'grab some sticks'])
		.every(function(value) {
			return value == value*1;
		}, 'testEveryNamedQueue');
	q('testEveryNamedQueue')
		.each(function(result) {
			test.equal(false, result, 'every finds the string and barfs');
			test.end();
		});
});

tape('everySomeAnonQueue', function(test) {
	test.plan(1);
	q([7, 8, 'open the gate'])
		.some(function(value) {
			return value == value*1;
		})
		.each(function(result) {
			test.equal(true, result, 'some finds the first number');
			test.end();
		});
});

tape('everySomeClosedQueue', function(test) {
	test.plan(2);
	q([1, 2, 3])
		.every(function(val) {
			return val/1 == val;
		}, function(result) {
			test.ok(result, 'all values were numbers');
			q('asyncClosingQueue').push(1, 'not a number', 3).close();
		});
	q('asyncClosingQueue')
		.every(function(val, callback) {
			callback(val/1 == val);
		}, function(result) {
			test.ok(!result, 'some value was not a number!');
			test.end();
		});
});

/*tape('flattenAndNode', function(test) {
	test.plan(1);
	q(['.'])
		.node(fs.readdir, 'error')
		.flatten()
		.map(function(filename) {
			return ['./' + filename, 'utf8'];
		})
		.node(fs.readFile)
		.reduce(function(concat, fileData) {
			return concat + fileData;
		}, function(result) {
			test.equal(typeof(result), 'string', 'all files concatenated properly');
			test.end();
		}, '');
	q('error')
		.each(function(errorOut) {
			test.ok(false, 'No error should have occurred');
			test.end();
		});
});*/

tape('flattenDepth', function(test) {
	test.plan(1);
	q([1, [2, [3, [4, [5]]]]])
		.flatten(2)
		.toArray(function(val) {
			test.equal([1, 2, 3, [4, [5]]].toString(), val.toString(), 'flattened input only to a specified depth');
			test.end();
		});
});

tape('nodeAlternateErrorHandlers', function(test) {
	test.plan(4);
    var onError = q();
	q([new Error('this is an error!'), 'never going to run'])
		.node(function(arg) {
			if(arg instanceof Error) throw arg;
			return arg;
		}, function(error) {
			test.ok(error instanceof Error, 'the error was passed to the error callback');
			q('unnamedErrorHandler').push(error);
		});
    q('unnamedErrorHandler')
        .each(function(val) {
            test.ok(true, 'the error is in the unnamed error handler');
        })
        .node(function(arg) {
            if(arg instanceof Error) throw arg;
            return arg;
        }, onError)
        .each(function(val) {
            test.ok(false, 'never going to run');
        });
    onError
        .each(function(error) {
            test.ok(true, 'error is in the onError queue');
            q('truthyErrorHandler').push(error);
        });
	q('truthyErrorHandler')
		.each(function(val) {
			test.ok(true, 'the error is now here');
			test.end();
		})
        .node(function(arg) {
			if(arg instanceof Error) throw arg;
			return arg;
		}, true)
		.each(function(val) {
			test.ok(false, 'never going to run');
		});
});

tape('namespaces', function(test) {
	test.plan(1);
	var foo = q.ns();
	var bar = q.ns();

	test.notStrictEqual(foo('baz'), bar('baz'), 'separate namespaces create separate Q instances with the same name');
	test.end();
});

tape('each', function(test) {
	test.plan(5);
	var currVal = 0;
	q([1, 2, 3])
		.each(function(value) {
			test.ok(currVal < value, 'side-effect function received one of the values, in the proper order');
			currVal = value;
		})
		.toArray(function(array) {
			test.equal(array.toString(), [1, 2, 3].toString(), 'each passes the original data along');
			test.equal(3, currVal, 'and the side effect remains and at the proper value');
			test.end();
		});
});

tape('tuple', function(test) {
	test.plan(1);
	test.equal(q.tuple({
		a: 'b', c: 'd', e: 'f', g: 'h', i: 'j', k: 'l', m: 'n', o: 'p', q: 'r', s: 't', u: 'v', w: 'x', y: 'z'
	}).length, 13, 'tuple properly converts object into array of key-value tuples');
	test.end();
});

tape('syncNode', function(test) {
	test.plan(3);
	q([['foo', 'bar']])
		.node(function(foo, bar) {
			if(foo == 'foo' && bar == 'bar') throw 'baz';
		}, 'syncError');
	q('syncError')
		.each(function(errorArr) {
			test.equal(errorArr[0], 'baz');
			test.equal(errorArr[1], undefined);
			test.equal(errorArr[2].toString(), 'foo,bar');
			test.end();
		});
});

tape('exists', function(test) {
	test.plan(3);
	q('exists');
	test.equal(q.exists('exists'), true, 'existing queue exists!');
	test.equal(q.exists('notExists'), false, 'notExisting queue does not exist!');
	q('exists')
		.on('close', function() {
			setTimeout(function() {
				test.equal(q.exists('exists'), false, 'closed object correctly deleted');
				test.end();
			}, 50); // handler for 'close' event can return false and block the closing of the queue
			// so it actually runs *just before* the closing occurs
		})
		.close();
});

tape('kill', function(test) {
	test.plan(2);
	q('toKill').kill();
	test.equal(q.exists('toKill'), false, 'kills the queue, immediately');
	q('toKill')
		.branch('toAlsoKill');
	q('toKill').kill();
	test.equal(q.exists('toAlsoKill'), false, 'kills the branch, immediately');
	test.end();
});

tape('multiBranch', function(test) {
	var testCount = 0, testTotal = 6;
	test.plan(testTotal);
	function eachFuncBuilder(expectedVal, explanatoryText) {
		return function(val) {
			test.equal(val, expectedVal, explanatoryText);
			testCount++;
			if(testCount == testTotal) test.end();
		};
	}
	q(['foo'])
		.branch(['bar', 'baz']);
	q('bar')
		.each(eachFuncBuilder('foo', 'bar received the value'));
	q('baz')
		.each(eachFuncBuilder('foo', 'baz received the value'));
	q(['another', 'queue'])
		.branch(function(val) {
			if(val == 'queue') return 'queue';
			return ['three', 'other', 'queues'];
		});
	q('queue')
		.each(eachFuncBuilder('queue', 'queue received queue!'));
	q('three')
		.each(eachFuncBuilder('another', 'three received the value'));
	q('other')
		.each(eachFuncBuilder('another', 'other received the value'));
	q('queues')
		.each(eachFuncBuilder('another', 'queues received the value'));
});

tape('sync', function(test) {
	test.plan(1);
	function syncFuncWithOptionalParam(val, opt) {
		if(opt) return val / opt;
		return val / 2;
	}
	q([2, 4, 6, 8, 10])
		.mapSync(syncFuncWithOptionalParam)
		.toArray(function(arr) {
			test.equal([1, 2, 3, 4, 5].toString(), arr.toString(), 'mapSync did not pass a callback function');
			test.end();
		});
});

tape('asyncEventHandler', function(test) {
	test.plan(1);
	q([1, 2, 3, 4, 5])
		.on('pull', function(val, callback) {
			setTimeout(callback.bind(this, val == 1), 25);
		})
		.each(function(val) {
			test.equal(1, val, 'only the first value is allowed through, even if event handler is async');
			test.end();
		});
});

tape('exec', function(test) {
	var count = 0, total = 3;
	test.plan(total);
	q([function(val) {
		test.equal('Hello, World!', val, 'provided function got the argument');
		count++;
		if(count == total) test.end();
	}, function(val, callback) {
		test.equal(callback instanceof Function, true, 'provided function a callback because it was async');
		count++;
		if(count == total) test.end();
		process.nextTick(callback);
	}, 'notAFunction'])
		.exec('Hello, World!', 'execError');
	q('execError')
		.each(function(errResArgs) {
			test.equal(errResArgs[2], 'notAFunction', 'The string was thrown into the error queue');
			count++;
			if(count == total) test.end();
		});
});

tape('execSyncAsync', function(test) {
	test.plan(4);
	q([function(val) {
		test.ok(val, 'got the bool as expected');
	}]).execSync([true]);
	q([function(arg) {
		throw arg;
	}]).execSync(['error'], 'syncError');
	q('syncError')
		.each(function(errArr) {
			test.equal(errArr[0], 'error', 'caught the thrown error properly');
		});
	q([function(val, callback) {
		callback(null, !val);
	}]).execAsync([false]).each(function(val) {
		test.ok(val, 'the bool was properly inverted and passed along');
		q('asyncExec').push(function(arg, callback) {
			callback(arg);
		});
	});
	q('asyncExec')
		.execAsync(['error'], 'asyncError');
	q('asyncError')
		.each(function(errArr) {
			test.equal(errArr[0], 'error', 'intercepted error from async function');
			test.end();
		});
});

tape('execArgsMethods', function(test) {
	test.plan(3);
	q([function(val) {
		test.ok(val, 'got true because this is a function as expected');
		q('execArgsContinue').push(function(val, callback) {
			test.ok(val, 'got true because this is an async function');
			q('execArgsFinal').push(function(val) {
				return 'I will never run';
			});
			callback();
		});
	}]).exec(function(func) {
		return func instanceof Function;
	});
	q('execArgsContinue')
		.exec(function(func, callback) {
			callback(q.isAsync(func, 2));
		});
	q('execArgsFinal')
		.exec(function(func) {
			throw func;
		}, function(error) {
			test.ok(error instanceof Function, 'received the thrown function properly');
			test.end();
		});
});

tape('eachAsync', function(test) {
	test.plan(2);
	q([1])
		.each(function(val, next) {
			test.equal(next instanceof Function, true, 'each can be accessed asynchronously');
			next('bogus value');
		})
		.each(function(val) {
			test.equal(val, 1, 'async each ignores returned values');
			test.end();
		});
});

tape('asyncMapReduce', function(test) {
	test.plan(1);
	q([0, 1, 2, 3, 4, 5])
		.map(function(val, cb) {
			setTimeout(function() { cb(val * 2) }, Math.random() * 100);
		})
		.reduce(function(sum, cur, cb) {
			cb(sum + cur);
		}, function(result) {
			test.equal(result, 30, 'All values doubled and summed together');
			test.end();
		}, 0);
});

tape('asyncEachMapReduce', function(test) {
	test.plan(1);
	q([0, 1, 2, 3, 4, 5])
		.each(function(){})
		.map(function(val, cb) {
			setTimeout(function() { cb(val * 2) }, Math.random() * 100);
		})
		.reduce(function(sum, cur, cb) {
			cb(sum + cur);
		}, function(result) {
			test.equal(result, 30, 'All values logged, doubled, and summed together');
			test.end();
		}, 0);
});

tape('wait', function(test) {
	test.plan(6);
	var startTime = new Date().getTime();
	q([1, 2, 3, 4, 5])
		.wait(50)
		.toArray(function(arr) {
			test.equal([1, 2, 3, 4, 5].toString(), arr.toString(), 'acts like a normal each when delayed');
			var endTime = new Date().getTime();
			test.ok(endTime - startTime > 200, 'total delayed time is approximately reached');
			startTime = endTime; // Reset time for next test
			q('continue').concat(arr).close();
		});
	q('continue')
		.wait(function(val) {
			return val*100;
		})
		.toArray(function(arr) {
			test.equal([1, 2, 3, 4, 5].toString(), arr.toString(), 'kept the correct order (good test of queue correctness)');
			var endTime = new Date().getTime();
			test.ok(endTime - startTime > 1000, 'total delay time again reached');
			startTime = endTime;
			q('lastOne').concat(arr).close();
		});
	q('lastOne')
		.wait(function(val, callback) {
			callback(val*100);
		})
		.toArray(function(arr) {
			test.equal([1, 2, 3, 4, 5].toString(), arr.toString(), 'kept the order (again)');
			var endTime = new Date().getTime();
			test.ok(endTime - startTime > 1000, 'total delay time reached');
			test.end();
		});
});

tape('constantBranch', function(test) {
	test.plan(1);
	q([1, 2, 3])
		.branch('nextOne')
		.on('close', function() {
			process.nextTick(function() { q('nextOne').close(); });
		});
	q('nextOne')
		.toArray(function(arr) {
			test.equal([1, 2, 3].toString(), arr.toString(), 'got the values from the branch');
			test.end();
		});
});

tape('referenceBranch', function(test) {
	test.plan(1);
	var anonNonClosingQueue = new q.Q();
	q([1, 2, 3])
		.branch(anonNonClosingQueue)
		.on('close', function() {
			process.nextTick(function() { anonNonClosingQueue.close(); });
		});
	anonNonClosingQueue
		.toArray(function(arr) {
			test.equal([1, 2, 3].toString(), arr.toString(), 'got the values into an anonymous queue');
			test.end();
		});
});

tape('arrayBranch', function(test) {
	test.plan(2);
	q([1, 2, 3])
		.branch(['queue1', q('queue2')])
		.on('close', function() {
			process.nextTick(function() {
				q('queue1').close();
				q('queue2').close();
			});
		});
	var finishedQueues = 0;
	q('queue1')
		.toArray(function(arr) {
			test.equal([1, 2, 3].toString(), arr.toString(), 'first queue got the values');
			finishedQueues++;
			if(finishedQueues == 2) test.end();
		});
	q('queue2')
		.toArray(function(arr) {
			test.equal([1, 2, 3].toString(), arr.toString(), 'second queue got the values');
			finishedQueues++;
			if(finishedQueues == 2) test.end();
		});
});

tape('asyncBranch', function(test) {
	var runs = 0, total = 4;
	test.plan(total);
	q([1, 2, 3])
		.branch(function(val, callback) {
			if(val/2 == Math.floor(val/2)) {
				callback(['number', 'even']);
			} else if(val/1 == val) {
				callback('number');
			} else {
				callback('BranchError');
			}
		});
		q('number')
			.each(function(val) {
				test.ok(val/1 == val, 'a number was passed in here');
				runs++;
				if(runs == total) test.end();
			});
		q('even')
			.each(function(val) {
				test.ok(val/2 == Math.floor(val/2), 'an even number was passed in here');
				runs++;
				if(runs == total) test.end();
			});
		q('BranchError')
			.each(function(val) {
				test.ok(false, 'nothing should come into this queue');
				test.end();
			});
});

tape('defaultQ', function(test) {
	test.plan(1);
	var testQ = q.ns();
	function fakeConstructor(nameOrArray, qType) {
		this.foo = function() {
			return 'foo';
		};
		return this;
	}
	testQ.defaultQ = fakeConstructor;
	test.equal(testQ('test').foo(), 'foo', 'used the fake constructor');
	test.end();
});

tape('emptyAnonymousQ', function(test) {
	test.plan(1);
	var emptyAnonymousQ = q();
	test.ok(emptyAnonymousQ instanceof q.Q, 'returned a proper Q instance');
	test.end();
});

tape('subqueue', function(test) {
	test.plan(2);
	function syncSubQ(subQ) {
		return subQ
			.map(function() { return 'foo'; });
	}
	function asyncSubQ(subQ, callback) {
		setTimeout(function() {
			var out = subQ
				.map(function() { return 'bar'; });
			callback(out)
		}, 50);
	}
	q([1])
		.subqueue(syncSubQ)
		.each(function(val) {
			test.equal('foo', val, 'sync subqueue worked');
		})
		.subqueue(asyncSubQ)
		.each(function(val) {
			test.equal('bar', val, 'async subqueue worked');
			test.end();
		});
});

tape('promise', function(test) {
	test.plan(2);
	function simplePromise(val) {
		return {
			then: function(resultFunc, errorFunc) {
				if(val instanceof Error) {
					setTimeout(errorFunc.bind(this, val), 50);
				} else {
					setTimeout(resultFunc.bind(this, val), 50);
				}
			}
		};
	}
	q([1, new Error('hi')])
		.promise(simplePromise, 'error')
		.promise(simplePromise, q('error'))
		.promise(simplePromise, function() {})
		.promise(simplePromise)
		.each(function(val) {
			test.equal(val, 1, 'the valid value goes in');
			test.end();
		});
	q('error')
		.each(function(val) {
			test.ok(val instanceof Error, 'the error went into the error queue');
		});
});

tape('drain', function(test) {
    test.plan(2);
    var drainOutput = q([1])
        .each(function(value) {
            test.plan(1, value, 'the values are being passed on to the drain method');
        })
        .on('close', function() {
            test.end();
        }).drain();
    test.equal(undefined, drainOutput, 'drain returns nothing');
});
