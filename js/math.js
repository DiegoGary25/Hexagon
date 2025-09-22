(function(){
  'use strict';
  var root = window.HEX;
  if(!root){
    var base = {};
    Object.defineProperty(window, 'HEX', {
      value: base,
      writable: false,
      configurable: false
    });
    root = base;
  }

  var seed = Date.now() >>> 0;
  function mulberry32(a){
    return function(){
      var t = a += 0x6D2B79F5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var prng = mulberry32(seed);

  function randf(min, max){
    var a = (prng() + prng()) * 0.5;
    if(min === undefined){ return a; }
    if(max === undefined){ return a * min; }
    return min + (max - min) * a;
  }

  function randi(min, max){
    if(max === undefined){
      max = min;
      min = 0;
    }
    return Math.floor(randf() * (max - min + 1)) + min;
  }

  function clamp(v, lo, hi){
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function lerp(a, b, t){
    return a + (b - a) * t;
  }

  function easeInOutCubic(t){
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  var mathApi = {
    randf: function(min, max){ return randf(min, max); },
    randi: function(min, max){ return randi(min, max); },
    clamp: function(v, lo, hi){ return clamp(v, lo, hi); },
    lerp: function(a, b, t){ return lerp(a, b, t); },
    easeInOut: function(t){ return easeInOutCubic(t); }
  };

  Object.freeze(mathApi);
  Object.defineProperty(root, 'math', {
    value: mathApi,
    writable: false,
    configurable: false,
    enumerable: true
  });

  if(!Object.prototype.hasOwnProperty.call(root, 'version')){
    Object.defineProperty(root, 'version', {
      value: '1.0.0',
      writable: false,
      configurable: false,
      enumerable: true
    });
  }
})();
