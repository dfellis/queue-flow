var jscoverage = require('jscoverage');
jscoverage.enableCoverage(true);
var q = jscoverage.require(module, '../lib/queue-flow');
var tests = require('./test');
tests.getQueueFlow(q);

for(var key in tests) {
    if(key !== 'getQueueFlow') exports[key] = tests[key];
}

exports.jscoverage = function(test) {
    test.expect(1);
    jscoverage.coverageDetail();
    // Copied directly from jscoverage and edited, since getting at these values directly isn't possible
    var file;
    var tmp;
    var total;
    var touched;
    var n, len;
    if (typeof global._$jscoverage === 'undefined') {
        return;
    }
    Object.keys(global._$jscoverage).forEach(function(key) {
        file = key;
        tmp = global._$jscoverage[key];
        if (typeof tmp === 'function' || tmp.length === undefined) return;
        total = touched = 0;
        for (n = 0, len = tmp.length; n < len; n++) {
            if (tmp[n] !== undefined) {
                total ++;
                if (tmp[n] > 0)
                    touched ++;
            }
        }
        test.equal(total, touched, 'All lines of code exercised by the tests');
    });
    test.done();
};
