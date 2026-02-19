// Stub for onnxruntime-web - loads from CDN (window.ort)
// Metro config redirects onnxruntime-web imports to this file
// At runtime, we use window.ort loaded from CDN in the HTML

// Get window.ort when accessed (lazy loading)
function getOrt() {
  if (typeof window === 'undefined') {
    throw new Error('onnxruntime-web is only available in browser environment');
  }
  if (!window.ort) {
    throw new Error(
      'onnxruntime-web not loaded. Make sure the CDN script in app/+html.tsx loads before using speech-to-speech.'
    );
  }
  return window.ort;
}

// Create a proxy that completely forwards to window.ort
// This ensures all methods (including internal ones like _OrtGetInputName) are accessible
const stub = new Proxy({}, {
  get: (target, prop) => {
    const ort = getOrt();
    const value = ort[prop];
    // Bind functions to maintain 'this' context
    if (typeof value === 'function') {
      return value.bind(ort);
    }
    return value;
  },
  set: (target, prop, value) => {
    const ort = getOrt();
    ort[prop] = value;
    return true;
  },
  has: (target, prop) => {
    try {
      return prop in getOrt();
    } catch {
      return false;
    }
  },
  ownKeys: (target) => {
    try {
      return Reflect.ownKeys(getOrt());
    } catch {
      return [];
    }
  },
  getOwnPropertyDescriptor: (target, prop) => {
    try {
      const ort = getOrt();
      const descriptor = Object.getOwnPropertyDescriptor(ort, prop);
      if (descriptor) {
        // Return configurable descriptor to avoid proxy errors
        return {
          value: descriptor.value,
          writable: descriptor.writable !== false,
          enumerable: descriptor.enumerable !== false,
          configurable: true,
        };
      }
      return undefined;
    } catch {
      return undefined;
    }
  },
  defineProperty: (target, prop, descriptor) => {
    try {
      return Object.defineProperty(getOrt(), prop, descriptor);
    } catch {
      return false;
    }
  },
  getPrototypeOf: (target) => {
    try {
      return Object.getPrototypeOf(getOrt());
    } catch {
      return Object.prototype;
    }
  },
});

module.exports = stub;
