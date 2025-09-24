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

  function hit(){
    schedule(function(ctx, gain){
      var now = ctx.currentTime;
      var osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(90, now + 0.22);
      var toneGain = ctx.createGain();
      toneGain.gain.setValueAtTime(0.65, now);
      toneGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
      osc.connect(toneGain);
      toneGain.connect(gain);
      osc.start(now);
      osc.stop(now + 0.3);

      var buffer = ctx.createBuffer(1, ctx.sampleRate * 0.12, ctx.sampleRate);
      var data = buffer.getChannelData(0);
      for(var i=0;i<data.length;i++){
        var t = i / data.length;
        data[i] = (Math.random() * 2 - 1) * (1 - t) * 0.8;
      }
      var src = ctx.createBufferSource();
      src.buffer = buffer;
      var burstGain = ctx.createGain();
      burstGain.gain.setValueAtTime(0.5, now);
      burstGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      src.connect(burstGain);
      burstGain.connect(gain);
      src.start(now);
      src.stop(now + 0.2);
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
    playHit: function(){ hit(); },
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
