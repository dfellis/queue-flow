var q = require('../lib/queue-flow');

function bootstrap(test) {
    test.expect = test.expect || test.plan;
    test.done = test.done || test.end;
}

exports.perf = function(test) {
    bootstrap(test);
    test.expect(2);
    var testArray = [];
    var runs = 3000000;
    for(var i = 0; i < runs; i++) {
        testArray[i] = i;
    }
    var start = Date.now();
    q(testArray).map(function(val) { return 2*val+1; }).toArray(function(result) {
        var end = Date.now();
        test.equal(result.length, runs, 'out result has all values');
        test.equal(result[1], 3, 'result has correct values');
        var time = end - start;
        var speed = 1000 * runs / time;
        console.log('Simple perf test took ' + time + 'ms, ' + speed + ' items/sec');
        test.done();
    });
};