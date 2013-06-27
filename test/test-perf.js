var q = require('../lib/queue-flow');

exports.perf = function(test) {
    test.expect(2);
    var testArray = [];
    for(var i = 0; i < 100000; i++) {
        testArray[i] = i;
    }
    var start = Date.now();
    q(testArray).map(function(val) { return 2*val+1; }).toArray(function(result) {
        var end = Date.now();
        test.equal(result.length, 100000, 'out result has all values');
        test.equal(result[1], 3, 'result has correct values');
        var time = end - start;
        var speed = 1000 * 100000 / time;
        console.log('Simple perf test took ' + time + 'ms, ' + speed + ' items/sec');
        test.done();
    });
};