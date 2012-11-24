// This simple example shows off tree traversal with queue-flow, specifically
// a dependency graph, and a processing queue for "working" on each dependency
// in a valid order (all dependencies of the item have already been processed)
if(typeof require != 'undefined') var q = require('../lib/queue-flow');

// Each item, with an array of items that mus be 'processed' before said item
// can be processed
var items = [
	{
		name: 'foo',
		deps: [ 'bar', 'baz' ]
	},
	{
		name: 'bar',
		deps: [ 'baz', 'hiyo' ]
	},
	{
		name: 'baz',
		deps: [ ]
	},
	{
		name: 'hiyo',
		deps: [ 'baz' ]
	}
];

// A hash table of processed items
var processed = {};

// This queue flow pushes the items into the order they are allowed to
// be processed into the process queue flow
q('linearize')
	// Log the linearization process to understand better how it works
	.each(console.log.bind(console, 'linearize '))
	// Any item with no dependencies left is put into the process queue
	// and flagged as processed
	.filter(function(item) {
		if(item.deps.length == 0) {
			q('process').push(item.name);
			processed[item.name] = true;
			return false;
		}
		return true;
	})
	// Otherwise, it is checked for dependencies that can be removed
	.map(function(item) {
		item.deps = item.deps.filter(function(dep) {
			return processed[dep] !== true;
		});
		return item;
	})
	// And then puts it back into the linearize queue
	.branch('linearize');

// Actual installation/"processing" would occur here. Just log which
// items are entering when
q('process')
	.each(console.log.bind(console, 'process '));

// Load the items to be linearized and processed, seeding the 'self-feeding' queue
q('linearize').concat(items);
