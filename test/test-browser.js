var tape = require('tape');
var tests = require('./test');

for(var key in tests) {
    if(key !== 'complexity' && key !== 'jscoverage') tape(key, tests[key]);
}
