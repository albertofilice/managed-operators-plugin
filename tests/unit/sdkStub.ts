/** Lets plugin modules that import the console SDK be loaded under plain Node. */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require('module');
const original = Module._load;
Module._load = function (request: string, ...rest: unknown[]) {
  if (request === '@openshift-console/dynamic-plugin-sdk') {
    return { consoleFetchJSON: {} };
  }
  return original.call(this, request, ...rest);
};
