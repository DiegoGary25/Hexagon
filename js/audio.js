(function(){
  'use strict';
  var root = window.HEX;
  if(!root){ throw new Error('HEX root missing'); }

  var context = null;
  var masterGain = null;
  var muted = false;
  var unlocked = false;

  function ensureContext(){
    if(!context){
      context = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = context.createGain();
      masterGain.gain.value = 0.35;
      masterGain.connect(context.destination);
    }
    if(context.state === 'suspended'){
      context.resume();
    }
    unlocked = true;
  }

  function schedule(fn){
    if(!unlocked){
      ensureContext();
    }
    if(!context || muted){ return; }
    fn(context, masterGain);
  }

  function pulse(options){
    schedule(function(ctx, gain){
      var now = ctx.currentTime;
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = options.type || 'sine';
      osc.frequency.setValueAtTime(options.frequency, now);
      if(options.sweep){
        osc.frequency.linearRampToValueAtTime(options.frequency * options.sweep, now + options.duration);
      }
      g.gain.setValueAtTime(options.level, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + options.duration);
      osc.connect(g);
      g.connect(gain);
      osc.start(now);
      osc.stop(now + options.duration + 0.05);
    });
  }

  function noiseBurst(){
    schedule(function(ctx, gain){
      var buffer = ctx.createBuffer(1, ctx.sampleRate * 0.15, ctx.sampleRate);
      var data = buffer.getChannelData(0);
      for(var i=0;i<data.length;i++){
        data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      }
      var src = ctx.createBufferSource();
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.45, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
      src.buffer = buffer;
      src.connect(g);
      g.connect(gain);
      src.start();
      src.stop(ctx.currentTime + 0.2);
    });
  }

  function toggleMute(){
    muted = !muted;
    if(!context){
      ensureContext();
    }
    if(masterGain && context){
      masterGain.gain.setValueAtTime(muted ? 0 : 0.35, context.currentTime || 0);
    }
    return muted;
  }

  var api = {
    ensure: function(){ ensureContext(); },
    playStart: function(){ pulse({ frequency: 420, duration: 0.3, level: 0.5, sweep: 2, type: 'triangle' }); },
    playTick: function(){ pulse({ frequency: 720, duration: 0.12, level: 0.28, sweep: 1.1, type: 'square' }); },
    playMultUp: function(){ pulse({ frequency: 540, duration: 0.32, level: 0.45, sweep: 2.3, type: 'sawtooth' }); },
    playDeath: function(){ noiseBurst(); },
    toggleMute: function(){ return toggleMute(); },
    isMuted: function(){ return muted; }
  };

  Object.freeze(api);
  Object.defineProperty(root, 'audio', {
    value: api,
    writable: false,
    configurable: false,
    enumerable: true
  });
})();
