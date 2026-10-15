"use strict";

const { createEvsignHook } = require("./evsign-hook.cjs");

const evsign = createEvsignHook();
module.exports = evsign;
module.exports.default = evsign;
