# [![queue-flow](http://dfellis.github.com/queue-flow/images/queue-flow-logo.svg)](http://dfellis.github.com/queue-flow)

[![NPM version](https://badge.fury.io/js/queue-flow.png)](http://badge.fury.io/js/queue-flow) [![Build Status](https://secure.travis-ci.org/dfellis/queue-flow.png)](http://travis-ci.org/dfellis/queue-flow) [![Dependency Status](https://gemnasium.com/dfellis/queue-flow.png)](https://gemnasium.com/dfellis/queue-flow) [![Coverage Status](https://coveralls.io/repos/dfellis/queue-flow/badge.png?branch=master)](https://coveralls.io/r/dfellis/queue-flow?branch=master)

[![browser support](http://ci.testling.com/dfellis/queue-flow.png)](http://ci.testling.com/dfellis/queue-flow)

## Quick install instructions

For Node.js

    npm install queue-flow

For browsers, just copy ``./lib/queue-flow.min.js`` (generated by [UglifyJS](https://github.com/mishoo/UglifyJS/))and include it in a ``<script>`` tag.

For developers, ``npm test`` to check your changes (using [nodeunit](https://github.com/caolan/nodeunit/)) haven't broken existing functionality.

## Easy-to-follow data processing with queues, flowcharts, and functional programming

Tired of this?

```js
stuck(arg, function(err, result) {
    if(err) return console.log(err);
    In(result, function(err, result) {
        if(err) return console.log(err);
        callback(result, function(err, result) {
            if(err) return console.log(err);
            hell(result);
        });
    });
});
```

("stuck in callback hell")

What if you could write it like this?

```js
q([arg])
    .node(notStuck, 'error')
    .node(In, 'error')
    .node(callback, 'error')
    .each(hell);
q('error')
    .each(console.log);
```

Tired of this?

```js
async.waterfall([
    dealing.bind(this, arg),
    function With(result, callback) {
        if(result.foo == 'branch1') {
            async.waterfall([
                nested.bind(this, result),
                branches
            ], callback);
        } else {
            async.waterfall([
                making.bind(this, result),
                code,
                difficult
            ], callback);
        }
    },
    to.bind(this, 'const1', 'const2')
], function(err, result) {
    if(err) return console.log(err);
    follow(result);
});
```

("dealing with nested branches making code difficult to follow")

What if you could write it like this?

```js
q([arg])
    .node(dealing, 'error')
    .branch(function With(result) {
        return result.foo == 'branch1' ? 'branch1' : 'branch2';
    });
q('branch1')
    .node(nested, 'error')
    .node(branches, 'error')
    .chain('branchesRejoined');
q('branch2')
    .node(making, 'error')
    .node(code, 'error')
    .node(easy, 'error')
    .chain('branchesRejoined');
q('branchesRejoined')
    .node(to.bind(this, 'const1', 'const2'), 'error');
    .each(follow);
q('error')
    .each(console.log);
```

Tired of this?

```js
someRemoteCall('arg', function recursing(err, result) {
    if(err) return console.log(err);
    if(result == 'good') {
        doSomethingElse();
    } else {
        someRemoteCall(result, recursing);
        // Arg! Stack Overflow!?
        // But I can't unroll this recursion because it's an async function, right?
    }
});
```

How about this?

```js
q('recursiveCall')
    .node(someRemoteCall, 'error')
    .branch(function(result) {
        return result == 'good' ? 'doSomethingElse' : 'recursiveCall';
    }); // Cannot blow the stack!
q('error')
    .each(console.log);
q('doSomethingElse')
    ...
```

``queue-flow`` makes async and sync data processing code easy to read like ``Fibers`` (it doesn't look like fibers code, but it is easy to follow like it) while not altering the Javascript language itself like ``async``, giving you the best of both worlds, along with some other advantages:

* queues in ``queue-flow`` are simply temporary storage for the consuming method "verb" you use. These "verbs" create new, anonymous queues so they can be chained together easily for a terse, easy-to-understand syntax.
* Because there are anonymous queues in between, as one "verb" completes its task on one item to process, it can pass that along to the next "verb" in the chain to process while it starts to tackle the next item. If most of your "verbs" are dealing with I/O (database, file system, network connection, etc), then you very quickly will keep all of the other processes in your "pipeline" saturated, while still guaranteeing First-In-First-Out.
* Don't want that guarantee that the first request in is the first response out (such as for serving web pages?) ``queue-flow`` allows its constructor function to be overridden, and [sloppy-queue-flow](https://github.com/dfellis/sloppy-queue-flow) breaks queue order, turning your queue into essentially a task list of operations to perform on independent data.
* Named queues, ``branch``, and ``chain`` allow you to turn your queues into a flowchart of actions to perform, allowing you to organize your async tasks in easy-to-understand chunks just as functions organize imperative code in easy-to-reuse chunks, and all imperative constructs (``if, while, for``) can be replicated with ``branch``.

Still not convinced? [Check out more examples on why ``queue-flow`` is better than ``async``.](http://dfellis.github.com/queue-flow/2012/09/22/why-queue-flow/)

Want to learn more? [Check out the tutorial for ``queue-flow``](http://dfellis.github.com/queue-flow/2012/09/21/tutorial/) with neat figures explaining the behavior of ``queue-flow`` and its many method verbs. After that, you can [read the annotated source code, yourself](http://dfellis.github.com/queue-flow/docs/queue-flow.html), which is updated right when new releases of ``queue-flow`` are published (see the nifty [prepublish script](https://github.com/dfellis/queue-flow/blob/master/prepublish.sh)). (If youre just looking for an API reference, just read the left-hand column and ignore the source code on the right.)

## License (MIT)

Copyright (C) 2012-2013 by David Ellis

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
