'use strict'

// This marketplace uses neither paid encrypted uni_modules nor HBuilderX
// cloud plugin compilation. Do not ship an archive reader/writer for that
// unused path. If it is ever enabled, fail explicitly until a reviewed,
// symlink-safe implementation is available.
module.exports = class DisabledCloudZip {
  constructor() {
    throw new Error('Encrypted uni_modules cloud compilation is disabled in this marketplace. Use a reviewed ZIP implementation before enabling it.')
  }
}
