#!/usr/bin/env bash

npm test
docco ./lib/queue-flow.js
git stash
mv docs docs-new
git checkout gh-pages
rm -rf docs
mv docs-new docs
git commit -am "Automatic documentation for version $npm_package_version"
git checkout 0.6.x
git stash pop
browserify ./lib/browserify.js | uglifyjs > ./lib/queue-flow.min.js
git commit -am "Automatic minification for version $npm_package_version"
git tag $npm_package_version
git push
git push --tags