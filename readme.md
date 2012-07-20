# queue-flow

## Quick install instructions

For Node.js

    npm install queue-flow

For browsers, just copy ``./lib/queue-flow.js`` and include it in a ``<script>`` tag.

## Latency-reducing, async-capable functional programming using named (or not) queues

You'd very much like to use ECMAScript 5's nice functional programming concepts,

```js
console.log([1,2,3,4,5,6,7,8,9,10]
	.map(function(val) {
		console.log('map ' + val);
		return val;
	})
	.reduce(function(prev, val) {
		console.log('reduce ' + val);
		return val;
	}, 0)
);
```

Prints:

``
map 1
map 2
map 3
map 4
map 5
map 6
map 7
map 8
map 9
map 10
reduce 1
reduce 2
reduce 3
reduce 4
reduce 5
reduce 6
reduce 7
reduce 8
reduce 9
reduce 10
10
``

But there are two significant issues:

1. This is a blocking API, so no AJAX allowed, no Node.js libraries allowed.
2. Each step in the process will only start its work *after* the previous step has completed *all* of the work it has to do, meaning significant latency, especially when the processing time of the callback is unpredictable.

These deficiencies mean the clean, easy-to-read-and-refactor functional style aren't practical in Javascript. The [async library](https://github.com/caolan/async) makes significant headway on this problem, but still feels more awkward.

## Enter *queue-flow*

```js
var q = require('queue-flow');

q([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
	.map(function(val) {
		console.log('map ' + val);
		return val;
	})
	.reduce(function(prev, val) {
		console.log('reduce ' + val;
		return val;
	}, function(result) {
		console.log(result);
	}, 0);
```

Prints:

``
map 1
map 2
map 3
map 4
reduce 1
map 5
reduce 2
map 6
reduce 3
reduce 4
map 7
reduce 5
map 8
reduce 6
map 9
reduce 7
map 10
reduce 8
reduce 9
reduce 10
10
``

**queue-flow** builds a series of input and output queues for work to traverse from functional concept to functional concept, with reduce-style functions (that compress all values into a single result) instead having a final callback fired when the queue processing is completed.

Marking a callback as an asynchronous one (needed a callback passed to it, as well) so it can be used with jQuery ``$.ajax()`` calls or Node.js libraries, is also quite simple:

```js
q([1, 2, 3])
	.map(q.async(function(val, callback) {
		callback(val);
	}))
	.toArray(function(result) {
		console.log(result); // Prints [1, 2, 3]
	});
```

Queues can also be named and accessed elsewhere:

```js
q([1, 2, 3]).as('namedQueue');

q('namedQueue').toArray(function(result) {
	console.log(result); // [1, 2, 3]
});
```

Queues that are provided a full array initially automatically close when the queue empties. Queues can also be named and provide no initial values, which can be ``.push()``ed later. These queues must either be told to ``.closeOnEmpty()`` or must be manually ``.close()``d.

```js
q('initiallyEmpty')
	.push(1, 2, 3)
	.closeOnEmpty()
	.toArray(console.log); // [1, 2, 3]

q('alsoFirstEmpty')
	.push(4, 5, 6)
	.toArray(console.log);

q('alsoFirstEmpty').close(); // [4, 5, 6]
```

This behavior is used quite nicely by the ``.branch`` method, which is a new functional flow control mechanism for splitting your processing across different, easy-to-digest queue flows:

```js
q([1, 2, 'skip a few', 99, 100])
	.branch(function(value) {
		if(value == value + 0) { // is a number
			return value > 50 ? 'big' : 'small';
		} else {
			return 'invalid';
		}
	});

q('big')
	.map(function(value) {
		console.log(value + "? I can't count that high! Let's make it smaller.");
		return value - 50;
	})
	.each(function(value) {
		console.log(value + " is a much better number, don'tcha think?");
	});

q('small')
	.each(function(value) {
		console.log('Ahh... ' + value + ". That's a nice number!");
	});

q('invalid')
	.each(function(value) {
		console.warn(value + "? You can't do that!");
	});
```

