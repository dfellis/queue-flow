// A simple express-like web server written with `queue-flow` that performs
// Express-like routing *and* has a session handler and a static file handler

var http = require('http');
var fs = require('fs');
var url = require('url');
var q = require('../lib/queue-flow');

// Express in a nutshell: a request comes in, and the http request and response
// variables are passed from one registered handler in the "happy path" to the
// next, assuming the handler calls next with no arguments. If next is called
// with an argument, it is assumed to be an error and then the error object is
// is passed down the "sad path" until one of them no longer calls `next` and
// instead uses the response object to respond to the user, which can also
// happen on the "happy path" when handler believes it can handle the request.

// The route handlers in Express are simply sub-queues (complete with the
// ability to define multiple handlers that can `next` to each other and there
// being handlers for errors, too) that are called if a request URL matches the
// route's RegEx (and if passed through to the end, is passed back into the
// main queue flow.

// This is a quintissential queue processing system perfect for `queue-flow`.

// First, let's define some helpers.

// `session` is a very simple session handler subflow that is totally the wrong
// way to do sessions that will be perfectly fine for the example.
q('session')
	.node(function(req, res) {
		// Construct the session store if necessary (not efficient, but this is just a demonstration
		global.sessions = global.sessions ? global.sessions : {};
		
		// Get the session from the client, or create a new session, and set the session variable in the response header
		var session = req.headers.cookie ? req.headers.cookie.replace(/^.*session=([^;]*).*$/, "$1") : (new Date()).getTime();
		res.setHeader("Set-Cookie", "session=" + session);
		
		// Get the session object, or construct a new one, and attach it to the response object for future filters
		global.sessions[session] = global.sessions[session] ? global.sessions[session] : {};
		res.session = global.sessions[session];
		
		// Return the req and res objects
		return [req, res];
	})
	.as('endSession');

// 'static' is a sub-flow that takes the request and response objects that first verifies if actually a static request,
// then it attempts to read the file, and if not, passes an error to the 'sad' path.
q('static')
	.node(function(req, res) {
		// Extract the url components
		var tokenized = url.parse(req.url);
		
		if(tokenized.path != tokenized.pathname) {
			// There are query parameters, so not a static resource
			throw [req, res, new Error('Not a static resource')];
		}
		return [req, res, "." + tokenized.path];
	}, 'sad')
	.node(function(req, res, path, next) {
		fs.readFile(path, function(err, data) {
			if(err) return next([req, res, new Error('Could not read file')]);
			res.end(data);
			next();
		});
	}, 'sad')
	.as('endStatic');

// `routes` is an object containing keys matching to subflows and values being regular expressions to be tested
var routes = {};

// 'route' is a subflow that branches to any number of other sub flows based on the results of a route object
q('route')
	.node(function(req, res, next) {
		q(Object.keys(routes))
			.reduce(function(result, route) {
				if(!result) {
					return routes[route].test(req.url) ? route : false
				}
				return result;
			}, function(result) {
				if(result) {
					q(result).push([req, res]);
				}
				next(null, [req, res, result]);
			}, false);
	})
	.filter(function(resultArr) {
		return !resultArr[2];
	})
	.map(function(resultArr) {
		return [resultArr[0], resultArr[1]];
	})
	.as('endRoute');


// Define the 'happy' path, which is fed pairs of request and response objects
// and then filtered by successive handlers. Returning true means the handler
// did *not* want to process the request and thinks it's fine for the path to
// continue. If it returns false, either it handled the request, or sent the
// request, response, *and* an error object along to the 'sad' path.
q('happy').chain('session');
q('endSession').chain('route');
q('endRoute').chain('static');

// Simple error handler that dumps the error to the user
q('sad')
	.node(function(reqResErr, value) {
		return reqResErr[1].end(reqResErr[2].message);
	});

// Define route handler queues and url matchers
routes['index'] = /^\/$/;
q('index')
	.node(function(req, res) {
		res.end('Hello, world!');
	});

routes['setSessionProperties'] = /^\/setSession/;
q('setSessionProperties')
	.node(function(req, res) {
		res.session.foo = "bar";
		res.end('Set something on the session object for you!');
	});

routes['getSession'] = /^\/getSession/;
q('getSession')
	.node(function(req, res) {
		res.end(JSON.stringify(res.session));
	});

// Create the http server and push all new requests into the 'happy' queue.
http.createServer(function(req, res) {
	q('happy').push([req, res]);
}).listen(8000);

