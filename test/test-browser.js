var tape = require('tape');
var tests = require('./test');

for(var key in tests) {
    tape(key, tests[key]);
}