Queue flows may also be monitored by event handlers, which borrow the jQuery syntax and can also cancel all events except ``empty`` (which would be nonsensical, as it's only informative).

```js
q([1, 2, 3])
	.on('pull', function(value) {
		console.log("Someone's a'stealin' my number " + value);
		console.log("I ain't lettin' ya!");
		return false;
	})
	.toArray(console.log); // Never fires
```

When requesting a queue, an optional second parameter may be provided to use a third-party constructor, which will be useful for things like queue-flows designed for Web Workers or Node Clusters, but none exist, yet. Developers of such a library should use the tests in the ``./test`` directory to verify proper behavior of their plugin.

```js
q([1, 2, 3], WebWorkerQueue); // Someday...
```

## API Reference

queue-flow consists of a helper function and its methods for initially constructing a queue-flow object, and the default queue-flow consructor and its methods (privileged and prototypal).

### ``q`` Accessor/Constructor Helper

This is the only thing publicly exposed by the library.

```js
q([nameOrArray], [qType]) // returns: new Q([nameOrArray], [qType])
```

``nameOrArray`` is either a string or an Array object, or can be left undefined.

When a string, the string is used as the queue's name, which is either found in the set of named queues or is constructed on the spot and added to the set.

When an array, the array is used to populate the unnamed queue immediately, and the queue is set to automatically close itself when empty.

When undefined, and unnamed queue is created with no values. This is the only unnamed queue that will not automatically close itself when empty.

``qType`` is either a constructor function or left undefined. queue-flow does nothing to verify that the provided constructor function is valid, except checking that it is a ``Function`` object, so use this mechanism with care!

### ``q.async`` (or ``q.cps``) Helper Method

This method flags a given function as one that should receive an asynchronous method list (with a callback) and the API will then expect the results be returned via the callback rather than immediately.

```js
q.async(func) // returns: modified func
```

Any ``Function`` object will succeed on this method, but it is up to the developer to make sure his arguments list matches the one specified for the queue processor his function is being given to.

### ``Q`` Constructor

This constructor is not publicly available, yet.

### ``new Q().on`` Privileged Method

```js
q('someQueue').on(event, callbackFunction); // returns Q instance
```

There are 4 events in queue-flow: ``push``, ``pull``, ``close``, and ``empty``. All events except ``empty`` may be cancelled by returning ``false``. The method signatures of the callbacks for each event are as follows:

```js
{
	push: function(value) {},
	pull: function(value) {},
	close: function() {},
	empty: function() {}
}
```

The callbacks' ``this`` is bound to the ``Q`` instance they are called on, more than one callback may be registered for a given event, they will be run in the order they are registered, and execution of event handlers will cease the moment any callback returns false (even for ``empty``, but it won't cancel the event in any other way).

### ``new Q().fire`` Privileged Method

```js
q('someQueue').fire(event, some, other, variables); // Returns true or false
```

This is the mechanism by which events are fired, and meant primarily as a private method. It is exposed to allow the user to false-fire an event if they choose to do so (not recommeded), or for new prototypal methods to fire a new event invented for themselves (more understandable).

The first argument is a string to identify the event, and the remaining arguments are made the new arguments to each registered event handler.

### ``new Q().clear`` Privileged Method

```js
q('someQueue').clear('empty'); // returns Q instance
```

This method clears out all event handlers for a given event.

### ``new Q().each`` (alias ``.setHandler``) Privileged Method

```js
q('someQueue').each(eachCallback); // returns Q instance
```

This method drains the queue and calls the given callback for each value. It is a very low-level queue processing function that is used internally by nearly all of the prototypal methods.

The ``eachCallback`` signature is simply ``function(value, callback) { }`` where the ``callback`` takes no arguments.

### ``new Q().push`` Privileged Method

This method pushes new values onto the queue. Each argument is a separate queue value.

