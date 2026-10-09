#!/usr/bin/env node
'use strict';

// Register before Uni establishes aliases or imports a compiler. Keep Uni's argv unchanged.
require('./bootstrap.cjs');
require('@dcloudio/vite-plugin-uni/bin/uni.js');
