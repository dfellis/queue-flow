---
layout: site
title: Why queue-flow?
subtitle: What makes queue-flow better than async or Fibers?
---
You know a few programming languages, both static and dynamic, and you've heard good things about Node.js for handling large numbers of standard request-response type connections simultaneously, so you dust off *Javascript: The Good Parts* and some Node.js tutorials and after a quick refresher you apply your prior experience at this new server-side environment. Just another dynamic server-side language like Ruby, Python, or Perl, right?

But soon, you find your code has become difficult to read and refactor as you are

{% highlight js %}
lost(arg, function(err, result) {
    if(err) return console.log(err);
    In(result, function(err, result) {
        if(err) return console.log(err);
        callback(result, function(err, result) {
            if(err) return console.log(err);
            hell(result);
        });
    });
});
{% endhighlight %}

("lost in callback hell", by the way). You just want to accomplish what the outermost function wants to do, so you specify closure callbacks within it with the code that's specific to this function. But there's so much boilerplate and indentation! And because they are closures, you just use the outer scope variables at will, which means later on when you decide that the two innermost functions would be useful elsewhere, you can't actually just define it as an independent function without significantly refactoring your code, and since the callbacks are required to have a fixed set of input arguments, how would you pass the needed variables in, anyways? (Hint: ``Function.prototype.bind``, but it's still painful.) So you just copy-paste the block over and mangle it manually.

So, you start looking for solutions. ``Fibers`` looks very promising, but you quickly realize that any code you write on top of it, and any library that you depend on that uses it, cannot be used in the browser, and cannot even be used in Node.js for Windows, and come to understand why so little of the Node.js community relies on Fibers. So, believing that a quality solution can't be done in the Javascript syntax proper, you decide to take a look at a popular solution, and the most popular by far is Async.

Following the wisdom of the crowd, you start to refactor your code using the async library, and it does help some, but is this any better than what we had before?

{% highlight js %}
async.waterfall([
    function(next) {
        lost(arg, next);
    },
    function(result, next) {
        In(result, next);
    },
    function(result, next) {
        callback(result, next);
    }
], function(err, result) {
    if(err) return console.log(err);
    hell(result);
});
{% endhighlight %}

We've now made the same task take more lines of code, and we still have two indent levels, removing only one from the previous situation, and reusing these functions is still difficult, as each async method "verb" must be called within the callback used by the prior method's callback (perhaps the entire ``async.waterfall`` call is inside of the callback for an ``async.reduce``). It has saved *some* boilerplate, but it doesn't feel like much.

{% highlight js %}
async.waterfall([
    lost.bind(this, arg),
    In,
    callback
], function(err, result) {
    if(err) return console.log(err);
    hell(result);
});
{% endhighlight %}

