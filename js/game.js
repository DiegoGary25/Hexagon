(function(){
  'use strict';
  var root = window.HEX;
  if(!root || !root.math || !root.input || !root.audio){
    throw new Error('HEX subsystems missing');
  }

  var math = root.math;
  var input = root.input;
  var audio = root.audio;

  var doc = document;
  var container = doc.getElementById('container');
  var canvas = doc.getElementById('game');
  var ctx = canvas.getContext('2d', { alpha: false });
  var scoreEl = doc.getElementById('score');
  var banner = doc.getElementById('banner');
  var overlay = doc.getElementById('overlay');
  var message = doc.getElementById('message');
  var playAgain = doc.getElementById('playAgain');
  var multiplierFill = doc.getElementById('multiplierFill');
  var multiplierText = doc.getElementById('multiplierText');
  var multiplierBar = doc.getElementById('multiplierBar');

  try { Object.seal(canvas); } catch(_e){}
  try { Object.seal(ctx); } catch(_e){}

  var WIDTH = 480;
  var HEIGHT = 640;
  var CENTER_X = WIDTH / 2;
  var CENTER_Y = HEIGHT / 2;
  var BASE_PLAYER_RADIUS = 170;
  var SPAWN_RADIUS = 300;
  var STEP_RATE = 1 / 120;
  var TWO_PI = Math.PI * 2;
  var ACCENT_COLORS = ['#3DE0B4', '#7F51FF', '#FF517A', '#D1FF51'];

  var dpr = window.devicePixelRatio || 1;
  function resize(){
    dpr = window.devicePixelRatio || 1;
    canvas.width = WIDTH * dpr;
    canvas.height = HEIGHT * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.imageSmoothingEnabled = false;
  }
  resize();
  window.addEventListener('resize', resize);

  var TAU = TWO_PI;
  function wrapAngle(a){
    while(a < 0){ a += TAU; }
    while(a >= TAU){ a -= TAU; }
    return a;
  }

  function angleInRange(angle, start, end){
    var a = wrapAngle(angle);
    var s = wrapAngle(start);
    var e = wrapAngle(end);
    if(s <= e){
      return a >= s && a <= e;
    }
    return a >= s || a <= e;
  }

  var player = {
    angle: -Math.PI / 2,
    velocity: 0,
    radius: BASE_PLAYER_RADIUS,
    hitTolerance: 18
  };

  var rings = [];
  var ringPool = [];
  var MAX_RINGS = 80;

  function createRing(){
    return {
      active: false,
      moving: false,
      telegraph: 0,
      telegraphMax: 0,
      radius: SPAWN_RADIUS,
      laneCount: 6,
      gapIndex: 0,
      gapWidth: 1,
      angleOffset: -Math.PI / 2,
      speed: 120,
      thickness: 26,
      colorIndex: 0,
      altGapIndex: -1,
      flickerTrigger: 0,
      flickerDone: false,
      collapseTrigger: 0,
      collapseWidth: 1,
      guideStrength: 1,
      patternTag: 'base',
      age: 0
    };
  }

  function getRing(){
    for(var i=0;i<ringPool.length;i++){
      if(!ringPool[i].active){
        ringPool[i].active = true;
        rings.push(ringPool[i]);
        return ringPool[i];
      }
    }
    if(ringPool.length < MAX_RINGS){
      var ring = createRing();
      ring.active = true;
      ringPool.push(ring);
      rings.push(ring);
      return ring;
    }
    return null;
  }

  function releaseRing(ring){
    ring.active = false;
    ring.moving = false;
    ring.telegraph = 0;
    ring.age = 0;
  }

  function clearRings(){
    rings.length = 0;
    for(var i=0;i<ringPool.length;i++){
      ringPool[i].active = false;
      ringPool[i].moving = false;
      ringPool[i].telegraph = 0;
      ringPool[i].age = 0;
    }
  }

  var gamePhase = 'BOOT';
  var elapsedTime = 0;
  var survivalTime = 0;
  var score = 0;
  var multiplier = 1;
  var multiplierProgress = 0;
  var multiplierPulseTimer = 0;
  var multiplierDropTimer = 0;
  var nextCheckpoint = 20;
  var spawnCooldown = 0.5;
  var patternCooldown = 0.5;
  var currentPattern = null;
  var patternDelay = 0;
  var logicalSides = 6;
  var displaySides = 6;
  var morphTimer = 0;
  var morphDuration = 0;
  var targetSides = 6;
  var previousSides = 6;
  var spawnPauseTimer = 0;
  var worldRotation = 0;
  var spinVelocity = 0;
  var spinTimer = 0;
  var nextSpinAt = 12;
  var checksumSalt = (math.randf() * 0xFFFFFFFF) >>> 0;
  var checksum = 0;
  var gapGuideFade = 1;
  var bannerTimer = 0;
  var bannerActive = false;
  var tiltTimer = 0;

  function setPhase(phase){
    gamePhase = phase;
  }

  function showBanner(text){
    banner.textContent = text;
    banner.classList.remove('hidden');
    banner.classList.add('show');
    bannerTimer = 1.2;
    bannerActive = true;
  }

  function hideBanner(){
    banner.classList.remove('show');
    banner.classList.add('hidden');
    bannerActive = false;
  }

  function updateBanner(dt){
    if(!bannerActive){ return; }
    bannerTimer -= dt;
    if(bannerTimer <= 0){
      hideBanner();
    }
  }

  function updateScoreLabel(){
    scoreEl.textContent = score.toFixed(2);
  }

  function updateMultiplierUI(){
    var height = math.clamp(multiplierProgress, 0, 1) * 100;
    multiplierFill.style.height = height.toFixed(2) + '%';
    multiplierText.textContent = multiplier.toFixed(1).replace('.0', '') + '×';
    if(height > 70){
      multiplierBar.classList.add('glow');
    } else {
      multiplierBar.classList.remove('glow');
    }
  }

  function resetMultiplier(impact){
    multiplier = Math.max(1, multiplier - 0.5);
    multiplierProgress = 0;
    updateMultiplierUI();
    if(impact){
      multiplierText.classList.remove('pulse');
      multiplierText.classList.add('shrink');
      multiplierDropTimer = 0.25;
    }
  }

  function addMultiplierProgress(amount){
    multiplierProgress += amount;
    if(multiplierProgress >= 1){
      multiplierProgress -= 1;
      multiplier = Math.round((multiplier + 0.5) * 10) / 10;
      multiplierText.classList.remove('shrink');
      multiplierText.classList.add('pulse');
      multiplierPulseTimer = 0.25;
      audio.playMultUp();
    }
    updateMultiplierUI();
  }

  function scheduleMorph(){
    var nextSides = math.randi(5, 8);
    if(nextSides === logicalSides){
      nextSides = nextSides === 8 ? 5 : nextSides + 1;
    }
    previousSides = displaySides;
    targetSides = nextSides;
    morphTimer = 0;
    morphDuration = 1.8;
    spawnPauseTimer = 0.9;
    showBanner('MORPH');
  }

  function scheduleSpin(){
    spinTimer = 2 + math.randf(0, 0.8);
    spinVelocity = (math.randf() > 0.5 ? 1 : -1) * (0.9 + Math.min(1.8, survivalTime / 30));
    showBanner('SPIN');
  }

  function spawnRing(info){
    var ring = getRing();
    if(!ring){ return; }
    ring.moving = false;
    ring.telegraph = info.telegraph || 0.3;
    ring.telegraphMax = ring.telegraph;
    ring.radius = SPAWN_RADIUS;
    ring.laneCount = info.laneCount || logicalSides;
    ring.gapIndex = info.gapIndex || 0;
    ring.gapWidth = info.gapWidth === undefined ? 1 : info.gapWidth;
    ring.angleOffset = info.angleOffset === undefined ? -Math.PI / 2 : info.angleOffset;
    ring.speed = info.speed;
    ring.thickness = info.thickness || 26;
    ring.colorIndex = (ring.colorIndex + 1) % ACCENT_COLORS.length;
    ring.altGapIndex = info.altGapIndex === undefined ? -1 : info.altGapIndex;
    ring.flickerTrigger = info.flickerTrigger || 0;
    ring.flickerDone = false;
    ring.collapseTrigger = info.collapseTrigger || 0;
    ring.collapseWidth = info.collapseWidth || ring.gapWidth;
    ring.patternTag = info.patternTag || 'base';
    ring.guideStrength = info.guideStrength;
    ring.age = 0;
    if(ring.telegraph <= 0){
      ring.telegraph = 0;
      ring.moving = true;
    }
  }

  function buildPattern(name){
    var lanes = logicalSides;
    var difficulty = Math.min(1.5 + survivalTime / 45, 4.5);
    if(name === 'spiral'){
      var baseGap = math.randi(0, lanes - 1);
      var dir = math.randf() > 0.5 ? 1 : -1;
      var drift = math.randf(0.3, 0.6);
      var count = 6 + math.randi(0, 3);
      var offset = 0;
      return {
        delay: 0.48,
        next: function(){
          if(count-- <= 0){ return null; }
          offset += drift;
          var step = TWO_PI / lanes;
          var info = {
            laneCount: lanes,
            gapIndex: baseGap,
            angleOffset: -Math.PI / 2 + offset * step * 0.18,
            speed: 110 + difficulty * 22,
            guideStrength: gapGuideFade,
            patternTag: 'spiral'
          };
          baseGap = (baseGap + dir + lanes) % lanes;
          return info;
        }
      };
    }
    if(name === 'alternating'){
      var startGap = math.randi(0, lanes - 1);
      var opposite = (startGap + Math.floor(lanes / 2)) % lanes;
      var flips = 8;
      var toggle = false;
      return {
        delay: 0.5,
        next: function(){
          if(flips-- <= 0){ return null; }
          toggle = !toggle;
          return {
            laneCount: lanes,
            gapIndex: toggle ? startGap : opposite,
            speed: 115 + difficulty * 24,
            angleOffset: -Math.PI / 2,
            guideStrength: gapGuideFade,
            patternTag: 'alternating'
          };
        }
      };
    }
    if(name === 'pingpong'){
      var idx = math.randi(0, lanes - 1);
      var direction = 1;
      var swings = lanes * 2;
      return {
        delay: 0.42,
        next: function(){
          if(swings-- <= 0){ return null; }
          var info = {
            laneCount: lanes,
            gapIndex: idx,
            speed: 120 + difficulty * 26,
            angleOffset: -Math.PI / 2,
            guideStrength: gapGuideFade,
            patternTag: 'ping'
          };
          idx += direction;
          if(idx <= 0 || idx >= lanes - 1){ direction *= -1; }
          idx = (idx + lanes) % lanes;
          return info;
        }
      };
    }
    if(name === 'collapse'){
      var collapseGap = math.randi(0, lanes - 1);
      var waves = 5 + math.randi(0, 2);
      return {
        delay: 0.46,
        next: function(){
          if(waves-- <= 0){ return null; }
          return {
            laneCount: lanes,
            gapIndex: collapseGap,
            speed: 125 + difficulty * 24,
            angleOffset: -Math.PI / 2,
            gapWidth: 1,
            collapseTrigger: BASE_PLAYER_RADIUS + 36,
            collapseWidth: 0.35,
            guideStrength: gapGuideFade,
            patternTag: 'collapse'
          };
        }
      };
    }
    if(name === 'flicker'){
      var flickerGap = math.randi(0, lanes - 1);
      var alt = (flickerGap + math.randi(1, lanes - 1)) % lanes;
      var bursts = 6;
      return {
        delay: 0.44,
        next: function(){
          if(bursts-- <= 0){ return null; }
          var info = {
            laneCount: lanes,
            gapIndex: flickerGap,
            altGapIndex: alt,
            flickerTrigger: BASE_PLAYER_RADIUS + 70,
            speed: 120 + difficulty * 28,
            angleOffset: -Math.PI / 2,
            guideStrength: gapGuideFade,
            patternTag: 'flicker'
          };
          flickerGap = (flickerGap + math.randi(1, 2)) % lanes;
          alt = (flickerGap + math.randi(1, lanes - 1)) % lanes;
          return info;
        }
      };
    }
    if(name === 'burst'){
      var burstCount = 4;
      return {
        delay: 0.2,
        next: function(){
          if(burstCount-- <= 0){ return null; }
          return {
            laneCount: lanes,
            gapIndex: math.randi(0, lanes - 1),
            speed: 150 + difficulty * 35,
            angleOffset: -Math.PI / 2,
            guideStrength: gapGuideFade,
            telegraph: 0.18,
            patternTag: 'burst'
          };
        }
      };
    }
    return null;
  }

  var lastPattern = '';
  var PATTERN_NAMES = ['spiral', 'alternating', 'pingpong', 'collapse', 'flicker', 'burst'];

  function choosePattern(){
    var available = PATTERN_NAMES.slice();
    var idx = available.indexOf(lastPattern);
    if(idx !== -1){ available.splice(idx, 1); }
    var pick = available[math.randi(0, available.length - 1)];
    lastPattern = pick;
    return buildPattern(pick);
  }

  function updatePatterns(dt){
    if(spawnPauseTimer > 0){
      spawnPauseTimer -= dt;
      return;
    }
    if(!currentPattern){
      patternCooldown -= dt;
      if(patternCooldown <= 0){
        currentPattern = choosePattern();
        patternDelay = 0.1;
      }
      return;
    }
    patternDelay -= dt;
    if(patternDelay > 0){ return; }
    var spawn = currentPattern.next();
    if(spawn){
      spawn.speed += math.randf(-8, 8);
      spawn.patternTag = spawn.patternTag || 'base';
      spawn.laneCount = spawn.laneCount || logicalSides;
      spawn.gapIndex = spawn.gapIndex % spawn.laneCount;
      // angleOffset remains relative to base orientation; world rotation is applied at render time
      spawn.guideStrength = spawn.guideStrength === undefined ? gapGuideFade : spawn.guideStrength;
      spawnRing(spawn);
      audio.playTick();
      patternDelay = (spawn.delay || currentPattern.delay || spawnCooldown);
    } else {
      currentPattern = null;
      patternCooldown = 0.35 + math.randf(0, 0.4);
    }
  }

  function visitBlockedRanges(ring, iterator){
    var step = TWO_PI / ring.laneCount;
    var base = ring.angleOffset + worldRotation;
    var open = math.clamp(ring.gapWidth, 0, 1) * step;
    var blocked = step - open;
    for(var i=0;i<ring.laneCount;i++){
      var start = base + i * step;
      var end = start + step;
      if(i === ring.gapIndex){
        if(blocked <= 0.0001){
          continue;
        }
        var cut = blocked * 0.5;
        iterator(start, start + cut);
        iterator(end - cut, end);
      } else {
        iterator(start, end);
      }
    }
  }

  function updateRing(ring, dt){
    if(ring.telegraph > 0){
      ring.telegraph -= dt;
      if(ring.telegraph <= 0){
        ring.telegraph = 0;
        ring.moving = true;
      }
      return;
    }
    if(!ring.moving){ return; }
    ring.age += dt;
    ring.radius -= ring.speed * dt;
    if(ring.flickerTrigger && !ring.flickerDone && ring.radius < ring.flickerTrigger){
      if(ring.altGapIndex !== -1){
        ring.gapIndex = ring.altGapIndex;
      }
      ring.flickerDone = true;
    }
    if(ring.collapseTrigger && ring.gapWidth > ring.collapseWidth && ring.radius < ring.collapseTrigger){
      ring.gapWidth = ring.collapseWidth;
    }
    if(ring.radius < player.radius - ring.thickness - 20){
      releaseRing(ring);
    }
  }

  function checkRingCollision(ring){
    if(!ring.moving){ return false; }
    var radialGap = Math.abs(ring.radius - player.radius);
    if(radialGap > (ring.thickness * 0.6 + player.hitTolerance)){ return false; }
    var hit = false;
    var pAngle = wrapAngle(player.angle);
    visitBlockedRanges(ring, function(start, end){
      if(hit){ return; }
      if(angleInRange(pAngle, start, end)){
        hit = true;
      }
    });
    return hit;
  }

  function updateRings(dt){
    for(var i=rings.length - 1;i>=0;i--){
      var ring = rings[i];
      if(!ring.active){
        rings.splice(i, 1);
        continue;
      }
      updateRing(ring, dt);
      if(!ring.active){
        rings.splice(i, 1);
      }
    }
  }

  function renderTelegraph(ring){
    if(ring.telegraph <= 0){ return; }
    var alpha = 1 - (ring.telegraph / (ring.telegraphMax || 1));
    var color = ACCENT_COLORS[ring.colorIndex % ACCENT_COLORS.length];
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.2 + alpha * 0.35;
    ctx.lineWidth = ring.thickness * 0.85;
    visitBlockedRanges(ring, function(start, end){
      ctx.beginPath();
      ctx.arc(CENTER_X, CENTER_Y, SPAWN_RADIUS, start, end, false);
      ctx.stroke();
    });
    ctx.restore();
  }

  function renderRing(ring){
    if(!ring.moving){ return; }
    var color = ACCENT_COLORS[ring.colorIndex % ACCENT_COLORS.length];
    var nearPlayer = ring.radius < player.radius + 28;
    ctx.save();
    ctx.lineWidth = ring.thickness;
    ctx.strokeStyle = nearPlayer ? 'rgba(255,176,22,0.85)' : color;
    ctx.shadowColor = color;
    ctx.shadowBlur = nearPlayer ? 22 : 12;
    ctx.globalAlpha = nearPlayer ? 0.95 : 0.85;
    visitBlockedRanges(ring, function(start, end){
      ctx.beginPath();
      ctx.arc(CENTER_X, CENTER_Y, ring.radius, start, end, false);
      ctx.stroke();
    });
    ctx.restore();

    if(ring.moving && ring.guideStrength > 0.01 && survivalTime < 45){
      var step = TWO_PI / ring.laneCount;
      var base = ring.angleOffset + worldRotation + ring.gapIndex * step + step * 0.5;
      var arrowRadius = ring.radius + 36;
      var alpha = ring.guideStrength * (1 - survivalTime / 45);
      ctx.save();
      ctx.translate(CENTER_X, CENTER_Y);
      ctx.rotate(base);
      ctx.globalAlpha = math.clamp(alpha, 0, 1);
      ctx.fillStyle = 'rgba(61,224,180,0.7)';
      ctx.beginPath();
      ctx.moveTo(0, -arrowRadius);
      ctx.lineTo(8, -arrowRadius + 18);
      ctx.lineTo(-8, -arrowRadius + 18);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  function renderArenaPolygon(){
    var progress = morphDuration <= 0 ? 1 : math.clamp(morphTimer / morphDuration, 0, 1);
    displaySides = math.lerp(previousSides, targetSides, math.easeInOut(progress));
    var effectiveSides = Math.max(3, Math.round(displaySides));
    var angleStep = TWO_PI / effectiveSides;
    var radius = BASE_PLAYER_RADIUS + 120;
    ctx.save();
    ctx.translate(CENTER_X, CENTER_Y);
    ctx.rotate(worldRotation * 0.4);
    ctx.beginPath();
    for(var i=0;i<effectiveSides;i++){
      var angle = angleStep * i - Math.PI / 2;
      var x = Math.cos(angle) * radius;
      var y = Math.sin(angle) * radius;
      if(i === 0){ ctx.moveTo(x, y); }
      else { ctx.lineTo(x, y); }
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(61,224,180,0.35)';
    ctx.lineWidth = 6;
    ctx.shadowColor = 'rgba(61,224,180,0.35)';
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.restore();
  }

  function renderBackground(time){
    ctx.save();
    ctx.fillStyle = '#050608';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    var pulse = 0.25 + Math.sin(time * 2.4) * 0.12;
    var grad = ctx.createRadialGradient(CENTER_X, CENTER_Y, 20, CENTER_X, CENTER_Y, 360);
    grad.addColorStop(0, 'rgba(61,224,180,' + (0.18 + pulse * 0.3).toFixed(3) + ')');
    grad.addColorStop(0.45, 'rgba(127,81,255,' + (0.08 + pulse * 0.18).toFixed(3) + ')');
    grad.addColorStop(1, 'rgba(13,15,18,1)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  function renderPlayer(){
    ctx.save();
    ctx.translate(CENTER_X, CENTER_Y);
    ctx.rotate(worldRotation);
    ctx.rotate(player.angle + Math.PI / 2);
    ctx.translate(0, -player.radius);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#3DE0B4';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(9, 12);
    ctx.lineTo(-9, 12);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function renderRings(){
    for(var i=0;i<ringPool.length;i++){
      var ring = ringPool[i];
      if(!ring.active){ continue; }
      if(ring.telegraph > 0){ renderTelegraph(ring); }
    }
    for(var j=0;j<ringPool.length;j++){
      var activeRing = ringPool[j];
      if(!activeRing.active){ continue; }
      renderRing(activeRing);
    }
  }

  function updatePlayer(dt){
    var left = input.left();
    var right = input.right();
    var inputAxis = (right ? 1 : 0) - (left ? 1 : 0);
    var difficulty = math.clamp(survivalTime / 60, 0, 1);
    var maxSpeed = 3.6 + difficulty * 1.4;
    var accel = 24 + difficulty * 10;
    var damping = 28 - difficulty * 10;
    player.velocity += inputAxis * accel * dt;
    if(player.velocity > maxSpeed){ player.velocity = maxSpeed; }
    if(player.velocity < -maxSpeed){ player.velocity = -maxSpeed; }
    if(inputAxis === 0){
      player.velocity -= player.velocity * damping * dt;
    }
    player.angle = wrapAngle(player.angle + player.velocity * dt);

    if(Math.abs(player.velocity) > 1.8){
      tiltTimer = 0.18;
      container.classList.toggle('tilt-left', player.velocity < 0);
      container.classList.toggle('tilt-right', player.velocity > 0);
    } else {
      if(tiltTimer > 0){
        tiltTimer -= dt;
      } else {
        container.classList.remove('tilt-left');
        container.classList.remove('tilt-right');
      }
    }
  }

  function handleCheckpoint(){
    if(survivalTime >= nextCheckpoint){
      nextCheckpoint += 20;
      showBanner('CHECKPOINT');
    }
  }

  function handleMultiplierTimers(dt){
    if(multiplierPulseTimer > 0){
      multiplierPulseTimer -= dt;
      if(multiplierPulseTimer <= 0){
        multiplierText.classList.remove('pulse');
      }
    }
    if(multiplierDropTimer > 0){
      multiplierDropTimer -= dt;
      if(multiplierDropTimer <= 0){
        multiplierText.classList.remove('shrink');
      }
    }
  }

  function death(){
    if(gamePhase !== 'RUN'){ return; }
    resetMultiplier(true);
    audio.playDeath();
    container.classList.add('shake');
    window.setTimeout(function(){ container.classList.remove('shake'); }, 120);
    overlay.classList.remove('hidden');
    message.textContent = 'GAME OVER';
    playAgain.focus({ preventScroll: true });
    setPhase('GAME_OVER');
  }

  function resetGame(){
    clearRings();
    player.angle = -Math.PI / 2;
    player.velocity = 0;
    survivalTime = 0;
    elapsedTime = 0;
    score = 0;
    multiplier = 1;
    multiplierProgress = 0;
    nextCheckpoint = 20;
    spawnCooldown = 0.5;
    patternCooldown = 0.5;
    currentPattern = null;
    patternDelay = 0;
    logicalSides = 6;
    displaySides = 6;
    previousSides = 6;
    targetSides = 6;
    morphTimer = 0;
    morphDuration = 0;
    spawnPauseTimer = 0;
    worldRotation = 0;
    spinVelocity = 0;
    spinTimer = 0;
    nextSpinAt = 12;
    checksum = 0;
    bannerTimer = 0;
    bannerActive = false;
    gapGuideFade = 1;
    container.classList.remove('tilt-left');
    container.classList.remove('tilt-right');
    updateScoreLabel();
    updateMultiplierUI();
  }

  function enterReady(){
    resetGame();
    overlay.classList.add('hidden');
    showBanner('READY');
    setPhase('READY');
  }

  function startRun(){
    if(gamePhase !== 'READY'){ return; }
    audio.playStart();
    overlay.classList.add('hidden');
    showBanner('GO');
    setPhase('RUN');
  }

  function handleStartInput(){
    if(input.consumeStart()){
      if(gamePhase === 'READY'){
        startRun();
      } else if(gamePhase === 'GAME_OVER'){
        enterReady();
      }
    }
  }

  function handleMuteInput(){
    if(input.consumeMute()){
      var muted = audio.toggleMute();
      showBanner(muted ? 'MUTED' : 'UNMUTED');
    }
  }

  playAgain.addEventListener('click', function(ev){
    ev.preventDefault();
    enterReady();
  });

  canvas.addEventListener('contextmenu', function(ev){ ev.preventDefault(); });

  function updateMorph(dt){
    if(targetSides !== previousSides){
      morphTimer += dt;
      if(morphTimer >= morphDuration){
        previousSides = targetSides;
        morphDuration = 0;
        morphTimer = 0;
        logicalSides = Math.round(targetSides);
      }
    }
  }

  function updateSpin(dt){
    if(spinTimer > 0){
      spinTimer -= dt;
      worldRotation += spinVelocity * dt;
      spinVelocity *= 0.985;
      if(spinTimer <= 0){
        spinVelocity = 0;
      }
    } else {
      worldRotation *= 0.995;
    }
  }

  function updateDifficulty(dt){
    gapGuideFade = math.clamp(1 - survivalTime / 40, 0, 1);
    var targetCooldown = 0.6 - survivalTime * 0.003;
    spawnCooldown = math.clamp(targetCooldown, 0.28, 0.6);
    if(survivalTime > nextSpinAt){
      scheduleSpin();
      nextSpinAt += 12 + math.randf(0, 10);
    }
    if(survivalTime > 18 && morphTimer === 0 && morphDuration === 0 && math.randf() < 0.0015){
      scheduleMorph();
    }
  }

  function updateChecksum(){
    var activeCount = 0;
    for(var i=0;i<ringPool.length;i++){
      if(ringPool[i].active){ activeCount++; }
    }
    var next = ((activeCount << 3) ^ ((score * 17) | 0) ^ ((multiplier * 31) | 0) ^ checksumSalt) >>> 0;
    if(checksum && checksum !== next){
      enterReady();
    }
    checksum = next;
  }

  function updateGame(dt){
    if(gamePhase !== 'RUN'){ return; }
    survivalTime += dt;
    elapsedTime += dt;
    score += dt * multiplier;
    updateScoreLabel();
    addMultiplierProgress(dt * 0.06 + survivalTime * 0.0004);
    handleCheckpoint();
    updateDifficulty(dt);
    updatePatterns(dt);
    updateRings(dt);
    updateMorph(dt);
    updateSpin(dt);
    updatePlayer(dt);
    handleMultiplierTimers(dt);

    for(var i=rings.length - 1;i>=0;i--){
      if(rings[i].active && checkRingCollision(rings[i])){
        death();
        break;
      }
    }

    updateChecksum();
  }

  function render(){
    renderBackground(survivalTime);
    renderArenaPolygon();
    renderRings();
    renderPlayer();
  }

  function tick(dt){
    updateBanner(dt);
    handleStartInput();
    handleMuteInput();
    if(gamePhase === 'BOOT'){
      enterReady();
    }
    updateGame(dt);
  }

  var accumulator = 0;
  var lastTimestamp = performance.now();

  function loop(now){
    var delta = (now - lastTimestamp) / 1000;
    if(delta > 0.1){ delta = 0.1; }
    lastTimestamp = now;
    accumulator += delta;
    while(accumulator >= STEP_RATE){
      tick(STEP_RATE);
      accumulator -= STEP_RATE;
    }
    render();
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);

  Object.freeze(root);
})();
