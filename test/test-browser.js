var tape = require('tape');
var q = require('../lib/queue-flow');
var tests = require('./test');
tests.getQueueFlow(q);

for(var key in tests) {
    if(key !== 'getQueueFlow' && key !== 'flattenAndNode' && key !== 'complexity') tape(key, tests[key]);
}
