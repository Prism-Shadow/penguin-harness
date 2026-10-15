"use strict";

const { createEvsignHook } = require("./evsign-hook.cjs");
const { verifyTransitionSignature } = require("./verify-transition-signature.cjs");

const evsign = createEvsignHook({
  certificate: "2023",
  verifySignature: verifyTransitionSignature,
});
module.exports = evsign;
module.exports.default = evsign;