(To be fair to ``async``, the above code has been reduced in size, but that's only because the steps are simple single-function-call steps. Any time more than two statements are involved, like the final callback, you need to define a closure to handle it, as all of the callbacks within the array (true of all of the flow-control methods of async) must have the same kind of behavior.)

To be honest, the ECMAScript 5 standard of Javascript has some nice functional programming concepts added to the ``Array`` object. ``map, reduce, filter, forEach``, etc. You could write generic functions that manipulated data in certain ways, and then combine them in whatever order you desired to process chunks of data. Then when it's done, you decide perhaps classify it based on the result and then feed it to one of a few functions specialized for that kind of data and continue the processing until you're ready to return something to the user.

But there are a few things stopping that in Node.js or even AJAX-heavy browser development:

1. This is a blocking API, so no AJAX allowed, no Node.js libraries allowed.</li>
2. Each step in the process will only start its work *after* the previous step has completed *all* of the work it has to do, meaning significant latency, especially when the processing time of the callback is unpredictable like in I/O calls.</li>
3. The "branching" logic between these bits of processing is still imperative, so it may have the same tendency to be copy-pasted, but this is the least important of worries.</li>

## Enter *queue-flow*

``queue-flow`` promises to solve these problems, presenting an async-capable (but not required) API similar to ECMAScript 5 or underscore.js, while introducing a few core concepts to give you much expresive power, all built within the standard Javascript syntax so it will work in whatever JS environment you place it in.

The core concepts are these: you define queues that data is put into and processed according to a series of steps. These queues can be named so you can specifically refer to them from functions or other queues. The standard ``each, map, reduce, filter``, etc method "verbs" are defined, along with an ``exec`` verb specifically designed to easily work with Node.js-style APIs, and a ``branch`` verb for deciding which queue a given piece of data should continue on. The ``branch`` verb is the final concept: if you think of each step in the queue as a processing box in a flowchart, ``branch`` is your decision box, making it possible for conditional behavior and loops to be defined with your queues.

{% highlight js %}
q([arg])
    .exec(lost, 'error')
    .exec(In, 'error')
    .exec(callback, 'error')
    .each(hell_or_not);
q('error')
    .each(console.log);
{% endhighlight %}

Unlike with ``async``, the method "verbs" you want to apply to your data can be mixed and matched in whatever order you find necessary, so where you would *need* to write an anonymous callback for a group of function calls that don't all have Node-style method and callback signatures, or simply need the arguments in a different order than what the previous method provides them in, with ``queue-flow``, you can insert very simple ``map`` calls to massage the data into the format needed by the next ``exec``.

{% highlight js %}
q('foo')
    .exec(bar, 'error')
    .map(function(result) { return [result.one, result.two]; })
    .exec(baz, 'error')
    .map(function(result) { return [result[0], result[2], result[1]]; })
    .exec(etc, 'error')
    ...
{% endhighlight %}

Any time you need to do a series of actions with asynchronous code, which you would traditionally use the ``async`` library for, a single queue will do the same thing, and with fewer lines of code and fewer indents. If you only need to do it once, queue a static array like in the first example. If you expect to do this operation several times, create a named queue like the example above and then

{% highlight js %}
q('foo').push(val1, val2, val3);
{% endhighlight %}

and each value will be run through the steps listed for that queue.

But there's another advantage with using ``queue-flow`` over ``async``. In between each queue step listed in your queue is actually an anonymous queue gluing the steps together. What this means is, that if your tasks are all (or mostly) async I/O with little local processing, once the first value is processed by the first step and its value is passed on to the next step, the first step will immediately start processing the second value while the second step is processing the first value.

Your queue is then essentially a pipeline, and will try to keep all of the stages of the pipeline as "full" as possible, just like a CPU pipeline, while keeping execution in-order. Yes, this analogy does imply that there certainly could be an out-of-order execution pipeline. ``queue-flow`` allows its constructor function to be overridden for alternative behaviors, and there is already one more constructor function, [sloppy-queue-flow](https://github.com/dfellis/sloppy-queue-flow), for when execution order doesn't matter at all (like handling web page requests).

So, you may be asking yourself, ``queue-flow`` handles things like ``async``'s ``series, waterfall, map, reduce``, etc, and ``sloppy-queue-flow`` gives you ``parallel``, but what about ``whilst`` and ``auto``? How can a queue handle that?

The first, ``whilst``, can be handled with the concept of named queues:

{% highlight js %}
q('whileTrue')
    .map(function(val, callback) {
        doSomething(callback);
    })
    .filter(function(val) { return !!val; })
    .chain('whileTrue');
q('whileTrue').push(true);
{% endhighlight %}

``chain`` is simply a ``branch`` that always goes to the same queue, in this case it links into itself recursively, where the ``filter`` acts as the break out of the recursive loop, as it has the power to block values from continuing. The ``auto`` concept can be seen in [one of the included examples](https://github.com/dfellis/queue-flow/blob/master/examples/graph.js), solving a dependency graph and processing the results in the correct order, also implemented with just a ``filter, map,`` and ``chain``, and one more queue that the ``filter`` pushes into for actually processing items removed from the apparently infinite loop.

``async`` has a ``queue`` verb, but there is no richness to it. There only "verb" it understands is essentially ``each``, and there is a ``drain`` for executing code when the queue has no more items. ``queue-flow`` has far more verbs to employ, and a richer event system, as well:

{% highlight js %}
q('someQueue').on('empty', function() { /* Analogous to an async queue's drain */ });
q('someQueue').on('close', function() {
    /* Queues in queue-flow can be empty but waiting for values to arrive.
       Long running queues that execute some sort of continues process,
       such as request-response actions. Named queues must be manually
       .close()'d, while queues that are simply given an array to process
       automatically close just like async's queue.                       */
});
q('someQueue').on('push', function(pushedVal) {
    /* Not possible in async's queues, we can watch when a queue is given
       new data and log this, inspect the data, and even return false to
       tell the queue to ignore it (though I recommend using filter instead) */
});
q('someQueue').on('pull', function(pulledVal) {
    /* Similarly, when a queue's action (map, reduce, filter, whatever) is
       ready for the next value, this event will be executed, allowing more
       detailed performance logging of the queue, making it possible to
       determine where the bottleneck is in your pipeline.                  */
});
{% endhighlight %}

These ``on`` event registers return the queue they register to, so they can be chained to each other and placed within the queue they are monitoring directly (perfect for the anonymous intermediate queues, although you can give them a name with ``.as('name')``, as well. ``as`` makes it possible to implement a rarely-used ``switch`` behavior (that it was actually designed for): initializing hardware that has been left in some state of initialization, but now with async code (which is perfect if you're communicating to the hardware over ethernet, USB, etc with Node.js):

{% highlight js %}
q('beginInitialization')
    .branch(determineHardwareState);

q('state0')
    .each(initialize)
    .as('state1')
    .each(checkMemory)
    .as('state2')
    .each(loadConfiguration)
    .as('state3')
    .each(startExecution)
    .chain('initialized');

q('initialized')
    .toArray(registerHardware);

q('beginInitialization').push(device0, device1, device2);
{% endhighlight %}

Now the *flow* of your data through your *queues* can be defined at a high level, while your lower-level decisions are handled within your functions, which can be kept general purpose and reusable between many queues. It can be a mix of sync and async code, they can be reordered with a simple select-click-and-drag because they're all at the same indent level. Linear steps are kept perfectly linear, functions are kept easily reusable. Developers are kept sane.
