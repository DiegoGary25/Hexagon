(function(){
  'use strict';
  var root = window.HEX;
  if(!root){ throw new Error('HEX root missing'); }

  var LEFT_KEYS = Object.freeze(['ArrowLeft', 'KeyA']);
  var RIGHT_KEYS = Object.freeze(['ArrowRight', 'KeyD']);
  var START_KEYS = Object.freeze(['Space', 'Enter']);
  var MUTE_KEYS = Object.freeze(['KeyM']);

  var downState = Object.create(null);
  var leftActive = false;
  var rightActive = false;
  var queuedStart = false;
  var queuedPointerStart = false;
  var queuedMute = false;

  function updateAxis(){
    leftActive = LEFT_KEYS.some(function(code){ return !!downState[code]; });
    rightActive = RIGHT_KEYS.some(function(code){ return !!downState[code]; });
  }

  function handleKeyDown(ev){
    if(ev.defaultPrevented){ return; }
    var code = ev.code;
    if(ev.repeat){
      if(LEFT_KEYS.indexOf(code) !== -1 || RIGHT_KEYS.indexOf(code) !== -1 || START_KEYS.indexOf(code) !== -1){
        ev.preventDefault();
      }
      return;
    }
    downState[code] = true;
    if(LEFT_KEYS.indexOf(code) !== -1 || RIGHT_KEYS.indexOf(code) !== -1){
      ev.preventDefault();
      updateAxis();
      return;
    }
    if(START_KEYS.indexOf(code) !== -1){
      ev.preventDefault();
      queuedStart = true;
      return;
    }
    if(MUTE_KEYS.indexOf(code) !== -1){
      ev.preventDefault();
      queuedMute = true;
      return;
    }
  }

  function handleKeyUp(ev){
    var code = ev.code;
    if(downState[code]){
      delete downState[code];
    }
    if(LEFT_KEYS.indexOf(code) !== -1 || RIGHT_KEYS.indexOf(code) !== -1){
      ev.preventDefault();
      updateAxis();
    }
  }

  function handlePointer(ev){
    if(ev && typeof ev.preventDefault === 'function'){ ev.preventDefault(); }
    queuedPointerStart = true;
  }

  function handleBlur(){
    downState = Object.create(null);
    leftActive = false;
    rightActive = false;
    queuedStart = false;
    queuedPointerStart = false;
    queuedMute = false;
  }

  window.addEventListener('keydown', handleKeyDown, { passive: false });
  window.addEventListener('keyup', handleKeyUp, { passive: false });
  window.addEventListener('blur', handleBlur);

  var canvas = document.getElementById('game');
  if(canvas){
    canvas.addEventListener('pointerdown', handlePointer, { passive: false });
  }

  var api = {
    left: function(){ return leftActive; },
    right: function(){ return rightActive; },
    startPressedOnce: function(){ var v = queuedStart; queuedStart = false; return v; },
    pointerStartPressedOnce: function(){ var v = queuedPointerStart; queuedPointerStart = false; return v; },
    mutePressedOnce: function(){ var v = queuedMute; queuedMute = false; return v; }
  };

  Object.freeze(api);
  Object.defineProperty(root, 'input', {
    value: api,
    writable: false,
    configurable: false,
    enumerable: true
  });
})();
