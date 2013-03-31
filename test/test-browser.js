var tape = require('tape');
var q = require('../lib/queue-flow');
var tests = require('./test');
tests.getQueueFlow(q);

for(var key in tests) {
    if(key !== 'getQueueFlow') tape(key, tests[key]);
}