### ``new Q().close`` Privileged Method

This method destroys the queue. If there is a registered mechanism for draining the queue, it waits until all remaining items in the queue have been drained, otherwise it destroys on the next run through the Javascript event loop.

### ``Q.prototype.as`` Method

```js
q([1, 2, 3]).as(name); // returns Q instance
```

This method take a string and registers the specific queue under that name. Queues may have more than one name.

### ``Q.prototype.closeOnEmpty`` Method

```js
q('name').closeOnEmpty(); // returns Q instance
```

This method registers an event handler for the ``empty`` event to close the queue. Mostly used internally but may have a few other use-cases.

### ``Q.prototype.map`` Method

```js
q([1,2,3]).map(mapCallback); // returns a new Q instance
```

This method performs a map operation. Values from the first queue are pulled, manipulated by the given callback, and then pushed into a new, anonymous queue which is returned as a reference for the next method in the chain. If the upstream queue is closed, map will propagate that change to the queue it's been given.

There are two function signatures for the map callback:

```js
{
	sync: function(val) { return something; },
	async: q.async(function(val, callback) { callback(something); })
}
```

### ``Q.prototype.reduce`` Method

```js
q([1, 2, 3]).reduce(reduceCallback, finalCallback, initialCondition); // returns the original Q instance
```

This method performs a reduce operation. Values from the queue are pulled, manipulated by the first callback which has been given the previous value (or initialCondition), and when the queue closes, the results are passed to the final callback.

There are two function signatures for the first reduce callback:

```js
{
	sync: function(prev, val) { return something; },
	async: q.async(function(prev, val, callback) { callback(something); })
}
```

The second callback has just one signature:
```js
function(result) { /* Do whatever */ }
```

### ``Q.prototype.filter`` Method

```js
q([1, 2, 3]).filter(filterCallback); // returns a new Q instance
```

This method performs a filter operation. Values from the queue are pulled and passed to the filter callback. If the callback returns true, the value is passed on to the new anonymous queue, otherwise it is discarded.

There are two function signatures for the filter callback:

```js
{
	sync: function(val) { return true || false; },
	async: q.async(function(val, callback) { callback(true || false); })
}
```

### ``Q.prototype.branch`` Method

```js
q([1, 2, 3]).branch(branchCallback); // returns the original Q instance
```

This method performs the queue-flow-specific branch operation. Values from the queue are pulled and passed to the filter callback. The callback then returns the name of the queue the value should be inserted into.

There are two function signatures for the branch callback:

```js
{
	sync: function(val) { return 'queueName'; },
	async: q.async(function(val, callback) { callback('queueName'); })
}
```

### ``Q.prototype.every`` and ``Q.prototype.some`` Methods

These methods have the following signatures:

```js
q([1, 2, 3]).every(everyCallback, finalCallback); // returns original Q instance
q([1, 2, 3]).some(someCallback, finalCallback); // returns original Q instance
```

For both, the first callback, just like the first callback of the ``filter`` method, and must return a true or false. However, they are like ``reduce`` in that they return a singular value at the end. For ``every``, it passes ``true`` to the final callback *only if every* call to the first callback returns true, otherwise it short-circuits and returns false. For ``some`` is the opposite, it passes ``true`` to the final callback if it receives a single ``true`` from the first callback, otherwise it returns ``false`` after the entire array is parsed.

The first callback of both have the exact same signatures as the ``filter`` method's first callback.

### ``Q.prototype.toArray`` Method

```js
q([1, 2, 3]).toArray(callback); // returns original Q instance
```

This method drains the attached queue and constructs a "normal" array, which is then passed to the specified callback, which is the only argument. This callback has the following signature:

```js
function(array) { /* Do whatever */ }
```

## Planned Features

* Create queue-flow scopes so the same flow names can be used by different functions.
* Expose the built-in ``Q`` object to make extending its prototype possible.
* Async-capable ``.each`` method.

## License (MIT)

Copyright (C) 2012 by David Ellis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
