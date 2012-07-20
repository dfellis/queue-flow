# queueFlow

## Quick install instructions

For Node.js

    npm install queueFlow

For browsers, just copy ``./lib/queueFlow.js`` and include it in a ``<script>`` tag.

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

## Enter *queueFlow*

```js
var q = require('queueFlow');

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

**queueFlow** builds a series of input and output queues for work to traverse from functional concept to functional concept, with reduce-style functions (that compress all values into a single result) instead having a final callback fired when the queue processing is completed.

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

When requesting a queue, an optional second parameter may be provided to use a third-party constructor, which will be useful for things like queueFlows designed for Web Workers or Node Clusters, but none exist, yet. Developers of such a library should use the tests in the ``./test`` directory to verify proper behavior of their plugin.

```js
q([1, 2, 3], WebWorkerQueue); // Someday...
```

## API Reference

API Reference goes here!

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
