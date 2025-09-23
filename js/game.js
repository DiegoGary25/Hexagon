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

  var WIDTH = 480;
  var HEIGHT = 640;
  var CENTER_X = WIDTH / 2;
  var CENTER_Y = HEIGHT / 2;
  var BASE_PLAYER_RADIUS = 170;
  var SPAWN_RADIUS = 300;
  var STEP_RATE = 1 / 120;
  var TWO_PI = Math.PI * 2;
  var ACCENT_COLORS = ['#3DE0B4', '#7F51FF', '#FF517A', '#D1FF51'];

  var container = null;
  var canvas = null;
  var ctx = null;
  var scoreEl = null;
  var banner = null;
  var overlay = null;
  var message = null;
  var playAgain = null;
  var multiplierFill = null;
  var multiplierText = null;
  var multiplierBar = null;

  var dpr = window.devicePixelRatio || 1;
  var state = 'BOOT';
  var isStarting = false;
  var initCalled = false;

  var accumulator = 0;
  var lastTimestamp = 0;
  var globalTime = 0;

  var survivalTime = 0;
  var score = 0;
  var multiplier = 1;
  var multiplierProgress = 0;
  var multiplierPulseTimer = 0;
  var multiplierDropTimer = 0;
  var nextCheckpoint = 20;

  var spawnCooldown = 0.5;
  var logicalSides = 6;
  var displaySides = 6;
  var targetSides = 6;
  var previousSides = 6;
  var morphTimer = 0;
  var morphDuration = 0;
  var spawnPauseTimer = 0;
  var gapGuideFade = 1;
  var worldRotation = 0;
  var spinVelocity = 0;
  var spinTimer = 0;
  var nextSpinAt = 12;
  var checksumSalt = 0;
  var checksum = 0;
  var bannerTimer = 0;
  var bannerActive = false;
  var tiltTimer = 0;

  var rings = [];
  var ringPool = [];
  var MAX_RINGS = 80;

  var player = {
    angle: -Math.PI / 2,
    velocity: 0,
    radius: BASE_PLAYER_RADIUS,
    hitTolerance: 18
  };

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

  function updateScoreLabel(){
    if(scoreEl){
      scoreEl.textContent = score.toFixed(2);
    }
  }

  function updateMultiplierUI(){
    if(!multiplierFill || !multiplierText){ return; }
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
    multiplier = 1;
    multiplierProgress = 0;
    multiplierPulseTimer = 0;
    multiplierDropTimer = impact ? 0.25 : 0;
    updateMultiplierUI();
    multiplierBar.classList.remove('glow');
    if(impact){
      multiplierText.classList.remove('pulse');
      multiplierText.classList.add('shrink');
    } else {
      multiplierText.classList.remove('pulse');
      multiplierText.classList.remove('shrink');
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

  function updateMultiplierTimers(dt){
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

  function showBanner(text){
    if(!banner){ return; }
    banner.textContent = text;
    banner.classList.remove('hidden');
    banner.classList.add('show');
    bannerTimer = 1.2;
    bannerActive = true;
  }

  function hideBanner(){
    if(!banner){ return; }
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

  function showOverlay(msg){
    if(!overlay){ return; }
    message.textContent = msg;
    overlay.classList.remove('hidden');
  }

  function hideOverlay(){
    if(overlay){
      overlay.classList.add('hidden');
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
        if(blocked <= 0.0001){ continue; }
        var cut = blocked * 0.5;
        iterator(start, start + cut);
        iterator(end - cut, end);
      } else {
        iterator(start, end);
      }
    }
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

  function scheduleMorph(){
    var nextSides = math.randi(5, 8);
    if(nextSides === logicalSides){
      nextSides = nextSides === 8 ? 5 : nextSides + 1;
    }
    previousSides = displaySides;
    targetSides = nextSides;
    morphTimer = 0;
    morphDuration = 0.6;
    spawnPauseTimer = 0.45;
    patternManager.defer(spawnPauseTimer);
    showBanner('MORPH');
  }

  function scheduleSpin(){
    spinTimer = 2 + math.randf(0, 0.8);
    spinVelocity = (math.randf() > 0.5 ? 1 : -1) * (0.9 + Math.min(1.8, survivalTime / 30));
    showBanner('SPIN');
  }

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
    if(survivalTime > 18 && morphTimer === 0 && morphDuration === 0 && math.randf() < 0.002){
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
      prepareReadyState();
    }
    checksum = next;
  }

  function render(){
    renderBackground(globalTime);
    renderArenaPolygon();
    renderRings();
    renderPlayer();
  }

  function resetRunData(){
    clearRings();
    player.angle = -Math.PI / 2;
    player.velocity = 0;
    survivalTime = 0;
    score = 0;
    multiplier = 1;
    multiplierProgress = 0;
    multiplierPulseTimer = 0;
    multiplierDropTimer = 0;
    nextCheckpoint = 20;
    spawnCooldown = 0.5;
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
    checksumSalt = (math.randf() * 0xFFFFFFFF) >>> 0;
    checksum = 0;
    gapGuideFade = 1;
    bannerTimer = 0;
    bannerActive = false;
    tiltTimer = 0;
    updateScoreLabel();
    updateMultiplierUI();
    multiplierText.classList.remove('pulse');
    multiplierText.classList.remove('shrink');
    multiplierBar.classList.remove('glow');
    container.classList.remove('tilt-left');
    container.classList.remove('tilt-right');
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
    if(name === 'pingPong'){
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
            patternTag: 'pingPong'
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
    if(name === 'inwardBurst'){
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
            patternTag: 'inwardBurst'
          };
        }
      };
    }
    return null;
  }

  var lastPattern = '';
  var PATTERN_NAMES = ['spiral', 'alternating', 'pingPong', 'collapse', 'flicker', 'inwardBurst'];

  function choosePattern(){
    var available = PATTERN_NAMES.slice();
    var idx = available.indexOf(lastPattern);
    if(idx !== -1){ available.splice(idx, 1); }
    var pick = available[math.randi(0, available.length - 1)];
    lastPattern = pick;
    return buildPattern(pick);
  }

  var patternManager = (function(){
    var activePattern = null;
    var nextSpawnAt = Infinity;

    function schedule(time, delay){
      nextSpawnAt = time + math.clamp(delay, 0.18, 1.2);
    }

    function reset(time){
      activePattern = null;
      lastPattern = '';
      schedule(time, 0.45);
    }

    function spawnNext(time){
      if(!activePattern){
        activePattern = choosePattern();
        if(!activePattern){
          schedule(time, spawnCooldown);
          return;
        }
      }
      var spawn = activePattern.next();
      if(!spawn){
        activePattern = null;
        schedule(time, 0.35 + math.randf(0, 0.3));
        return;
      }
      spawn.speed += math.randf(-8, 8);
      spawn.patternTag = spawn.patternTag || 'base';
      spawn.laneCount = spawn.laneCount || logicalSides;
      spawn.gapIndex = ((spawn.gapIndex % spawn.laneCount) + spawn.laneCount) % spawn.laneCount;
      spawn.guideStrength = spawn.guideStrength === undefined ? gapGuideFade : spawn.guideStrength;
      spawnRing(spawn);
      audio.playTick();
      var delay = spawn.delay || activePattern.delay || spawnCooldown;
      schedule(time, delay);
    }

    return {
      start: function(time){ reset(time); },
      reset: function(time){ reset(time); },
      update: function(time){
        if(state !== 'RUN'){ return; }
        while(time >= nextSpawnAt){
          spawnNext(time);
        }
      },
      defer: function(amount){
        nextSpawnAt += amount;
      }
    };
  })();

  function setState(next){
    state = next;
  }

  function prepareReadyState(){
    resetRunData();
    resetMultiplier(false);
    patternManager.reset(0);
    hideOverlay();
    showBanner('READY');
    setState('READY');
    isStarting = false;
  }

  function startRun(){
    if(state !== 'READY' || isStarting){ return; }
    isStarting = true;
    audio.ensure();
    hideOverlay();
    multiplierText.classList.remove('pulse');
    multiplierText.classList.remove('shrink');
    multiplierBar.classList.remove('glow');
    spawnPauseTimer = 0;
    patternManager.start(survivalTime);
    setState('RUN');
    isStarting = false;
  }

  function gameOver(){
    if(state !== 'RUN'){ return; }
    resetMultiplier(true);
    audio.playDeath();
    container.classList.add('shake');
    window.setTimeout(function(){ container.classList.remove('shake'); }, 120);
    showOverlay('GAME OVER');
    if(playAgain){
      try { playAgain.focus({ preventScroll: true }); } catch(_e){}
    }
    setState('GAME_OVER');
  }

  function pollStartIntent(){
    var triggered = false;
    if(typeof input.startPressedOnce === 'function' && input.startPressedOnce()){ triggered = true; }
    if(typeof input.pointerStartPressedOnce === 'function' && input.pointerStartPressedOnce()){ triggered = true; }
    if(!triggered){ return; }
    if(state === 'READY'){
      startRun();
      audio.playStart();
    } else if(state === 'GAME_OVER'){
      prepareReadyState();
      startRun();
      audio.playStart();
    }
  }

  function handleMuteInput(){
    if(typeof input.mutePressedOnce === 'function' && input.mutePressedOnce()){
      var muted = audio.toggleMute();
      showBanner(muted ? 'MUTED' : 'UNMUTED');
    }
  }

  function updateRun(dt){
    survivalTime += dt;
    score += dt * multiplier;
    updateScoreLabel();
    addMultiplierProgress(dt * 0.06 + survivalTime * 0.0004);
    handleCheckpoint();
    updateDifficulty(dt);
    if(spawnPauseTimer > 0){
      spawnPauseTimer -= dt;
      if(spawnPauseTimer < 0){ spawnPauseTimer = 0; }
    }
    if(spawnPauseTimer <= 0){
      patternManager.update(survivalTime);
    }
    updateRings(dt);
    updateMorph(dt);
    updateSpin(dt);
    updatePlayer(dt);

    for(var i=rings.length - 1;i>=0;i--){
      if(rings[i].active && checkRingCollision(rings[i])){
        gameOver();
        break;
      }
    }

    updateChecksum();
  }

  function updateReady(dt){
    updateSpin(dt);
    updateMorph(dt);
  }

  function updateGameOver(dt){
    updateSpin(dt * 0.5);
  }

  function fixedUpdate(dt){
    globalTime += dt;
    updateBanner(dt);
    updateMultiplierTimers(dt);
    handleMuteInput();
    pollStartIntent();

    if(state === 'RUN'){
      updateRun(dt);
    } else if(state === 'READY'){
      updateReady(dt);
    } else if(state === 'GAME_OVER'){
      updateGameOver(dt);
    }
  }

  function applyScaling(){
    dpr = window.devicePixelRatio || 1;
    canvas.width = WIDTH * dpr;
    canvas.height = HEIGHT * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.imageSmoothingEnabled = false;
  }

  function loop(now){
    requestAnimationFrame(loop);
    if(!lastTimestamp){ lastTimestamp = now; }
    var delta = (now - lastTimestamp) / 1000;
    if(delta < 0){ delta = 0; }
    if(delta > 0.05){ delta = 0.05; }
    lastTimestamp = now;
    accumulator += delta;
    while(accumulator >= STEP_RATE){
      fixedUpdate(STEP_RATE);
      accumulator -= STEP_RATE;
    }
    render();
  }

  function bindEvents(){
    if(!playAgain){ return; }
    playAgain.addEventListener('click', function(ev){
      ev.preventDefault();
      playAgain.blur();
      prepareReadyState();
    });
  }

  function init(){
    if(initCalled){ return; }
    initCalled = true;

    container = doc.getElementById('container');
    canvas = doc.getElementById('game');
    ctx = canvas.getContext('2d', { alpha: false });
    scoreEl = doc.getElementById('score');
    banner = doc.getElementById('banner');
    overlay = doc.getElementById('overlay');
    message = doc.getElementById('message');
    playAgain = doc.getElementById('playAgain');
    multiplierFill = doc.getElementById('multiplierFill');
    multiplierText = doc.getElementById('multiplierText');
    multiplierBar = doc.getElementById('multiplierBar');

    try { Object.seal(canvas); } catch(_e){}
    try { Object.seal(ctx); } catch(_e){}

    applyScaling();
    window.addEventListener('resize', applyScaling);

    canvas.addEventListener('contextmenu', function(ev){ ev.preventDefault(); });

    bindEvents();

    prepareReadyState();
    hideOverlay();

    lastTimestamp = performance.now();
    requestAnimationFrame(loop);
  }

  if(doc.readyState === 'loading'){
    doc.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  Object.freeze(root);
})();
