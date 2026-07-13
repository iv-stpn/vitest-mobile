// Metro polyfill (NOT a module) — concatenated by the serializer and run as a
// plain script in global scope before the module system and before any
// `getModulesRunBeforeMainModule` (InitializeCore) module. `this` is the global.
//
// React Native normally installs `FormData` via InitializeCore's setUpXHR, but
// the vitest-mobile harness runtime doesn't reach that path, and real app
// dependency graphs reference `FormData` at module-top (e.g. `class X extends
// FormData`, `instanceof FormData`) — which is evaluated during pre-main
// polyfill/module loading and throws "Property 'FormData' doesn't exist".
// Installing it here guarantees it exists before anything else evaluates.
(function (global) {
  'use strict';

  // Timer globals normally installed by InitializeCore's setUpTimers. RN
  // internals and many libraries reference these at module-top.
  if (typeof global.setImmediate === 'undefined') {
    global.setImmediate = function (fn) {
      var args = Array.prototype.slice.call(arguments, 1);
      return setTimeout(function () {
        fn.apply(null, args);
      }, 0);
    };
  }
  if (typeof global.clearImmediate === 'undefined') {
    global.clearImmediate = function (handle) {
      return clearTimeout(handle);
    };
  }
  if (typeof global.requestAnimationFrame === 'undefined') {
    global.requestAnimationFrame = function (cb) {
      return setTimeout(function () {
        cb(Date.now());
      }, 16);
    };
  }
  if (typeof global.cancelAnimationFrame === 'undefined') {
    global.cancelAnimationFrame = function (handle) {
      return clearTimeout(handle);
    };
  }

  if (typeof global.FormData !== 'undefined') return;

  function FormData() {
    this._entries = [];
  }
  FormData.prototype.append = function (name, value) {
    this._entries.push([name, value]);
  };
  FormData.prototype.set = function (name, value) {
    this._entries = this._entries.filter(function (e) {
      return e[0] !== name;
    });
    this._entries.push([name, value]);
  };
  FormData.prototype.get = function (name) {
    for (var i = 0; i < this._entries.length; i++) {
      if (this._entries[i][0] === name) return this._entries[i][1];
    }
    return null;
  };
  FormData.prototype.getAll = function (name) {
    return this._entries
      .filter(function (e) {
        return e[0] === name;
      })
      .map(function (e) {
        return e[1];
      });
  };
  FormData.prototype.has = function (name) {
    return this._entries.some(function (e) {
      return e[0] === name;
    });
  };
  FormData.prototype['delete'] = function (name) {
    this._entries = this._entries.filter(function (e) {
      return e[0] !== name;
    });
  };
  FormData.prototype.forEach = function (cb, thisArg) {
    for (var i = 0; i < this._entries.length; i++) {
      cb.call(thisArg, this._entries[i][1], this._entries[i][0], this);
    }
  };
  FormData.prototype.entries = function () {
    return this._entries[Symbol.iterator]();
  };
  FormData.prototype.keys = function () {
    return this._entries
      .map(function (e) {
        return e[0];
      })
      [Symbol.iterator]();
  };
  FormData.prototype.values = function () {
    return this._entries
      .map(function (e) {
        return e[1];
      })
      [Symbol.iterator]();
  };
  FormData.prototype[Symbol.iterator] = function () {
    return this._entries[Symbol.iterator]();
  };

  global.FormData = FormData;
})(typeof globalThis !== 'undefined' ? globalThis : this);
