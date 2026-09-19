#!/usr/bin/env node
/* eslint-disable */
// Deliberately old JavaScript: var, no arrow functions, no template strings, no
// optional chaining. Someone on Node 16 must get a sentence telling them to
// upgrade, not a syntax error from a file they never asked to read.
'use strict';

var MIN = '22.12.0';

function tooOld(current, minimum) {
  var a = String(current).replace(/^v/, '').split('.');
  var b = minimum.split('.');
  for (var i = 0; i < 3; i++) {
    var x = parseInt(a[i], 10) || 0;
    var y = parseInt(b[i], 10) || 0;
    if (x !== y) return x < y;
  }
  return false;
}

if (tooOld(process.versions.node, MIN)) {
  process.stderr.write(
    '\nXentium needs Node ' + MIN + ' or newer, and this is Node ' + process.versions.node + '.\n\n' +
    '  Install the current release from https://nodejs.org, or with nvm:\n' +
    '    nvm install 24 && nvm use 24\n\n' +
    '  Then run this again:\n' +
    '    npm create xentium@latest\n\n'
  );
  process.exit(1);
}

import('../dist/index.js').then(function (module) {
  return module.main(process.argv.slice(2));
}).then(function (code) {
  process.exit(code || 0);
}).catch(function (err) {
  process.stderr.write('\n' + ((err && err.message) || err) + '\n');
  process.exit(1);
});
