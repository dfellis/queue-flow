var jscoverage = require('jscoverage');
jscoverage.enableCoverage(true);
var q = jscoverage.require(module, '../lib/queue-flow');
var coveralls = require('coveralls');
var tests = require('./test');
tests.getObjs(q, require('fs'));

for(var key in tests) {
    if(key !== 'getObjs') exports[key] = tests[key];
}

exports.jscoverage = function(test) {
    test.expect(1);
    jscoverage.coverageDetail();
    var coverageStats = jscoverage.coverageStats();
    Object.keys(coverageStats).forEach(function(file) {
        test.equal(coverageStats[file].total, coverageStats[file].touched, 'All lines of code exercised by the tests');
    });
    if(process.env.TRAVIS) coveralls.handleInput(jscoverage.getLCOV());
    test.done();
};
