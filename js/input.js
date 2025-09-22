(function(){
  'use strict';
  var root = window.HEX;
  if(!root){ throw new Error('HEX root missing'); }

  var LEFT_KEYS = Object.freeze(['ArrowLeft', 'KeyA']);
  var RIGHT_KEYS = Object.freeze(['ArrowRight', 'KeyD']);
  var START_KEYS = Object.freeze(['Space']);
  var MUTE_KEYS = Object.freeze(['KeyM']);

  var downState = Object.create(null);
  var leftActive = false;
  var rightActive = false;
  var queuedStart = false;
  var queuedMute = false;

  function updateAxis(){
    leftActive = LEFT_KEYS.some(function(code){ return !!downState[code]; });
    rightActive = RIGHT_KEYS.some(function(code){ return !!downState[code]; });
  }

  function handleKeyDown(ev){
    if(ev.defaultPrevented){ return; }
    if(ev.repeat){
      if(LEFT_KEYS.indexOf(ev.code) !== -1 || RIGHT_KEYS.indexOf(ev.code) !== -1){
        ev.preventDefault();
      }
      return;
    }
    downState[ev.code] = true;
    if(LEFT_KEYS.indexOf(ev.code) !== -1 || RIGHT_KEYS.indexOf(ev.code) !== -1){
      ev.preventDefault();
      updateAxis();
      return;
    }
    if(START_KEYS.indexOf(ev.code) !== -1){
      ev.preventDefault();
      queuedStart = true;
      return;
    }
    if(MUTE_KEYS.indexOf(ev.code) !== -1){
      ev.preventDefault();
      queuedMute = true;
    }
  }

  function handleKeyUp(ev){
    delete downState[ev.code];
    if(LEFT_KEYS.indexOf(ev.code) !== -1 || RIGHT_KEYS.indexOf(ev.code) !== -1){
      ev.preventDefault();
      updateAxis();
      return;
    }
  }

  function handlePointer(ev){
    if(ev && typeof ev.preventDefault === 'function'){ ev.preventDefault(); }
    queuedStart = true;
  }

  function handleBlur(){
    downState = Object.create(null);
    leftActive = false;
    rightActive = false;
  }

  window.addEventListener('keydown', handleKeyDown, { passive: false });
  window.addEventListener('keyup', handleKeyUp, { passive: false });
  window.addEventListener('blur', handleBlur);
  window.addEventListener('pointerdown', handlePointer, { passive: false });

  var api = {
    left: function(){ return leftActive; },
    right: function(){ return rightActive; },
    consumeStart: function(){ var v = queuedStart; queuedStart = false; return v; },
    consumeMute: function(){ var v = queuedMute; queuedMute = false; return v; }
  };

  Object.freeze(api);
  Object.defineProperty(root, 'input', {
    value: api,
    writable: false,
    configurable: false,
    enumerable: true
  });
})();
