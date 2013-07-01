var tape = require('tape');
var q = require('../lib/queue-flow');
var tests = require('./test');
var perfTest = require('./test-perf');
tests.getQueueFlow(q);

for(var key in tests) {
    if(key !== 'getQueueFlow' && key !== 'flattenAndNode' && key !== 'complexity') tape(key, tests[key]);
}

for(var key in perfTest) {
    if(perfTest.hasOwnProperty(key)) tape(key, perfTest[key]);
}
