var q = require('../lib/queueFlow');

exports.toArray = function(test) {
	test.expect(1);
	q([1, 2, 3]).toArray(function(result) {
		test.equal([1, 2, 3].toString(), result.toString(), 'array passes through the queue');
		test.done();
	}).closeOnEmpty();
};

exports.as = function(test) {
	test.expect(1);
	q([1, 2, 3]).as('test1');
	q('test1').toArray(function(result) {
		test.equal([1, 2, 3].toString(), result.toString(), 'named queue properly referenceable');
		test.done();
	}).closeOnEmpty();
};

exports.push = function(test) {
	test.expect(1);
	q('test2').push(1, 2, 3).toArray(function(result) {
		test.equal([1, 2, 3].toString(), result.toString(), 'named queue with elements pushed after-the-fact properly referenceable');
		test.done();
	}).closeOnEmpty();
};

exports.map = function(test) {
	test.expect(1);
	q([1, 2, 3]).map(function(value) {
		return value*2;
	}).toArray(function(result) {
		test.equal([2, 4, 6].toString(), result.toString(), 'queue mapped properly');
		test.done();
	}).closeOnEmpty();
};

exports.reduce = function(test) {
	test.expect(1);
	q([1, 2, 3]).reduce(function(prev, curr) {
		return prev + curr;
	}, function(result) {
		test.equal(6, result, 'queue reduced properly');
		test.done();
	}, 0).closeOnEmpty();
};

exports.filter = function(test) {
	test.expect(1);
	q([1, 2, 'skip a few', 99, 100]).filter(function(value) {
		return value == value + 0;
	}).toArray(function(result) {
		test.equal([1, 2, 99, 100].toString(), result.toString(), 'queue properly filtered');
		test.done();
	}).closeOnEmpty();
};

exports.on = function(test) {
	test.expect(5);
	q([1, 2, 3])
		.on('close', function() {
			test.ok(true, 'close event fired');
			test.done();
		})
		.on('pull', function() {
			test.ok(true, 'pull event fired');
		})
		.on('empty', function() {
			test.ok(true, 'empty event fired');
		})
		.closeOnEmpty()
		.toArray(function() { });
	q([1, 2, 3])
		.closeOnEmpty()
		.on('close', function() {
			return false;
		})
		.toArray(function() {
			test.ok(false, 'array method never executes final callback');
		});
};

exports.branch = function(test) {
	test.expect(3);
	q([1, 2, 'skip a few', 99, 100]).branch(function(value) {
		if(value == value + 0) {
			return value > 50 ? 'big' : 'small';
		} else {
			return 'invalid';
		}
	});
	var num = 0;
	q('big').toArray(function(result) {
		test.equal([99, 100].toString(), result.toString(), 'big queue properly populated');
		num++;
		if(num == 3) test.done();
	}).closeOnEmpty();
	q('small').toArray(function(result) {
		test.equal([1, 2].toString(), result.toString(), 'small queue properly populated');
		num++;
		if(num == 3) test.done();
	}).closeOnEmpty();
	q('invalid').toArray(function(result) {
		test.equal(['skip a few'].toString(), result.toString(), 'invalid queue properly populated');
		num++;
		if(num == 3) test.done();
	}).closeOnEmpty();
};
